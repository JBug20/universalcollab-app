const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  safeStorage,
  session,
  shell,
  dialog,
  globalShortcut
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Preserve legacy credentials and Chromium localStorage during the rename.
app.setPath('userData', path.join(app.getPath('appData'), 'Stream Relay'));
app.setName('UniversalCollab');
// Automatic settings backups (settings-backup.cjs); a restore asked for last time is done now, before settings load.
const settingsBackups = require('./settings-backup.cjs').create(app.getPath('userData'));
let restoredBackup = null;
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  try {
    restoredBackup = settingsBackups.applyPendingRestore();
  } catch {}
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      win.restore();
      win.show();
      win.focus();
    } else if (win) {
      // Opened again while this copy is still closing (e.g. waiting for OBS to close): start again once it has.
      relaunchAfterQuit = true;
    }
  });
}
let relaunchAfterQuit = false;
const localProfiles = require('./local-profile.cjs').createLocalProfileStore(app.getPath('userData'));

const servers = require('./server-store.cjs').createServerStore(
  app.getPath('userData'),
  safeStorage,
  process.platform
);
const relayOwner = require('./relay-owner.cjs'),
  ownerLabel = relayOwner.label;
let ownerKeys = null;
const home = path.join(__dirname, 'portal.html');
let win, platforms, studio;
let obs,
  bundledOBS = null,
  ownOBS = null,
  appUpdate = null,
  obsControls,
  obsPrevious,
  obsCredentials,
  obsQueue = Promise.resolve();
let studioQueue = Promise.resolve(),
  studioBusy = false,
  backupBusy = false,
  layoutMedia = null;
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
  // Camera access is limited to the app's own top-level page, video only. It is used for the live OBS Virtual Camera preview.
  const appFrame = (wc, url, mainFrame) =>
    !!win &&
    !win.isDestroyed() &&
    wc === win.webContents &&
    mainFrame !== false &&
    /^file:/i.test(String(url || ''));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details = {}) =>
    callback(
      permission === 'media' &&
        appFrame(wc, details.requestingUrl, details.isMainFrame) &&
        Array.isArray(details.mediaTypes) &&
        details.mediaTypes.length > 0 &&
        details.mediaTypes.every(t => t === 'video')
    )
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, origin, details = {}) =>
      permission === 'media' &&
      details.mediaType !== 'audio' &&
      appFrame(wc, origin || details.requestingUrl, details.isMainFrame)
  );
  win = new BrowserWindow({
    width: 1240,
    height: 920,
    minWidth: 460,
    minHeight: 640,
    title: 'UniversalCollab · ' + app.getVersion(),
    backgroundColor: '#101017',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  require('./relay-video.cjs').start({ app, ipcMain, guard });
  require('./browser-sources.cjs').start({ app, ipcMain, guard, BrowserWindow, session, mainWindow: win });
  layoutMedia = require('./layout-media.cjs').start({ app, ipcMain, guard });
  require('./assist-engine.cjs').start({ app, ipcMain, guard, getWindow: () => win });
  require('./remote-control.cjs').start({
    app,
    ipcMain,
    guard,
    getWindow: () => win,
    safeStorage,
    clipboard
  });
  require('./collaboration-service.cjs').start({ app, ipcMain, guard, servers });
  require('./local-storage.cjs').start({ app, ipcMain, guard, getOBS: () => obs });
  require('./hotkeys.cjs').start({ app, ipcMain, guard, getWindow: () => win, globalShortcut });
  // App updates from GitHub Releases (app-update.cjs): checked shortly after start and every 6 hours when
  // automatic checks are on, installed when the app closes or with Restart to update.
  appUpdate = require('./app-update.cjs').create({
    appDir: __dirname,
    userData: app.getPath('userData'),
    currentVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    notify: state => {
      if (win && !win.isDestroyed()) win.webContents.send('app-update-state', state);
    }
  });
  ipcMain.handle('app-update', async (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'status') return { ok: true, data: appUpdate.status() };
      if (input.op === 'check') return { ok: true, data: await appUpdate.check() };
      if (input.op === 'set-auto') return { ok: true, data: appUpdate.setAuto(input.auto) };
      if (input.op === 'backups')
        return {
          ok: true,
          data: {
            restored: restoredBackup && { label: restoredBackup.label, at: restoredBackup.at },
            backups: settingsBackups.list().map(({ id, label, at, bytes }) => ({ id, label, at, bytes }))
          }
        };
      if (input.op === 'restore-backup') {
        if (typeof input.id !== 'string') throw Error('Choose a backup.');
        settingsBackups.requestRestore(input.id);
        app.relaunch();
        app.quit();
        return { ok: true, data: null };
      }
      if (input.op === 'open-page') {
        const page = appUpdate.status().latest?.page;
        if (page) await shell.openExternal(page);
        return { ok: true, data: appUpdate.status() };
      }
      if (input.op === 'restart') {
        if (appUpdate.status().state !== 'ready') throw Error('No update is ready.');
        app.relaunch();
        app.quit();
        return { ok: true, data: appUpdate.status() };
      }
      throw Error('Unknown request.');
    } catch (err) {
      return { ok: false, error: err.message || 'Update failed.' };
    }
  });
  {
    const auto = () => appUpdate.status().auto && void appUpdate.check();
    setTimeout(auto, 20000);
    setInterval(auto, 6 * 60 * 60 * 1000);
  }
  // Recover from a crashed or frozen display process instead of leaving a blank window. Reasons are logged to userData/renderer-problems.log.
  {
    let crashes = 0,
      hangTimer = null;
    const note = text => {
      try {
        fs.appendFileSync(
          path.join(app.getPath('userData'), 'renderer-problems.log'),
          new Date().toISOString() + ' ' + text + '\n'
        );
      } catch {}
    };
    win.webContents.on('render-process-gone', (_e, d) => {
      note('gone ' + d.reason + ' ' + d.exitCode);
      if (d.reason === 'clean-exit' || win.isDestroyed()) return;
      if (++crashes > 3) {
        note('not reloading after 3 recoveries');
        return;
      }
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadFile(home);
      }, 500);
    });
    win.on('unresponsive', () => {
      note('unresponsive');
      clearTimeout(hangTimer);
      hangTimer = setTimeout(() => {
        if (!win.isDestroyed()) {
          note('forcing reload after hang');
          win.webContents.forcefullyCrashRenderer();
        }
      }, 10000);
    });
    win.on('responsive', () => {
      clearTimeout(hangTimer);
      hangTimer = null;
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain) note('load failed ' + code + ' ' + desc);
    });
  }
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  ownerKeys = new relayOwner.OwnerKeys({ directory: app.getPath('userData'), safeStorage });
  // Installs the relay release bundled with this app on the selected relay (owner only, signed).
  ipcMain.handle('relay-update', async (e, input = {}) => {
    guard(e);
    try {
      const release = relayOwner.bundledRelease(__dirname);
      if (input.op === 'bundled')
        return { ok: true, data: release ? { version: release.version, build: release.build } : null };
      if (input.op !== 'install') throw Error();
      if (!release) return { ok: false, error: 'This app does not include a relay update.' };
      return await relayOwner.installRelease(ownerKeys, {
        appDir: __dirname,
        origin: parseAddress(input.address),
        token: input.token
      });
    } catch {
      return { ok: false, error: 'Could not reach the relay to update it.' };
    }
  });
  ipcMain.handle('relay-request', async (e, input) => {
    guard(e);
    try {
      const origin = parseAddress(input.address);
      if (
        !/^\/api\/(v3\/(info|register|view|secrets|destination|settings|request|respond|collab-warning|collab-request|collab-respond|display-name|chat-frame|media-frame|production|production-clear|output-control|recordings|recording-delete|invites|invite|invite-revoke|host-claim|host-claim-device|host-device|host-view|host-settings|host-member|host-action|host-rotate|health)|end|allow|pip-on|pip-off|collab-on|collab-off|force-fallback|restore-primary)$/.test(
          input.route
        )
      )
        throw Error();
      let body = input.body === undefined ? undefined : JSON.stringify(input.body);
      if (
        body &&
        body.length >
          (input.route === '/api/v3/chat-frame'
            ? 2500000
            : input.route === '/api/v3/media-frame'
              ? 9000000
              : input.route === '/api/v3/settings'
                ? 262144
                : 65536)
      )
        throw Error();
      if (input.token && !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{24,64}$/.test(input.token)) throw Error();
      // Owner requests are signed with this PC's owner key for the relay (see relay-owner.cjs).
      const prepared = relayOwner.prepareOwnerRequest(ownerKeys, {
        origin,
        route: input.route,
        token: input.token,
        body,
        input: input.body
      });
      if (prepared.error) return { ok: false, error: prepared.error };
      body = prepared.body;
      const ownerHeaders = prepared.headers;
      const response = await fetch(origin + input.route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          ...(input.token ? { Authorization: 'Bearer ' + input.token } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...ownerHeaders
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
          HOST_HTTPS:
            'Owner tools need this PC to hold the relay owner key (relay 1.2.0 or newer, claimed from this PC) or an HTTPS relay address.',
          CLAIM_CODE_NEEDED:
            'Only the first account created on this relay can claim it with one click. Enter the setup code from data/host-setup-code.txt instead.',
          CLAIM_CODE_WRONG: 'That setup code is not correct.',
          CLAIMED: 'This relay already has an owner.',
          OWNER_CLOCK: 'Your PC clock is more than 5 minutes off. Correct the time and try again.',
          OWNER_SIGNATURE: 'The relay did not accept this PC as its owner.',
          UPDATE_BUSY: 'A relay update is already running.',
          UPDATE_LIVE: 'End all broadcasts on this relay before updating it.',
          UPDATE_UNSUPPORTED:
            'This relay cannot update itself yet. Upload the update files to the server once.',
          UPDATE_REJECTED: 'The relay rejected the update files and kept its current version.',
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
        // "With OBS" builds: the included copy of OBS (see bundled-obs.cjs).
        bundledOBS ||= new (require('./bundled-obs.cjs').BundledOBS)();
        if (op === 'bundled-info') return { ok: true, data: bundledOBS.info() };
        // The user's own OBS: optional start with UniversalCollab, minimized to the tray (own-obs.cjs).
        // Is OBS open (the included one, or any OBS on this PC)? Used to explain a connection that keeps failing.
        if (op === 'obs-process')
          return {
            ok: true,
            data: {
              running: input.bundled ? !!bundledOBS?.running : await require('./own-obs.cjs').running()
            }
          };
        if (op.startsWith('own-obs-')) {
          ownOBS ||= require('./own-obs.cjs').create({ app, dialog, getWindow: () => win });
          const data = await ownOBS.handle(op, input);
          if (data) return { ok: true, data };
        }
        if (op === 'bundled-show') return { ok: true, data: { shown: await bundledOBS.show() } };
        if (op === 'bundled-stop') {
          obs.close();
          await bundledOBS.stop();
          return { ok: true, data: bundledOBS.info() };
        }
        if (op === 'connect' && input.bundled === true && bundledOBS.available) {
          // Retries do not reopen OBS after the user closed it; Connect and Start do.
          if (input.retry && bundledOBS.closedByUser && !bundledOBS.running)
            throw Error('The included OBS was closed. Start it again from Settings → OBS.');
          const creds = await bundledOBS.start();
          obsCredentials = creds;
          await obs.connect(creds);
          obsControls.available = null;
          const data = await obsControls.init();
          await firstRunScene().catch(() => {});
          return { ok: true, data: { ...data, bundled: true } };
        }
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
          if (bundledOBS?.available && obsCredentials === bundledOBS.credentials) obsCredentials = null;
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
        // Show a saved clip in Explorer: only paths OBS reported for clips saved in this session.
        if (op === 'clip-show') {
          const file = typeof input.path === 'string' ? input.path : '';
          if (!file || !obsControls?.clips?.includes(file)) throw Error('That clip is not available.');
          // OBS may run on another computer; then the file is there, not on this PC.
          if (!fs.existsSync(file)) return { ok: true, data: { shown: false, path: file } };
          shell.showItemInFolder(file);
          return { ok: true, data: { shown: true, path: file } };
        }
        // Recordings folder (record-folder.cjs): checked on this PC before OBS is told to use it.
        if (op === 'record-directory' || op === 'record-dir-browse') {
          let directory = input.directory;
          if (op === 'record-dir-browse') {
            const current =
              (await obsControls.handle('settings')).record?.recordDirectory || app.getPath('videos');
            const r = await dialog.showOpenDialog(win, {
              title: 'Choose where recordings and clips are saved',
              defaultPath: current,
              properties: ['openDirectory', 'createDirectory', 'promptToCreate']
            });
            if (r.canceled || !r.filePaths[0]) return { ok: true, data: { canceled: true } };
            directory = r.filePaths[0];
          }
          directory = require('./record-folder.cjs').check(directory);
          await obsControls.handle('record-directory', { directory });
          return { ok: true, data: { directory } };
        }
        if (op === 'record-dir-open') {
          const dir = (await obsControls.handle('settings')).record?.recordDirectory;
          if (!dir || !fs.existsSync(dir)) throw Error('The recordings folder does not exist yet.');
          const failed = await shell.openPath(dir);
          if (failed) throw Error(failed);
          return { ok: true, data: { directory: dir } };
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
    const backup = require('./backup.cjs'),
      reminders = require('./reminder-backup.cjs'),
      reminderDirectory = path.join(app.getPath('userData'), 'collaboration-reminders');
    try {
      if (op === 'export') {
        const chosen = await dialog.showSaveDialog(win, {
          title: 'Save encrypted UniversalCollab backup',
          defaultPath: 'UniversalCollab-backup.ucbackup',
          filters: [{ name: 'Encrypted backup', extensions: ['ucbackup'] }]
        });
        if (chosen.canceled) return { ok: true, data: { cancelled: true } };
        const workspaceValue = backup.workspace(input.workspace),
          pictures = layoutMedia
            ? layoutMedia.read(
                [...JSON.stringify(workspaceValue).matchAll(/\\"media\\":\\"([a-f0-9]{64})\\"/g)].map(
                  m => m[1]
                )
              )
            : { media: {}, skipped: 0 };
        const payload = {
          version: 1,
          local: localProfiles.load(),
          servers: servers.load(),
          platforms: getPlatforms().db,
          workspace: workspaceValue,
          reminders: reminders.read(reminderDirectory),
          layoutMedia: pictures.media
        };
        const encrypted = backup.seal(payload, input.password);
        fs.writeFileSync(chosen.filePath, encrypted, { mode: 0o600 });
        return { ok: true, data: { saved: true, picturesSkipped: pictures.skipped } };
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
        if (fs.statSync(file).size > 16 * 1024 * 1024) throw Error('Backup is too large.');
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
        if (v.reminders !== undefined) reminders.validate(v.reminders);
        const pictures = layoutMedia ? layoutMedia.validate(v.layoutMedia) : {};
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
          old = {
            servers: servers.load(),
            local: localProfiles.load(),
            platforms: getPlatforms().db,
            reminders: reminders.read(reminderDirectory)
          };
        try {
          servers.save(v.servers);
          localProfiles.save(v.local);
          vault.save(v.platforms);
          if (v.reminders !== undefined) reminders.write(reminderDirectory, v.reminders);
          try {
            layoutMedia?.write(pictures);
          } catch {}
        } catch (error) {
          try {
            servers.save(old.servers);
            if (old.local) localProfiles.save(old.local);
            vault.save(old.platforms);
            reminders.write(reminderDirectory, old.reminders);
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
        if (op === 'kick-connect') {
          let details;
          try {
            details = await require('./kick-connect.cjs').connectKick(url => shell.openExternal(url));
          } catch (e) {
            throw new PlatformError(e.message);
          }
          const data = studio.custom({
            id: 'kick-oauth',
            name: 'Kick · ' + details.name,
            url: details.url,
            key: details.key
          });
          if (win && !win.isDestroyed()) {
            win.restore();
            win.show();
            win.focus();
          }
          return { ok: true, data };
        }
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
          const chosen = (input.draft.selected || []).map(id => ({
            r: input.draft.resolutions?.[id] || '',
            q: input.draft.qualities?.[id] || {}
          }));
          if (chosen.some(x => x.r) && !view.capabilities?.destinationResolution)
            throw new PlatformError(
              'Update the relay to support per-destination resolution before preparing this stream.'
            );
          if (
            chosen.some(
              x => x.q.bitrateKbps || x.q.fps || ['2560x1440', '1600x900', '640x360'].includes(x.r)
            ) &&
            !(view.capabilities?.destinationQuality >= 2)
          )
            throw new PlatformError(
              'Update the relay to 1.2.0 to use per-destination bitrate, frame rate, 1440p, 900p or 360p.'
            );
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
            confirmed &&
            JSON.stringify(
              confirmed.destinations.map(d => [d.resolution || null, d.bitrateKbps ?? null, d.fps ?? null])
            ) !==
              JSON.stringify(
                production.destinations.map(d => [d.resolution || null, d.bitrateKbps ?? null, d.fps ?? null])
              )
          )
            throw new PlatformError('Relay resolution settings could not be confirmed. Do not start OBS.');
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
// First start of the included OBS: add a Display Capture to the empty default scene so the
// stream shows something straight away. Runs once (marker file in the OBS config folder).
async function firstRunScene() {
  const marker = path.join(bundledOBS.found.root, 'config', 'obs-studio', 'universalcollab-setup.json');
  if (fs.existsSync(marker)) return;
  const { currentProgramSceneName: sceneName } = await obs.request('GetCurrentProgramScene');
  const { sceneItems } = await obs.request('GetSceneItemList', { sceneName });
  if (!sceneItems.length) {
    const kind = process.platform === 'win32' ? 'monitor_capture' : 'xshm_input';
    await obs.request('CreateInput', {
      sceneName,
      inputName: 'Display Capture',
      inputKind: kind,
      inputSettings: {}
    });
  }
  fs.writeFileSync(marker, JSON.stringify({ setup: new Date().toISOString() }));
}
let quitAfterCamera = false,
  quitAfterOBS = false;
app.on('before-quit', e => {
  // Close OBS with the app: the included OBS always, your own OBS when "Close my OBS when UniversalCollab
  // closes" is on (own-obs.cjs). Stop its stream and recording first so files are finished.
  let closeOwn = false;
  try {
    closeOwn =
      !bundledOBS?.running &&
      (ownOBS ||= require('./own-obs.cjs').create({ app, dialog, getWindow: () => win })).closeOnQuit;
  } catch {}
  if (!quitAfterOBS && (bundledOBS?.running || closeOwn)) {
    quitAfterOBS = true;
    e.preventDefault();
    (async () => {
      let busy = false;
      if (obs?.ready)
        try {
          const [st, rec] = await Promise.all([
            obs.request('GetStreamStatus'),
            obs.request('GetRecordStatus')
          ]);
          busy = !!(st.outputActive || rec.outputActive);
        } catch {}
      if (busy) {
        const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
          type: 'question',
          // No Cancel: the window may already be closed when the app quits.
          buttons: ['Stop and quit', 'Keep OBS running'],
          defaultId: 0,
          cancelId: 1,
          title: 'UniversalCollab',
          message: 'OBS is still streaming or recording.',
          detail:
            'Stop and quit ends the stream and recording and closes OBS. Keep OBS running leaves it going in the system tray; the app reconnects to it next time.'
        });
        if (response === 1) return app.quit();
        await Promise.race([
          Promise.all([obs.request('StopStream').catch(() => {}), obs.request('StopRecord').catch(() => {})]),
          new Promise(r => setTimeout(r, 3000))
        ]);
      }
      obs?.close();
      if (bundledOBS?.running) await bundledOBS.stop();
      else await ownOBS.close();
      app.quit();
    })().catch(() => app.quit());
    return;
  }
  if (!quitAfterCamera && obsControls?.ownVirtualCam && obs?.ready) {
    quitAfterCamera = true;
    e.preventDefault();
    Promise.race([
      obs.request('StopVirtualCam').catch(() => {}),
      new Promise(r => setTimeout(r, 1500))
    ]).finally(() => app.quit());
    return;
  }
  obs?.close();
  platforms?.dispose();
});
// Install a downloaded app update once everything else has closed.
app.on('will-quit', () => {
  if (relaunchAfterQuit) app.relaunch();
  try {
    // Back up the settings first (settings-backup.cjs), so they can be restored if the new version has a problem.
    const pendingUpdate = appUpdate?.status();
    if (pendingUpdate?.state === 'ready') {
      try {
        session.defaultSession.flushStorageData();
      } catch {}
      try {
        settingsBackups.snapshot('Before updating to ' + pendingUpdate.latest.version, {
          from: app.getVersion(),
          to: pendingUpdate.latest.version
        });
      } catch {}
    }
    appUpdate?.apply();
  } catch (e) {
    try {
      fs.appendFileSync(
        path.join(app.getPath('userData'), 'app-update.log'),
        new Date().toISOString() + ' ' + e.message + '\n'
      );
    } catch {}
  }
});
app.on('window-all-closed', () => app.quit());
