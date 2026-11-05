'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Notification,
  safeStorage,
  screen,
  clipboard
} = require('electron');
const fs = require('node:fs'),
  path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Providers } = require('./providers.cjs');
const { make, ORIGIN, request } = require('./core.cjs');

app.setName('UniversalStream Assist Beta');
app.setPath('userData', path.join(app.getPath('appData'), 'universalstream-assist-beta-linux')); // UniversalCollab runs this app as its integrated Stream Assist engine on Linux (UC_ASSIST_INTEGRATED=1):
// hidden until opened, state on stdout and commands on stdin as JSON lines (same protocol as the Windows engine).
const INTEGRATED = process.env.UC_ASSIST_INTEGRATED === '1';
if (!app.requestSingleInstanceLock()) {
  if (INTEGRATED)
    try {
      process.stdout.write(
        JSON.stringify({
          type: 'error',
          error: 'Close the separate UniversalStream Assist app, then choose Start Assist again.'
        }) + '\n'
      );
    } catch {}
  app.exit(0);
}

const connectionNotices = new Set();
let connectionNotice = '';
let main,
  pop,
  quitting = false,
  saveTimer,
  paused = 0;
const status = {
    Account: 'Sign in to continue',
    Twitch: 'Disconnected',
    YouTube: 'Disconnected',
    Kick: 'Disconnected',
    Streamlabs: 'Disconnected'
  },
  last = {},
  codes = {};
let chats = [],
  alerts = [],
  vault = {},
  prefs = {
    remember: true,
    sound: true,
    popup: true,
    compact: false,
    retention: 7,
    filter: 'All',
    search: '',
    rules: {},
    top: false,
    updates: true
  };
let warning = '',
  vaultLocked = false;

const { ObsServer, appearance, messages: obsMessages } = require('./obs-server.cjs');
const obsServer = new ObsServer();

function obsLinks() {
  const base = 'http://127.0.0.1:' + obsServer.port;
  return obsServer.server
    ? {
        dock: base + '/dock#' + vault.obsToken,
        overlay: base + '/overlay#' + vault.obsToken,
        effects: base + '/effects#' + vault.obsToken,
        send: vault.obsSendToken ? base + '/dock#' + vault.obsToken + '.' + vault.obsSendToken : null
      }
    : null;
}
// Chat sending: one message at a time, at most one every two seconds, never retried.
let sendingChat = false,
  lastChatSend = 0;
async function sendChat(target, text) {
  if (sendingChat) return { error: 'A message is already sending.' };
  if (Date.now() - lastChatSend < 2000) return { error: 'Wait two seconds before sending again.' };
  sendingChat = true;
  lastChatSend = Date.now();
  try {
    return { results: await providers.sendChat(target, text) };
  } catch (e) {
    return { error: e.message };
  } finally {
    sendingChat = false;
  }
}

function publishObs() {
  obsServer.publish({
    style: appearance(prefs.chatStyle),
    messages: obsMessages(chats, emotes),
    pulse: pulseEffect
  });
}

async function startObs() {
  if (!vault.obsToken) {
    if (!secureReady() || vaultLocked) throw Error('Unlock your desktop keyring before enabling OBS.');
    vault.obsToken = require('./core.cjs').random();
    try {
      writeVault();
    } catch (e) {
      delete vault.obsToken;
      throw e;
    }
  }
  // The separate sending key is added when the keyring is available; the read-only dock works without it.
  if (!vault.obsSendToken && secureReady() && !vaultLocked) {
    vault.obsSendToken = require('./core.cjs').random();
    try {
      writeVault();
    } catch {
      delete vault.obsSendToken;
    }
  }
  await obsServer.start(vault.obsToken, vault.obsSendToken, sendChat);
  prefs.obsEnabled = true;
  publishObs();
  schedule();
}

let emotes = {},
  emotesAt = 0;

const file = n => path.join(app.getPath('userData'), n);
function secureReady() {
  return (
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  );
}

function writeVault() {
  if (vaultLocked)
    throw Error('Saved accounts could not be unlocked. Restart after unlocking your desktop keyring.');
  if (!secureReady()) throw Error('Unlock KWallet or a Secret Service keyring to save accounts and history.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file('vault.tmp'),
    safeStorage.encryptString(
      JSON.stringify({ vault, alerts: alerts.filter(x => !x.demo && prefs.retention > 0) })
    ),
    { mode: 0o600 }
  );
  fs.renameSync(file('vault.tmp'), file('vault.bin'));
}

function save() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file('preferences.tmp'), JSON.stringify(prefs), { mode: 0o600 });
    fs.renameSync(file('preferences.tmp'), file('preferences.json'));
    writeVault();
    warning = '';
  } catch (e) {
    warning = e.message;
  }
  broadcast();
}

function schedule() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

function prune() {
  const before = alerts.length;
  alerts = alerts
    .filter(a => a.demo || !prefs.retention || Date.parse(a.time) >= Date.now() - prefs.retention * 86400000)
    .slice(0, 2000);
  if (alerts.length !== before) schedule();
}

function snapshot() {
  prune();
  return {
    connectionNotice,
    controls: !!controls.server,
    collab: { status: collabStatus, entries: collabEntries, origin: vault.collab?.origin || '' },
    toolsStatus,
    toolActions,
    pulse: { status: pulseStatus, action: pulseAction, configured: !!vault.pulsoid },
    obs: obsLinks(),
    identities: providers.identities,
    chats,
    alerts,
    prefs,
    status,
    last,
    codes,
    warning,
    paused,
    emotes,
    version: app.getVersion(),
    signedIn: !!providers.session
  };
}

function broadcast() {
  publishObs();
  const state = snapshot();
  for (const w of [main, pop]) if (w && !w.isDestroyed()) w.webContents.send('state', state);
}

function rule(kind) {
  return prefs.rules[kind] || { sound: true, popup: true, volume: 80, file: '' };
}

let lastSound = 0;
function notify(a) {
  const r = rule(a.kind);
  if (prefs.sound && r.sound && Date.now() > paused && Date.now() - lastSound >= 1000) {
    lastSound = Date.now();
    let sound = path.join(__dirname, 'assets/notify.wav');
    if (r.file && fs.existsSync(r.file)) sound = r.file;
    try {
      if (fs.statSync(sound).size <= 20971520)
        main?.webContents.send('sound', {
          data: 'data:audio/wav;base64,' + fs.readFileSync(sound).toString('base64'),
          volume: Math.max(0, Math.min(1, r.volume / 100))
        });
    } catch {
      warning = 'Could not load notification sound.';
    }
  }
  if (prefs.popup && r.popup && Notification.isSupported()) {
    const n = new Notification({
      title: a.name + ' · ' + a.kind,
      body: a.platform + ' · ' + a.detail,
      silent: true,
      icon: path.join(__dirname, 'assets/icon.png')
    });
    n.on('click', () => {
      main.show();
      main.restore();
    });
    n.show();
  }
}

const providers = new Providers({
  remember: () => prefs.remember,
  catalog: async (user, token, signal) => {
    if (Date.now() - emotesAt < 300000) return;
    emotesAt = Date.now();
    const next = {};
    try {
      const d = await request('https://7tv.io/v3/users/twitch/' + user, { signal });
      for (const e of d.emote_set?.emotes || []) {
        const host = e.data?.host?.url;
        if (typeof host === 'string' && host.startsWith('//cdn.7tv.app/'))
          next[e.name] = 'https:' + host + '/2x.webp';
      }
    } catch {}
    try {
      const d = await request('https://api.twitch.tv/helix/chat/emotes?broadcaster_id=' + user, {
        token,
        signal,
        headers: { 'Client-Id': require('./core.cjs').TWITCH }
      });
      for (const e of d.data || [])
        next[e.name] =
          'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(e.id) + '/default/dark/2.0';
    } catch {}
    emotes = { ...(await require('./extra-emotes.cjs').load(user, request, signal)), ...next };
    broadcast();
  },
  emit: a => {
    if (a.kind === 'Chat') {
      a.received = Date.now();
      chats.push(a);
      chats = chats.slice(-500);
      broadcast();
      return;
    }
    if (!a.demo)
      runTools(toolApi.category(a.kind), {
        source: 'UniversalStream Assist',
        platform: a.platform,
        eventType: a.kind,
        viewer: a.name,
        message: a.detail
      });
    alerts.unshift(a);
    last[a.platform] = Date.now();
    prune();
    notify(a);
    schedule();
    broadcast();
  },
  status: (name, value) => {
    if (name === 'Renewal') return;
    status[name] = value;
    if (
      ['Twitch', 'Kick', 'YouTube'].includes(name) &&
      /^(Listening|Connected)/.test(value) &&
      !connectionNotices.has(name)
    ) {
      connectionNotices.add(name);
      connectionNotice = name + ' connected successfully.';
      if (main && !main.isDestroyed()) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
        main.flashFrame(true);
        main.once('focus', () => {
          if (!main.isDestroyed()) main.flashFrame(false);
        });
      }
      if (Notification.isSupported()) {
        const notice = new Notification({
          title: 'UniversalStream Assist Beta',
          body: connectionNotice,
          silent: true,
          icon: path.join(__dirname, 'assets/icon.png')
        });
        notice.show();
      }
    }
    broadcast();
  },
  device: (name, code) => {
    codes[name] = code;
    broadcast();
  },
  open: url => shell.openExternal(url),
  load: name => vault[name],
  save: (name, value) => {
    if (!secureReady()) throw Error('Unlock your desktop keyring, then reconnect.');
    vault[name] = value;
    writeVault();
  }
});

function bounds(name, fallback) {
  const b = prefs[name];
  if (
    b &&
    [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
    screen
      .getAllDisplays()
      .some(
        d =>
          b.x < d.workArea.x + d.workArea.width &&
          b.x + b.width > d.workArea.x &&
          b.y < d.workArea.y + d.workArea.height &&
          b.y + b.height > d.workArea.y
      )
  )
    return {
      ...b,
      width: Math.max(520, Math.min(2400, b.width)),
      height: Math.max(300, Math.min(1600, b.height))
    };
  return fallback;
}

function windowCreate(detached = false, hidden = false) {
  const w = new BrowserWindow({
    show: !hidden,
    ...bounds(detached ? 'popBounds' : 'mainBounds', {
      width: detached ? 850 : 1250,
      height: detached ? 480 : 850
    }),
    minWidth: 520,
    minHeight: 300,
    title:
      (INTEGRATED ? 'Stream Assist · UniversalCollab' : 'UniversalStream Assist Beta') +
      (detached ? ' — Alerts' : ''),
    backgroundColor: '#160f25',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  w.setMenuBarVisibility(false);
  w.setAlwaysOnTop(detached ? !!prefs.popTop : !!prefs.top);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.session.setPermissionRequestHandler((wc, p, cb) => cb(false));
  w.loadFile(path.join(__dirname, 'index.html'), { query: detached ? { pop: '1' } : {} });
  w.on('close', () => {
    if (!w.isMinimized() && !w.isMaximized()) prefs[detached ? 'popBounds' : 'mainBounds'] = w.getBounds();
    if (detached && !quitting) prefs.popOpen = false;
    schedule();
  });
  if (detached)
    w.on('closed', () => {
      pop = null;
    });
  return w;
}

async function checkUpdates() {
  const r = await request(ORIGIN + '/desktop-release');
  const parse = v => String(v).split('.').map(Number);
  const a = parse(r.version),
    b = parse(app.getVersion());
  const newer = a.some((n, i) => n > (b[i] || 0) && a.slice(0, i).every((x, j) => x === (b[j] || 0)));
  return newer
    ? 'New release ' + r.version + ': ' + r.notes + ' Contact the operator for a Linux build.'
    : 'You have the latest listed release.';
}

async function doAction(name, data) {
  try {
    switch (name) {
      case 'state':
        return snapshot();
      case 'controlsStart':
        if (!secureReady() || vaultLocked) throw Error('Unlock your keyring');
        if (!vault.controlToken) {
          vault.controlToken = require('./core.cjs').random();
          writeVault();
        }
        await controls.start(vault.controlToken);
        clipboard.writeText(vault.controlToken);
        break;
      case 'controlsStop':
        controls.stop();
        break;
      case 'controlsReset':
        controls.stop();
        delete vault.controlToken;
        writeVault();
        break;
      case 'collabConnect': {
        const origin = collabApi.origin(data.origin);
        if (
          !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16,256}$/.test(
            data.credential || vault.collab?.credential || ''
          )
        )
          throw Error('Enter username:personal-token');
        if (!secureReady() || vaultLocked) throw Error('Unlock the keyring');
        vault.collab = { origin, credential: data.credential || vault.collab?.credential };
        writeVault();
        connectCollab();
        break;
      }
      case 'collabStop':
        collabAbort?.abort();
        collabAbort = null;
        collabStatus = 'Disconnected';
        collabEntries = {};
        break;
      case 'collabReminder': {
        if (typeof data.title !== 'string' || data.title.length > 200 || !Number.isFinite(data.due))
          throw Error('Enter a title and time');
        prefs.collabReminder = { title: data.title, due: data.due, notified: false };
        schedule();
        break;
      }
      case 'toolsSave': {
        const c = toolApi.settings(data);
        if (!secureReady() || vaultLocked) throw Error('Unlock your keyring');
        vault.toolPassword = data.password || vault.toolPassword || '';
        vault.lumiaToken = data.token || vault.lumiaToken || '';
        writeVault();
        prefs.tools = c;
        schedule();
        toolsStatus = 'Settings saved';
        break;
      }
      case 'toolsActions': {
        const r = await toolApi.bot(Number(data.port), data.password || vault.toolPassword || '');
        toolActions = (r.actions || [])
          .filter(a => a.enabled)
          .slice(0, 2000)
          .map(a => ({ id: a.id, name: a.name }));
        toolsStatus = 'Action list loaded';
        break;
      }
      case 'pulseSave':
        await savePulse(data);
        break;
      case 'pulseStop':
        stopPulse();
        break;
      case 'pulseForget':
        stopPulse();
        delete vault.pulsoid;
        delete vault.obsPassword;
        writeVault();
        break;
      case 'pulsePreview':
        await firePulse({ ...validateRules([data])[0], name: 'Preview · ' + data.name }, 120, false, false);
        break;
      case 'pulseTestObs':
        await scene(Number(data.port), data.password || vault.obsPassword || '', null);
        return 'OBS connection works. No scene changed.';
      case 'pulseSound': {
        const r = await dialog.showOpenDialog(main, {
          filters: [{ name: 'WAV audio', extensions: ['wav'] }],
          properties: ['openFile']
        });
        if (!r.canceled) {
          const f = r.filePaths[0];
          if (fs.statSync(f).size > 20971520) throw Error('Choose a WAV under 20 MB');
          return f;
        }
        return '';
      }
      case 'chatStyle':
        prefs.chatStyle = appearance(data);
        schedule();
        break;
      case 'obsStart':
        await startObs();
        break;
      case 'obsStop':
        obsServer.stop();
        prefs.obsEnabled = false;
        schedule();
        break;
      case 'obsReset':
        obsServer.stop();
        delete vault.obsToken;
        delete vault.obsSendToken;
        await startObs();
        break;
      case 'sendChat':
        return await sendChat(data?.target, data?.text);
      case 'obsCopy':
        if (!['dock', 'overlay', 'effects', 'send'].includes(data) || !obsLinks()?.[data])
          throw Error('Enable OBS first.');
        clipboard.writeText(obsLinks()[data]);
        break;
      case 'remember':
        prefs.remember = !!data;
        if (!prefs.remember) {
          delete vault['beta-session'];
          writeVault();
        } else if (providers.session) await providers.saveSession(new AbortController().signal);
        schedule();
        break;
      case 'login':
        providers.run('Account', s => providers.login(s));
        break;
      case 'signout':
        if (providers.session) await providers.backend('/v1/session', { method: 'DELETE' }).catch(() => {});
        providers.stopAll();
        for (const key of ['twitch', 'youtube', 'streamlabs', 'beta-session']) delete vault[key];
        writeVault();
        chats = [];
        status.Account = 'Signed out';
        break;
      case 'connect':
        if (!['Twitch', 'YouTube', 'Kick', 'Streamlabs'].includes(data)) throw Error('Unknown service');
        if (data === 'Kick') {
          prefs.kickAuto = true;
          schedule();
        }
        connectionNotices.delete(data);
        connectionNotice = '';
        providers.connect(data);
        break;
      case 'disconnect':
        providers.stop(data);
        if (data === 'Kick') {
          prefs.kickAuto = false;
          schedule();
        }
        break;
      case 'forget':
        if (!['Twitch', 'YouTube', 'Kick', 'Streamlabs'].includes(data)) throw Error('Unknown service');
        if (data === 'Kick') {
          const choice = await dialog.showMessageBox(main, {
            type: 'question',
            message: 'Sign out of Kick on your shared beta account?',
            detail: 'This unlinks Kick for all devices using this beta account.',
            buttons: ['Cancel', 'Sign out'],
            cancelId: 0
          });
          if (choice.response !== 1) break;
          providers.stop(data);
          await providers.backend('/v1/kick/disconnect', { json: {} });
        } else providers.stop(data);
        delete vault[data.toLowerCase()];
        delete providers.identities[data];
        writeVault();
        status[data] = 'Signed out · Connect to choose an account';
        break;
      case 'google': {
        const r = await dialog.showOpenDialog(main, {
          filters: [{ name: 'Google Desktop JSON', extensions: ['json'] }],
          properties: ['openFile']
        });
        if (r.canceled) break;
        const p = r.filePaths[0];
        if (fs.statSync(p).size > 65536) throw Error('Credentials file too large');
        const c = JSON.parse(fs.readFileSync(p, 'utf8')).installed;
        if (!c?.client_id?.endsWith('.apps.googleusercontent.com') || typeof c.client_secret !== 'string')
          throw Error('Choose Google Desktop app credentials.');
        if (!secureReady()) throw Error('Unlock the desktop keyring first.');
        providers.stop('YouTube');
        vault['google-client'] = { client_id: c.client_id, client_secret: c.client_secret };
        delete vault.youtube;
        writeVault();
        status.YouTube = 'Credentials imported · Ready to connect';
        break;
      }
      case 'googleDefault': {
        if (!secureReady()) throw Error('Unlock the desktop keyring first.');
        providers.stop('YouTube');
        delete vault['google-client'];
        delete vault.youtube;
        writeVault();
        status.YouTube = 'Built-in sign-in · Ready to connect';
        break;
      }
      case 'streamlabs':
        if (typeof data !== 'string' || data.length < 16 || data.length > 4096)
          throw Error('Paste a valid Socket API token.');
        if (!secureReady()) throw Error('Unlock the desktop keyring first.');
        providers.stop('Streamlabs');
        vault.streamlabs = data;
        writeVault();
        break;
      case 'pop':
        if (pop && !pop.isDestroyed()) {
          pop.show();
          pop.focus();
        } else {
          pop = windowCreate(true);
          prefs.popOpen = true;
        }
        break;
      case 'dock':
        pop?.close();
        break;
      case 'main':
        main.show();
        main.restore();
        main.focus();
        break;
      case 'minimise':
        main.minimize();
        break;
      case 'settings': {
        for (const k of ['sound', 'popup', 'compact', 'updates', 'top', 'popTop'])
          if (typeof data[k] === 'boolean') prefs[k] = data[k];
        if ([0, 1, 7, 30].includes(data.retention)) prefs.retention = data.retention;
        if (['All', 'Twitch', 'YouTube', 'Kick', 'Streamlabs'].includes(data.filter))
          prefs.filter = data.filter;
        if (typeof data.search === 'string') prefs.search = data.search.slice(0, 200);
        main.setAlwaysOnTop(prefs.top);
        pop?.setAlwaysOnTop(!!prefs.popTop);
        schedule();
        break;
      }
      case 'rule': {
        if (!KINDS.includes(data.kind)) throw Error('Unknown event');
        const r = rule(data.kind);
        prefs.rules[data.kind] = {
          ...r,
          sound: !!data.sound,
          popup: !!data.popup,
          volume: Math.max(0, Math.min(100, Number(data.volume) || 0))
        };
        schedule();
        break;
      }
      case 'sound': {
        if (!KINDS.includes(data)) throw Error('Unknown event');
        const r = await dialog.showOpenDialog(main, {
          filters: [{ name: 'WAV audio', extensions: ['wav'] }],
          properties: ['openFile']
        });
        if (!r.canceled) {
          const p = r.filePaths[0];
          if (path.extname(p).toLowerCase() !== '.wav' || fs.statSync(p).size > 20971520)
            throw Error('Choose a WAV under 20 MB.');
          prefs.rules[data] = { ...rule(data), file: p };
          schedule();
        }
        break;
      }
      case 'defaultSound':
        if (KINDS.includes(data)) {
          prefs.rules[data] = { ...rule(data), file: '' };
          schedule();
        }
        break;
      case 'pause':
        paused = data ? Date.now() + 900000 : 0;
        break;
      case 'replay': {
        const a = alerts.find(x => x.id === data);
        if (a) {
          lastSound = 0;
          notify(a);
        }
        break;
      }
      case 'clearChat':
        chats = [];
        break;
      case 'sampleChat':
        for (const p of ['Twitch', 'YouTube', 'Kick'])
          chats.push(make(p, 'Chat', 'Sample viewer', 'Hello from ' + p + '!'));
        chats = chats.slice(-500);
        break;
      case 'samples': {
        alerts = alerts.filter(a => !a.demo);
        for (const [platform, kind, name] of [
          ['Twitch', 'Follow', 'LunarFox'],
          ['Twitch', 'Cheer', 'PixelPilot'],
          ['YouTube', 'SuperChat', 'NovaPlays'],
          ['Kick', 'Subscription', 'NightOwl'],
          ['Streamlabs', 'Tip', 'CozyViewer']
        ])
          alerts.unshift({ ...make(platform, kind, name, 'Sample notification'), demo: true });
        lastSound = 0;
        notify(alerts[0]);
        break;
      }
      case 'clear': {
        const r = await dialog.showMessageBox(main, {
          type: 'question',
          message: 'Delete all alert history?',
          buttons: ['Cancel', 'Delete'],
          cancelId: 0
        });
        if (r.response === 1) {
          alerts = [];
          schedule();
        }
        break;
      }
      case 'export': {
        const r = await dialog.showSaveDialog(main, {
          defaultPath: 'assist-alerts.json',
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (!r.canceled) fs.writeFileSync(r.filePath, JSON.stringify(alerts, null, 2), { mode: 0o600 });
        break;
      }
      case 'updates':
        return await checkUpdates();
      default:
        throw Error('Unknown action');
    }
    broadcast();
    return null;
  } catch (e) {
    throw Error(e.message?.slice(0, 250) || 'Action failed');
  }
}
ipcMain.handle('action', async (event, name, data) => {
  if (
    ![main, pop].some(w => w && !w.isDestroyed() && w.webContents === event.sender) ||
    !event.senderFrame?.url.startsWith(pathToFileURL(path.join(__dirname, 'index.html')).href)
  )
    throw Error('Invalid request');
  return doAction(name, data);
});

const KINDS = [
  'Follow',
  'Subscription',
  'Resubscription',
  'GiftSubscription',
  'Cheer',
  'Raid',
  'SuperChat',
  'SuperSticker',
  'NewSponsor',
  'MemberMileStone',
  'MembershipGift',
  'KicksGifted',
  'Tip'
];

app.whenReady().then(async () => {
  try {
    if (fs.existsSync(file('preferences.json')))
      Object.assign(prefs, JSON.parse(fs.readFileSync(file('preferences.json'), 'utf8')));
    if (fs.existsSync(file('vault.bin'))) {
      if (!secureReady()) throw Error('Unlock KWallet or Secret Service to load saved accounts.');
      const d = JSON.parse(safeStorage.decryptString(fs.readFileSync(file('vault.bin'))));
      vault = d.vault || {};
      alerts = prefs.retention ? d.alerts || [] : [];
    }
  } catch (e) {
    warning = e.message;
    vaultLocked = true;
  }
  if (prefs.obsEnabled)
    try {
      await startObs();
    } catch {
      warning =
        'OBS could not start. Unlock your keyring or close another copy of the app, then use Enable OBS.';
    }
  main = windowCreate(false, INTEGRATED);
  if (INTEGRATED)
    main.on('close', e => {
      if (!quitting) {
        e.preventDefault();
        main.hide();
      }
    });
  main.on('closed', () => app.quit());
  if (prefs.popOpen) pop = windowCreate(true);
  main.webContents.once('did-finish-load', async () => {
    broadcast();
    if (prefs.remember && !vaultLocked && vault['beta-session']?.token)
      providers.run('Account', s => providers.restore(s));
    if (prefs.updates)
      try {
        const message = await checkUpdates();
        if (message.startsWith('New release')) {
          warning = message;
          broadcast();
        }
      } catch {}
  });
});
app.on('second-instance', () => {
  main?.show();
  main?.restore();
});
app.on('before-quit', () => {
  quitting = true;
  controls.stop();
  collabAbort?.abort();
  clearInterval(collabReminderTimer);
  stopPulse();
  obsServer.stop();
  clearTimeout(saveTimer);
  providers.stopAll();
  save();
});

const { Engine, Pulsoid, scene, defaultRule, validateRules } = require('./pulsoid.cjs');

let pulseEngine = new Engine(),
  pulseEffect = null,
  pulseStatus = 'Stopped',
  pulseAction = '',
  pulseSceneBusy = false,
  pulseAbort = new AbortController();

const pulsoid = new Pulsoid(
  value => {
    pulseStatus = value;
    pulseEngine.reset();
    broadcast();
  },
  (bpm, stamp, now) => {
    pulseStatus = bpm + ' BPM · Rules listening';
    let sceneUsed = false;
    for (const r of pulseEngine.feed(prefs.pulseRules || [], bpm, stamp, now)) {
      firePulse(r, bpm, !sceneUsed);
      if (r.scene.trim()) sceneUsed = true;
    }
    broadcast();
  }
);

function stopPulse() {
  pulseAbort.abort();
  pulseAbort = new AbortController();
  pulsoid.stop();
  pulseEffect = null;
  pulseEngine.reset();
}

async function savePulse(data) {
  const rules = validateRules(data.rules),
    port = Number(data.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('OBS port: 1024–65535.');
  const token = String(data.token || vault.pulsoid || '').trim();
  if (token.length < 16 || token.length > 4096) throw Error('Enter your Pulsoid API token.');
  if (!secureReady() || vaultLocked) throw Error('Unlock your desktop keyring first.');
  stopPulse();
  vault.pulsoid = token;
  vault.obsPassword = data.password || vault.obsPassword || '';
  writeVault();
  prefs.pulseRules = rules;
  prefs.pulsePort = port;
  pulseEngine = new Engine();
  schedule();
  pulsoid.start(token);
}

async function firePulse(r, bpm, allowScene, automation = true) {
  if (automation)
    runTools('Pulsoid: ' + r.name, { source: 'UniversalStream Assist', heartRate: bpm, rule: r.name });
  pulseAction = r.name + ' · ' + bpm + ' BPM';
  if (r.animation)
    pulseEffect = { id: require('node:crypto').randomUUID(), text: r.name, bpm, until: Date.now() + 8000 };
  if (r.sound)
    try {
      const f = r.soundFile || path.join(__dirname, 'assets/notify.wav');
      if (path.extname(f).toLowerCase() !== '.wav' || fs.statSync(f).size > 20971520) throw Error();
      main?.webContents.send('sound', {
        data: 'data:audio/wav;base64,' + fs.readFileSync(f).toString('base64'),
        volume: 0.8
      });
    } catch {
      pulseAction += ' · Sound unavailable';
    }
  broadcast();
  if (allowScene && r.scene.trim()) {
    if (pulseSceneBusy) {
      pulseAction += ' · Scene busy (skipped)';
      return;
    }
    pulseSceneBusy = true;
    try {
      await scene(prefs.pulsePort || 4455, vault.obsPassword || '', r.scene, pulseAbort.signal);
      pulseAction += ' · Scene changed';
    } catch (e) {
      pulseAction += ' · ' + e.message;
    } finally {
      pulseSceneBusy = false;
      broadcast();
    }
  }
}

const toolApi = require('./tools.cjs');
let toolsStatus = 'Not configured',
  toolActions = [],
  toolActive = 0;
const toolLast = new Map();

async function runTools(trigger, args) {
  const c = prefs.tools,
    m = c?.mappings?.find(m => m.trigger === trigger);
  if (!m || toolActive >= 2 || Date.now() - (toolLast.get(trigger) || 0) < 5000) return;
  toolLast.set(trigger, Date.now());
  toolActive++;
  try {
    if (c.bot && m.action)
      try {
        await toolApi.bot(c.port, vault.toolPassword || '', m.action, args);
        toolsStatus = 'Streamer.bot action sent';
      } catch {
        toolsStatus = 'Streamer.bot action failed. Check server/password/action.';
      }
    if (c.lumia && m.command)
      try {
        await toolApi.lumia(vault.lumiaToken || '', m.command);
        toolsStatus += ' · Lumia command sent';
      } catch {
        toolsStatus += ' · Lumia command failed. Check token/command.';
      }
  } finally {
    toolActive--;
    broadcast();
  }
}

const collabApi = require('./collab.cjs');
let collabStatus = 'Disconnected',
  collabEntries = {},
  collabAbort;

async function connectCollab() {
  collabAbort?.abort();
  const controller = (collabAbort = new AbortController());
  collabEntries = {};
  let first = true;
  while (!controller.signal.aborted) {
    try {
      const c = vault.collab;
      const r = await fetch(c.origin + '/api/v3/view', {
        headers: { Authorization: 'Bearer ' + c.credential },
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
      });
      if ([401, 403].includes(r.status)) {
        collabStatus = 'Login rejected. Check username:personal-token.';
        broadcast();
        return;
      }
      if (!r.ok) throw Error();
      const text = await r.text();
      if (text.length > 1048576) throw Error();
      const next = collabApi.entries(JSON.parse(text));
      if (controller.signal.aborted) return;
      if (!first)
        for (const [id, value] of Object.entries(next))
          if (collabEntries[id] !== value) {
            const a = make('UniversalCollab', 'Collaboration', 'Collaboration update', value);
            alerts.unshift(a);
            notify(a);
            schedule();
          }
      first = false;
      collabEntries = next;
      collabStatus = 'Connected · Updates every 10 seconds';
    } catch {
      if (controller.signal.aborted) return;
      collabStatus = 'Unavailable · Retrying';
    }
    broadcast();
    await new Promise(resolve => {
      const id = setTimeout(done, 10000);
      function done() {
        clearTimeout(id);
        controller.signal.removeEventListener('abort', done);
        resolve();
      }
      controller.signal.addEventListener('abort', done, { once: true });
    });
  }
}

const collabReminderTimer = setInterval(() => {
  const r = prefs.collabReminder;
  if (r && !r.notified && r.title && r.due <= Date.now()) {
    r.notified = true;
    const a = make('UniversalCollab', 'Reminder', 'Session reminder', r.title);
    alerts.unshift(a);
    notify(a);
    schedule();
    broadcast();
  }
}, 10000);

const { Controls } = require('./controls.cjs');
const controls = new Controls(
  command => {
    switch (command) {
      case 'toggleSound':
        prefs.sound = !prefs.sound;
        schedule();
        break;
      case 'pauseRules':
        stopPulse();
        break;
      case 'resumeRules':
        if (!vault.pulsoid) throw Error('Configure Pulsoid first');
        pulseEngine.reset();
        pulsoid.start(vault.pulsoid);
        break;
      case 'replay':
        if (alerts[0]) {
          lastSound = 0;
          notify(alerts[0]);
        }
        break;
      case 'showChat':
        main.show();
        main.restore();
        main.webContents.send('showChat');
        break;
    }
    broadcast();
  },
  () => ({ sound: prefs.sound, rules: !['Stopped', 'Disconnected'].includes(pulseStatus) })
);

if (INTEGRATED) {
  const emit = value => {
    try {
      process.stdout.write(JSON.stringify(value) + '\n');
    } catch {}
  };
  const ACCOUNTS = ['Twitch', 'YouTube', 'Kick', 'Streamlabs'];
  const emitState = () => {
    const links = obsLinks();
    emit({
      type: 'state',
      version: app.getVersion(),
      platform: 'linux',
      sound: !!prefs.sound,
      popups: !!prefs.popup,
      error: warning || '',
      chatUrl: links?.send || '',
      accounts: ACCOUNTS.map(n => ({
        name: n,
        identity: providers.identities[n] || '',
        status: status[n] || 'Disconnected'
      })),
      alerts: alerts.slice(0, 200).map(a => ({
        id: a.id,
        time: a.time,
        platform: a.platform,
        kind: a.kind,
        name: a.name,
        detail: a.detail,
        demo: !!a.demo
      }))
    });
  };
  const views = {
    accounts: 'connections',
    notifications: 'preferences',
    preferences: 'preferences',
    emotes: 'chat',
    appearance: 'chat',
    obs: 'chat',
    chatPopout: 'chat',
    integrations: 'integrations',
    pulsoid: 'pulsoid',
    tools: 'tools-settings',
    streamDeck: 'deck-settings',
    collaboration: 'collab-settings',
    health: 'health'
  };
  const showView = view => {
    if (!main || main.isDestroyed()) throw Error('Stream Assist is still starting.');
    main.show();
    main.restore();
    main.focus();
    main.webContents
      .executeJavaScript(`document.querySelector('[data-view="${view}"]')?.click()`)
      .catch(() => {});
  };
  async function connectSaved() {
    for (let i = 0; i < 60 && !providers.session; i++) await new Promise(r => setTimeout(r, 250));
    if (!providers.session) throw Error('Sign in to your UniversalStream account in Accounts first.');
    for (const name of ['Twitch', 'YouTube', 'Streamlabs'])
      if (vault[name.toLowerCase()] && !providers.jobs.has(name)) providers.connect(name);
    if (prefs.kickAuto && !providers.jobs.has('Kick')) providers.connect('Kick');
  }
  async function command(id, action) {
    try {
      if (action === 'shutdown') {
        quitting = true;
        app.quit();
        return;
      }
      if (action === 'snapshot') {
      } else if (views[action]) showView(views[action]);
      else if (action === 'popout') await doAction('pop');
      else if (action === 'samples') await doAction('samples');
      else if (action === 'toggleSound') {
        prefs.sound = !prefs.sound;
        schedule();
        broadcast();
      } else if (action === 'togglePopups') {
        prefs.popup = !prefs.popup;
        schedule();
        broadcast();
      } else if (action === 'connectSaved') await connectSaved();
      else throw Error('Unknown Assist action.');
      emit({ type: 'reply', id, ok: true });
      emitState();
    } catch (e) {
      emit({
        type: 'reply',
        id,
        ok: false,
        error: String(e?.message || 'Could not complete this action.').slice(0, 250)
      });
    }
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 65536) input = '';
    let index;
    while ((index = input.indexOf('\n')) >= 0) {
      const line = input.slice(0, index);
      input = input.slice(index + 1);
      if (line.length > 4096) continue;
      try {
        const m = JSON.parse(line);
        if (m && typeof m.action === 'string') void command(String(m.id || ''), m.action);
      } catch {}
    }
  });
  process.stdin.on('end', () => {
    quitting = true;
    app.quit();
  });
  // Like the Windows engine, the integrated engine serves the chat dock (with sending) for the studio chat panel.
  app.whenReady().then(() => {
    emitState();
    setInterval(emitState, 1000);
    setTimeout(() => {
      if (!obsServer.server && !vaultLocked && secureReady())
        startObs()
          .then(broadcast)
          .catch(() => {});
    }, 800);
  });
}
