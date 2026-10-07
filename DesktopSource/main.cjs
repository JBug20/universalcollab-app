const { app, BrowserWindow, ipcMain, clipboard, safeStorage, session, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Preserve legacy credentials and Chromium localStorage during the rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Stream Relay'));
app.setName('UniversalCollab');
const localProfiles = require('./local-profile.cjs').createLocalProfileStore(app.getPath('userData'));

const servers = require('./server-store.cjs').createServerStore(
  app.getPath('userData'),
  safeStorage,
  process.platform
);
const home = path.join(__dirname, 'portal.html');
let win, platforms, studio;
let obs,
  obsControls,
  obsPrevious,
  obsCredentials,
  obsQueue = Promise.resolve();
let studioQueue = Promise.resolve(),
  studioBusy = false,
  backupBusy = false;
const { PlatformService, PlatformError } = require('./platforms/service.cjs');
const { StudioService } = require('./platforms/studio.cjs');
const { createVault } = require('./platforms/vault.cjs');
const valid = e => e.sender === win?.webContents && e.senderFrame?.url === pathToFileURL(home).href;
const guard = e => {
  if (!valid(e)) throw Error('Request rejected.');
};
const profilePath = () => path.join(app.getPath('userData'), 'profile.bin');
const parseAddress = v => {
  const u = new URL(v);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw Error();
  return u.origin;
};
function getPlatforms() {
  if (!platforms) {
    platforms = new PlatformService({
      vault: createVault(app.getPath('userData'), safeStorage),
      openExternal: url => shell.openExternal(url),
      notify: data => {
        if (win && !win.isDestroyed()) win.webContents.send('platform-state', data);
      }
    });
    try {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-oauth.json'), 'utf8'));
      for (const p of ['twitch', 'youtube'])
        if (!platforms.db.clients[p] && c[p]?.clientId) platforms.configure(p, c[p]);
    } catch {}
  }
  return platforms;
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1240,
    height: 920,
    minWidth: 460,
    minHeight: 640,
    title: 'UniversalCollab',
    backgroundColor: '#101017',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  ipcMain.handle('relay-request', async (e, input) => {
    guard(e);
    try {
      const origin = parseAddress(input.address);
      if (
        !/^\/api\/(v3\/(info|register|view|secrets|destination|settings|request|respond|collab-warning|collab-request|collab-respond|display-name|chat-frame|production|production-clear|output-control|recordings|recording-delete|invites|invite|invite-revoke|host-claim|host-view|host-settings|host-member|host-action|host-rotate|health)|end|allow|pip-on|pip-off|collab-on|collab-off|force-fallback|restore-primary)$/.test(
          input.route
        )
      )
        throw Error();
      const body = input.body === undefined ? undefined : JSON.stringify(input.body);
      if (body && body.length > (input.route === '/api/v3/chat-frame' ? 2500000 : 65536)) throw Error();
      if (input.token && !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{24,64}$/.test(input.token)) throw Error();
      const response = await fetch(origin + input.route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          ...(input.token ? { Authorization: 'Bearer ' + input.token } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      const reader = response.body.getReader();
      let size = 0,
        chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 262144) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(Buffer.from(value));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      // Never display arbitrary server strings: they could contain a secret or address.
      if (!response.ok) {
        const reasons = {
          HOST_HTTPS: 'Host administration requires an HTTPS control address.',
          HOST_ONLY: 'Sign in with the relay owner account.',
          MEMBER_LIMIT: 'All host-configured member slots are occupied.',
          GUEST_LIMIT: 'Guest slots are reserved or full.'
        };
        if (reasons[data.reason]) return { ok: false, error: reasons[data.reason] };
        const errors = {
          400: 'Check the entered values and collaboration approvals.',
          401: 'Check your username, join password or personal token.',
          403: 'This action is not permitted. Check the server address or approval.',
          409: 'Username is taken, server is full, or a stream must be stopped first.',
          429: 'Too many attempts. Wait one minute.'
        };
        return { ok: false, error: errors[response.status] || 'Server could not complete the request.' };
      }
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'Could not connect. Check the address, control port and server status.' };
    }
  });
  ipcMain.handle('obs-command', (e, op, input = {}) => {
    guard(e);
    const job = obsQueue.then(async () => {
      try {
        if (!obs) {
          obs = new (require('./obs-link.cjs').OBSLink)(data => {
            if (win && !win.isDestroyed()) win.webContents.send('obs-event', data);
          });
          obsControls = new (require('./obs-controls.cjs').OBSControls)(obs);
        }
        if (JSON.stringify(input).length > 16384) throw Error('OBS request is too large.');
        const file = path.join(app.getPath('userData'), 'obs-link.bin');
        const read = () => {
          try {
            return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
          } catch {
            return {};
          }
        };
        const save = value => {
          if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
          )
            throw Error('Unlock your desktop keyring to save OBS settings securely.');
          fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
          fs.renameSync(file + '.tmp', file);
        };
        if (op === 'state') return { ok: true, data: { connected: obs.ready } };
        if (op === 'connect') {
          const creds = input.discover
            ? obsCredentials ||
              read().credentials ||
              require('./obs-discovery.cjs').discover() || { port: 4455, password: '' }
            : input.retry
              ? obsCredentials || read().credentials || require('./obs-discovery.cjs').discover()
              : input.saved
                ? read().credentials
                : { port: Number(input.port), password: input.password || '' };
          if (!creds) throw Error('Enter your OBS WebSocket password.');
          obsCredentials = creds;
          await obs.connect(creds);
          obsControls.available = null;
          const data = await obsControls.init();
          if (input.remember) save({ ...read(), credentials: creds });
          return { ok: true, data };
        }
        if (op === 'disconnect') {
          obs.close();
          return { ok: true, data: { connected: false } };
        }
        if (op === 'restore') {
          const old = obsPrevious || read().previous;
          if (!old) throw Error('No previous OBS destination saved.');
          await obs.idle();
          await obs.request('SetStreamServiceSettings', old);
          return { ok: true, data: { restored: true } };
        }
        if (!['configure', 'start'].includes(op))
          return { ok: true, data: await obsControls.handle(op, input) };
        const saved = servers.load(),
          server = saved.servers.find(s => s.key === saved.selectedKey);
        if (!server || server.key !== input.serverKey) throw Error('Connect to the selected relay first.');
        const origin = parseAddress(server.address),
          headers = { Origin: origin, Authorization: 'Bearer ' + server.id + ':' + server.token };
        const request = async route => {
          const response = await fetch(origin + route, {
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) throw Error('Relay verification failed.');
          return response.json();
        };
        const view = await request('/api/v3/view'),
          secrets = await request('/api/v3/secrets');
        if (servers.load().selectedKey !== server.key) throw Error('Selected relay changed.');
        if (op === 'start' && (!view.me?.destinationConfigured || view.me.canStart === false))
          throw Error('Prepare your stream destinations before starting OBS.');
        if (
          op === 'configure' &&
          (view.status?.broadcast || ['starting', 'ending', 'held'].includes(view.status?.state))
        )
          throw Error('End the relay broadcast before changing OBS settings.');
        const u = new URL(secrets.obsServer);
        if (
          !['rtmp:', 'rtmps:'].includes(u.protocol) ||
          typeof secrets.obsKey !== 'string' ||
          secrets.obsKey.length > 4096
        )
          throw Error('Invalid relay OBS settings.');
        const configured =
          op === 'start' && input.automatic === false
            ? null
            : await obs.configure(secrets.obsServer, secrets.obsKey, old => {
                obsPrevious = old;
                try {
                  save({ ...read(), previous: old });
                } catch {
                  /* Session restoration works without a desktop keyring. */
                }
              });
        if (servers.load().selectedKey !== server.key) throw Error('Selected relay changed.');
        const data = op === 'configure' ? configured : await obs.start(secrets.obsServer, secrets.obsKey);
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: error.message || 'OBS setup failed.' };
      }
    });
    obsQueue = job.catch(() => {});
    return job;
  });
  ipcMain.handle('app-maintenance', async (e, op) => {
    guard(e);
    try {
      if (op !== 'uninstall') throw Error('Unknown app action.');
      if (studioBusy || backupBusy) throw Error('Wait for the current operation to finish.');
      return { ok: true, data: await require('./maintenance.cjs').uninstall({ app, win, dialog, shell }) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('servers-load', e => {
    guard(e);
    return servers.load();
  });
  ipcMain.handle('servers-save', (e, v) => {
    guard(e);
    return servers.save(v);
  });
  ipcMain.handle('relay-copy', (e, text) => {
    guard(e);
    if (typeof text !== 'string' || text.length > 8192) throw Error('Copy rejected.');
    clipboard.writeText(text);
  });
  ipcMain.handle('local-profile-load', e => {
    guard(e);
    return localProfiles.load();
  });
  ipcMain.handle('local-profile-save', (e, value) => {
    guard(e);
    return localProfiles.save(value);
  });
  ipcMain.handle('relay-load', e => {
    guard(e);
    if (!fs.existsSync(profilePath())) return null;
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(profilePath())));
    } catch {
      throw Error('Saved login could not be unlocked.');
    }
  });
  ipcMain.handle('relay-save', (e, profile) => {
    guard(e);
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw Error('Unlock your desktop keyring to remember this login.');
    parseAddress(profile.address);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(profile.id) || !/^[A-Za-z0-9_-]{24,64}$/.test(profile.token))
      throw Error('Invalid profile.');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(profilePath(), safeStorage.encryptString(JSON.stringify(profile)), { mode: 0o600 });
  });
  ipcMain.handle('relay-clear', e => {
    guard(e);
    fs.rmSync(profilePath(), { force: true });
  });
  ipcMain.handle('backup-command', async (e, op, input = {}) => {
    guard(e);
    if (studioBusy || backupBusy)
      return { ok: false, error: 'Wait for the current preparation or backup to finish.' };
    backupBusy = true;
    const backup = require('./backup.cjs');
    try {
      if (op === 'export') {
        const chosen = await dialog.showSaveDialog(win, {
          title: 'Save encrypted UniversalCollab backup',
          defaultPath: 'UniversalCollab-backup.ucbackup',
          filters: [{ name: 'Encrypted backup', extensions: ['ucbackup'] }]
        });
        if (chosen.canceled) return { ok: true, data: { cancelled: true } };
        const payload = {
          version: 1,
          local: localProfiles.load(),
          servers: servers.load(),
          platforms: getPlatforms().db,
          workspace: backup.workspace(input.workspace)
        };
        const encrypted = backup.seal(payload, input.password);
        fs.writeFileSync(chosen.filePath, encrypted, { mode: 0o600 });
        return { ok: true, data: { saved: true } };
      }
      if (op === 'import') {
        const selected = servers.load().servers.find(s => s.key === servers.load().selectedKey);
        if (selected) {
          try {
            const response = await fetch(parseAddress(selected.address) + '/api/v3/view', {
              headers: { Authorization: 'Bearer ' + selected.id + ':' + selected.token },
              redirect: 'error',
              signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
              const v = await response.json();
              if (v.status?.broadcast || ['starting', 'ending', 'held'].includes(v.status?.state))
                throw new PlatformError('End your broadcast before restoring a backup.');
            }
          } catch (e) {
            if (e instanceof PlatformError) throw e;
          }
        }
        const chosen = await dialog.showOpenDialog(win, {
          title: 'Restore encrypted UniversalCollab backup',
          properties: ['openFile'],
          filters: [{ name: 'Encrypted backup', extensions: ['ucbackup'] }]
        });
        if (chosen.canceled) return { ok: true, data: { cancelled: true } };
        const file = chosen.filePaths[0];
        if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('Backup is too large.');
        const v = backup.open(fs.readFileSync(file, 'utf8'), input.password);
        if (
          v.version !== 1 ||
          !v.local ||
          v.local.schemaVersion !== 1 ||
          typeof v.local.displayName !== 'string' ||
          !v.local.displayName.trim() ||
          v.local.displayName.length > 48
        )
          throw Error('Invalid local profile.');
        require('./server-store.cjs').validate(v.servers);
        backup.validatePlatforms(v.platforms);
        const workspace = backup.workspace(v.workspace);
        const result = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Cancel', 'Replace my local settings'],
          defaultId: 0,
          cancelId: 0,
          message: 'Restore this backup?',
          detail:
            'This replaces local accounts, saved servers and workspace settings. Your relay server files are not changed.'
        });
        if (result.response !== 1) return { ok: true, data: { cancelled: true } };
        const vault = createVault(app.getPath('userData'), safeStorage),
          old = { servers: servers.load(), local: localProfiles.load(), platforms: getPlatforms().db };
        try {
          servers.save(v.servers);
          localProfiles.save(v.local);
          vault.save(v.platforms);
        } catch (error) {
          try {
            servers.save(old.servers);
            if (old.local) localProfiles.save(old.local);
            vault.save(old.platforms);
          } catch {}
          throw Error('Restore failed. Existing settings were kept where possible; unlock your keyring.');
        }
        platforms?.dispose();
        platforms = null;
        studio = null;
        return { ok: true, data: { workspace, restored: true } };
      }
      throw Error('Unknown backup action.');
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof PlatformError
            ? error.message
            : op === 'import'
              ? 'Backup could not be restored. Check its password, format and your desktop keyring.'
              : 'Backup could not be saved. Use at least 12 password characters and check disk access.'
      };
    } finally {
      backupBusy = false;
    }
  });
  ipcMain.handle('platform-command', async (e, op, input) => {
    guard(e);
    try {
      if (typeof op !== 'string' || JSON.stringify(input || {}).length > 16384)
        throw new PlatformError('Invalid platform command.');
      if ((studioBusy || backupBusy) && ['disconnect', 'connect', 'configure'].includes(op))
        throw new PlatformError('Wait for stream preparation to finish before changing accounts.');
      getPlatforms();
      const data = await platforms.handle(op, input || {});
      return { ok: true, data };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof PlatformError
            ? e.message
            : 'Platform operation failed. Check your desktop keyring and connection; saved data was kept.'
      };
    }
  });
  ipcMain.handle('studio-command', (e, op, input = {}) => {
    guard(e);
    const task = studioQueue.then(async () => {
      try {
        if (backupBusy && op !== 'state') throw new PlatformError('Wait for the settings backup to finish.');
        if (JSON.stringify(input).length > 32768) throw new PlatformError('Request too large.');
        studio ??= new StudioService(getPlatforms());
        if (op === 'state') return { ok: true, data: studio.snapshot() };
        if (op === 'custom') return { ok: true, data: studio.custom(input) };
        if (op === 'remove-custom') return { ok: true, data: studio.remove(input.id) };
        if (op === 'open-tool') {
          const u = new URL(input.url);
          if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
            throw new PlatformError('Invalid tool URL.');
          await shell.openExternal(u.href);
          return { ok: true, data: {} };
        }
        if (op === 'open-youtube') {
          await shell.openExternal('https://studio.youtube.com');
          return { ok: true, data: {} };
        }
        if (op === 'metadata') return { ok: true, data: await studio.update(input) };
        const saved = servers.load(),
          server = saved.servers.find(s => s.key === input.serverKey);
        if (!server || saved.selectedKey !== server.key)
          throw new PlatformError('Select and connect to this server first.');
        const origin = parseAddress(server.address),
          headers = { Origin: origin, Authorization: 'Bearer ' + server.id + ':' + server.token };
        const request = async (route, body) => {
          const r = await fetch(origin + route, {
            method: body ? 'POST' : 'GET',
            headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(20000)
          });
          if (!r.ok)
            throw new PlatformError(
              'Relay rejected the request. Check its status, host features and destination settings.'
            );
          return r.json();
        };
        if (op === 'prepare') {
          studioBusy = true;
          const view = await request('/api/v3/view');
          if (view.capabilities?.verifiedProduction !== 2)
            throw new PlatformError('Update your relay server to 0.7.1 first.');
          if (view.status.broadcast || ['starting', 'ending', 'held'].includes(view.status.state))
            throw new PlatformError('End the current stream and stop OBS before preparing another.');
          if (input.draft.record && !view.capabilities.recording)
            throw new PlatformError('Server recording is disabled by its host.');
          if (input.draft.selected.length > 1 && view.capabilities.multipleDestinations === false)
            throw new PlatformError('Multiple destinations disabled by host.');
          const report = value => win.webContents.send?.('studio-progress', value);
          report({ message: 'Checking platform access…' });
          studio.validate(input.draft);
          if (!/^[a-f0-9-]{36}$/.test(input.draft.id)) throw new PlatformError('Click New stream first.');
          await request('/api/v3/production-clear', {});
          const production = await studio.prepare(input.draft, report);
          const current = servers.load();
          if (current.selectedKey !== server.key)
            throw new PlatformError('Selected server changed. Reconnect and retry.');
          report({ message: 'Saving selected destinations to the server…' });
          await request('/api/v3/production', production);
          report({ message: 'Verifying the server saved your destinations…' });
          const confirmed = (await request('/api/v3/view')).me?.production;
          if (
            !confirmed ||
            confirmed.id !== production.id ||
            confirmed.title !== production.title ||
            confirmed.record !== production.record ||
            JSON.stringify(confirmed.destinations.map(d => d.id)) !==
              JSON.stringify(production.destinations.map(d => d.id))
          )
            throw new PlatformError(
              'Server destinations could not be confirmed. Do not start OBS; retry preparation.'
            );
          return {
            ok: true,
            data: {
              ...studio.snapshot(),
              ready: true,
              destinations: confirmed.destinations,
              broadcastId: input.draft.selected.includes('youtube')
                ? studio.db.streamDrafts[input.draft.id].broadcastId || ''
                : ''
            }
          };
        }
        if (op === 'download') {
          if (!/^[a-f0-9-]{36}$/.test(input.id)) throw new PlatformError('Invalid recording.');
          const chosen = await dialog.showSaveDialog(win, {
            title: 'Download recording',
            defaultPath:
              (String(input.title || 'stream')
                .replace(/[^a-zA-Z0-9 _-]/g, '')
                .slice(0, 70) || 'stream') + '.ts',
            filters: [{ name: 'MPEG-TS video', extensions: ['ts'] }]
          });
          if (chosen.canceled) return { ok: true, data: { cancelled: true } };
          const tmp = chosen.filePath + '.partial-' + require('node:crypto').randomUUID();
          try {
            const r = await fetch(origin + '/api/v3/recordings/' + input.id + '/download', {
              headers,
              redirect: 'error',
              signal: AbortSignal.timeout(3600000)
            });
            if (!r.ok || !r.body) throw Error();
            const { pipeline } = require('node:stream/promises'),
              { Readable } = require('node:stream');
            await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
            fs.renameSync(tmp, chosen.filePath);
            return { ok: true, data: { saved: true } };
          } catch {
            fs.rmSync(tmp, { force: true });
            throw new PlatformError('Download did not complete. Retry when the server is available.');
          }
        }
        throw new PlatformError('Unknown studio command.');
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof PlatformError
              ? e.message
              : 'Studio action failed. Saved account settings were kept.',
          platform: ['twitch', 'youtube'].includes(e.platform) ? e.platform : '',
          reconnect: e.reason === 'reconnect'
        };
      } finally {
        if (op === 'prepare') studioBusy = false;
      }
    });
    studioQueue = task.catch(() => {});
    return task;
  });
  win.loadFile(home);
});
app.on('before-quit', () => {
  obs?.close();
  platforms?.dispose();
});
app.on('window-all-closed', () => app.quit());
