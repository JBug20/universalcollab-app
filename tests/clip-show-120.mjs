// "Show file" for a saved clip opens only a path OBS reported for a clip saved in this session. Nothing else
// can be revealed through it. Runs main.cjs against a fake Electron and a fake OBS replay buffer.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../DesktopSource'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-show-')),
  appUrl = pathToFileURL(root + '/portal.html').href,
  saved = path.join(dir, 'Replay 1.mkv'),
  elsewhere = '/definitely/not/on/this/computer/Replay 2.mkv',
  secret = path.join(dir, 'private.txt');
fs.mkdirSync(dir + '/client', { recursive: true });
fs.writeFileSync(saved, 'clip');
fs.writeFileSync(secret, 'not a clip');

let ready,
  win,
  last = '',
  active = true;
const handlers = new Map(),
  shown = [];
const { OBSLink } = require('../DesktopSource/obs-link.cjs');
class TestOBS extends OBSLink {
  async connect() {
    this.ready = true;
    return { connected: true };
  }
  async request(type) {
    if (type === 'GetVersion')
      return {
        availableRequests: [
          'GetVersion',
          'GetReplayBufferStatus',
          'SaveReplayBuffer',
          'GetLastReplayBufferReplay'
        ]
      };
    if (type === 'GetReplayBufferStatus') return { outputActive: active };
    if (type === 'SaveReplayBuffer') return (setTimeout(() => (last = nextPath), 100), {});
    if (type === 'GetLastReplayBufferReplay') return { savedReplayPath: last };
    return {};
  }
}
let nextPath = saved;
const electron = {
  app: {
    setName() {},
    setPath() {},
    whenReady: () => ({ then: fn => (ready = fn) }),
    getPath: () => dir + '/client',
    on() {},
    quit() {}
  },
  BrowserWindow: class {
    constructor() {
      win = this;
      this.webContents = { setWindowOpenHandler() {}, on() {}, send() {} };
    }
    on() {}
    setMenu() {}
    loadFile() {}
    isDestroyed() {
      return false;
    }
  },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  clipboard: { writeText() {} },
  shell: { showItemInFolder: file => shown.push(file) },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' },
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
};
vm.runInNewContext(fs.readFileSync(root + '/main.cjs', 'utf8'), {
  require: n =>
    n === 'electron'
      ? electron
      : n === './obs-link.cjs'
        ? { OBSLink: TestOBS }
        : n.startsWith('./')
          ? require(root + '/' + n.slice(2))
          : require(n),
  __dirname: root,
  process: { platform: 'linux' },
  setTimeout,
  clearTimeout,
  fetch,
  URL,
  AbortSignal,
  Buffer,
  console
});
ready();
const sender = { sender: win.webContents, senderFrame: { url: appUrl } },
  obs = (op, input = {}) => handlers.get('obs-command')(sender, op, input);
await obs('connect', { port: 4455, password: '' });

// Nothing has been saved yet, so no path can be shown, not even a real file.
for (const p of [saved, secret, '', undefined, 42, '../etc/passwd']) {
  const r = await obs('clip-show', { path: p });
  assert.equal(r.ok, false, 'before any clip: ' + String(p));
}
assert.deepEqual(shown, []);

// Save a clip: its path becomes showable, and only that path.
const clip = await obs('clip');
assert.equal(clip.ok, true);
assert.equal(clip.data.path, saved);
assert.equal((await obs('clip-show', { path: saved })).data.shown, true);
assert.deepEqual(shown, [saved]);
for (const p of [secret, '/etc/passwd', dir, saved + '/..', saved.toUpperCase()]) {
  const r = await obs('clip-show', { path: p });
  assert.equal(r.ok, false, 'not a saved clip: ' + p);
}
assert.deepEqual(shown, [saved], 'nothing else was revealed');

// OBS running on another computer: the file is not here, and the app says so instead of failing.
nextPath = elsewhere;
const remote = await obs('clip');
assert.equal(remote.data.path, elsewhere);
const elsewhereResult = (await obs('clip-show', { path: elsewhere })).data;
assert.equal(elsewhereResult.shown, false);
assert.equal(elsewhereResult.path, elsewhere);
assert.deepEqual(shown, [saved]);

// A request from anything but the app's own page is refused.
const stranger = { sender: {}, senderFrame: { url: 'https://example.com/' } };
await assert.rejects(async () => handlers.get('obs-command')(stranger, 'clip-show', { path: saved }));
console.log(
  'PASS clip Show file: only clips saved in this session can be revealed; a clip on another computer is reported, not opened.'
);
process.exit(0);
