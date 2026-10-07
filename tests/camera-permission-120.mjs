// Camera permission: the app's own page may use a video-only camera (for the live OBS preview) and nothing
// else may use any camera, microphone or other permission. Also: a Virtual Camera the app started is switched
// off when the app quits. Runs main.cjs against a fake Electron.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../DesktopSource'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-permission-')),
  appUrl = pathToFileURL(root + '/portal.html').href;
fs.mkdirSync(dir + '/client', { recursive: true });

let ready,
  win,
  quits = 0;
const handlers = new Map(),
  appEvents = {},
  obsRequests = [];
let requestHandler,
  checkHandler,
  cameraOn = false;
const { OBSLink } = require('../DesktopSource/obs-link.cjs');
class TestOBS extends OBSLink {
  async connect() {
    this.ready = true;
    return { connected: true };
  }
  async request(type) {
    obsRequests.push(type);
    if (type === 'GetVersion')
      return {
        availableRequests: ['GetVersion', 'GetVirtualCamStatus', 'StartVirtualCam', 'StopVirtualCam']
      };
    if (type === 'GetVirtualCamStatus') return { outputActive: cameraOn };
    if (type === 'StartVirtualCam') return ((cameraOn = true), {});
    if (type === 'StopVirtualCam') return ((cameraOn = false), {});
    return {};
  }
}
const electron = {
  app: {
    setName() {},
    setPath() {},
    whenReady: () => ({ then: fn => (ready = fn) }),
    getPath: () => dir + '/client',
    on: (event, fn) => (appEvents[event] = [...(appEvents[event] || []), fn]),
    quit: () => quits++
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
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' },
  session: {
    defaultSession: {
      setPermissionRequestHandler: fn => (requestHandler = fn),
      setPermissionCheckHandler: fn => (checkHandler = fn)
    }
  }
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

// Permission requests: true only for a video-only request from the app's own main page.
const ask = (permission, details, wc = win.webContents) => {
  let answer;
  requestHandler(wc, permission, a => (answer = a), details);
  return answer;
};
const mine = { requestingUrl: appUrl, isMainFrame: true, mediaTypes: ['video'] };
assert.equal(ask('media', mine), true, 'the app page may use a video-only camera');
assert.equal(ask('media', { ...mine, mediaTypes: ['audio'] }), false, 'no microphone');
assert.equal(
  ask('media', { ...mine, mediaTypes: ['video', 'audio'] }),
  false,
  'no camera together with a microphone'
);
assert.equal(ask('media', { ...mine, mediaTypes: [] }), false);
assert.equal(ask('media', { ...mine, mediaTypes: undefined }), false);
assert.equal(ask('media', { ...mine, isMainFrame: false }), false, 'not an embedded frame');
assert.equal(ask('media', { ...mine, requestingUrl: 'https://example.com/' }), false, 'not a web page');
assert.equal(ask('media', mine, {}), false, 'not another window');
for (const other of [
  'notifications',
  'geolocation',
  'clipboard-read',
  'display-capture',
  'midi',
  'openExternal'
])
  assert.equal(ask(other, mine), false, other + ' stays denied');
assert.equal(ask('media'), false, 'a request with no details is denied');

// Permission checks (used when listing camera names).
const check = (permission, origin, details, wc = win.webContents) =>
  checkHandler(wc, permission, origin, details);
assert.equal(check('media', appUrl, { mediaType: 'video', isMainFrame: true }), true);
assert.equal(check('media', appUrl, { mediaType: 'unknown', isMainFrame: true }), true);
assert.equal(check('media', appUrl, { mediaType: 'audio', isMainFrame: true }), false);
assert.equal(check('media', 'https://example.com/', { mediaType: 'video', isMainFrame: true }), false);
assert.equal(check('media', appUrl, { mediaType: 'video', isMainFrame: false }), false);
assert.equal(check('media', appUrl, { mediaType: 'video', isMainFrame: true }, {}), false);
assert.equal(check('geolocation', appUrl, { isMainFrame: true }), false);

// Electron calls every before-quit handler in turn, as the app's own and the browser capture module's.
const quit = () => appEvents['before-quit'].forEach(fn => fn({ preventDefault: () => prevented++ }));
// Quitting: with no camera started by the app, quitting is not delayed.
const sender = { sender: win.webContents, senderFrame: { url: appUrl } };
let prevented = 0;
quit();
assert.equal(prevented, 0);
assert.equal(quits, 0);

// With a camera the app started, quitting stops it first and then quits.
await handlers.get('obs-command')(sender, 'connect', { port: 4455, password: '' });
await handlers.get('obs-command')(sender, 'virtualcam', { enabled: true });
assert.equal(cameraOn, true);
quit();
assert.equal(prevented, 1, 'the first quit request is held while the camera stops');
await new Promise(r => setTimeout(r, 50));
assert.equal(cameraOn, false, 'the camera the app started is switched off');
assert.equal(quits, 1, 'then the app quits');
quit();
assert.equal(prevented, 1, 'the second quit request goes straight through');
console.log(
  'PASS camera permission is video-only for the app page; a camera started by the app is stopped on quit.'
);
process.exit(0);
