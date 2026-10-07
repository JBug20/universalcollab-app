// Crash recovery: a crashed or frozen display process is reloaded instead of leaving a blank window, and
// the reasons are written to renderer-problems.log. Runs main.cjs against a fake Electron and a fake clock.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../DesktopSource'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-recovery-')),
  userData = dir + '/client',
  logFile = userData + '/renderer-problems.log';
fs.mkdirSync(userData, { recursive: true });

// A fake clock: timers run only when the test advances time.
let clock = 0,
  nextTimer = 1;
const timers = new Map();
const fakeSetTimeout = (fn, ms) => {
  const id = nextTimer++;
  timers.set(id, { fn, at: clock + ms });
  return id;
};
const advance = ms => {
  const end = clock + ms;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    clock = due[1].at;
    due[1].fn();
  }
  clock = end;
};

let win,
  ready,
  destroyed = false,
  forcedCrashes = 0;
const loads = [],
  windowEvents = {},
  contentsEvents = {};
const electron = {
  app: {
    setName() {},
    setPath() {},
    whenReady: () => ({ then: fn => (ready = fn) }),
    getPath: () => userData,
    on() {},
    quit() {}
  },
  BrowserWindow: class {
    constructor() {
      win = this;
      this.webContents = {
        setWindowOpenHandler() {},
        on: (event, fn) => (contentsEvents[event] = fn),
        send() {},
        forcefullyCrashRenderer: () => forcedCrashes++
      };
    }
    on(event, fn) {
      windowEvents[event] = fn;
    }
    setMenu() {}
    loadFile(file) {
      loads.push(file);
    }
    isDestroyed() {
      return destroyed;
    }
  },
  ipcMain: { handle() {} },
  clipboard: { writeText() {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text'
  },
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
};
vm.runInNewContext(fs.readFileSync(root + '/main.cjs', 'utf8'), {
  require: n =>
    n === 'electron' ? electron : n.startsWith('./') ? require(root + '/' + n.slice(2)) : require(n),
  __dirname: root,
  process: { platform: 'linux' },
  setTimeout: fakeSetTimeout,
  clearTimeout: id => timers.delete(id),
  fetch,
  URL,
  AbortSignal,
  Buffer,
  console
});
ready();
const log = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''),
  gone = (reason, exitCode = 1) => contentsEvents['render-process-gone']({}, { reason, exitCode }),
  opened = loads.length;
assert.equal(opened, 1, 'the app page loads once at start');

// A frozen window that wakes up again is left alone; one that stays frozen is forced to restart.
windowEvents.unresponsive();
advance(9999);
assert.equal(forcedCrashes, 0, 'a hang is given 10 seconds');
windowEvents.responsive();
advance(30000);
assert.equal(forcedCrashes, 0, 'a window that recovers on its own is not restarted');
windowEvents.unresponsive();
advance(10000);
assert.equal(forcedCrashes, 1, 'a window frozen for 10 seconds is restarted');
assert(log().includes('unresponsive') && log().includes('forcing reload after hang'));

// A clean exit and a destroyed window are not reloaded.
gone('clean-exit', 0);
destroyed = true;
gone('oom');
destroyed = false;
advance(5000);
assert.equal(loads.length, opened, 'no reload after a clean exit or on a destroyed window');

// A crash reloads the page after half a second, up to three times.
gone('crashed', 139);
assert.equal(loads.length, opened, 'the reload waits half a second');
advance(500);
assert.equal(loads.length, opened + 1);
assert(loads.at(-1).endsWith('portal.html'));
assert(/gone crashed 139/.test(log()));
gone('killed');
advance(500);
gone('oom');
advance(500);
assert.equal(loads.length, opened + 3);
gone('crashed');
advance(5000);
assert.equal(loads.length, opened + 3, 'a fourth crash is not reloaded');
assert(log().includes('not reloading after 3 recoveries'));

// Failing to load the main page is logged; sub-frames are not.
const lines = () => log().trim().split('\n').length;
contentsEvents['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///portal.html', false);
const before = lines();
contentsEvents['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///portal.html', true);
assert.equal(lines(), before + 1);
assert(log().includes('load failed -6 ERR_FILE_NOT_FOUND'));
console.log(
  'PASS crash recovery: reload after a crash (up to three), forced restart after a 10 second hang, no reload on clean exit or destroyed window, problems logged.'
);
