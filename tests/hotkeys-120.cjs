// Keyboard shortcuts (1.2.0), main process: off until turned on; registered system-wide; a shortcut another program
// uses is reported; unsafe or clashing shortcuts are refused; typing a new one pauses the others; presses reach the
// window with the action (and the audio source for Mute); settings are remembered.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  hk = require('../DesktopSource/hotkeys.cjs');

assert.equal(hk.valid('Ctrl+Alt+C'), true);
assert.equal(hk.valid('Super+F9'), true);
assert.equal(hk.valid('F13'), true, 'F13–F24 alone are fine (never typed)');
assert.equal(hk.valid(''), true, 'empty = not set');
assert.equal(hk.valid('C'), false, 'a bare letter would take ordinary typing');
assert.equal(hk.valid('Shift+C'), false, 'Shift alone is not enough');
assert.equal(hk.valid('Ctrl+Ctrl+C'), false);
assert.equal(hk.valid('Ctrl+Alt+Foo'), false);
assert.equal(hk.valid('Ctrl+Alt+C; rm'), false);
assert.ok(
  !hk.ACTIONS.includes('stream-stop') && !hk.ACTIONS.includes('end-relay'),
  'no stream stop / End Relay'
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-hotkeys-'));
try {
  const registered = new Map(),
    sent = [],
    handlers = {};
  let taken = new Set(['Ctrl+Alt+T']); // another program already uses this one
  const globalShortcut = {
    register: (a, fn) => {
      if (taken.has(a) || registered.has(a)) return false;
      registered.set(a, fn);
      return true;
    },
    unregisterAll: () => registered.clear()
  };
  const win = { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
  const start = () =>
    hk.start({
      app: { getPath: () => dir, on() {} },
      ipcMain: { handle: (ch, fn) => (handlers[ch] = fn) },
      guard: () => {},
      getWindow: () => win,
      globalShortcut
    });
  start();
  const call = input => handlers.hotkeys({}, input);
  let r = call({ op: 'status' });
  assert.equal(r.data.enabled, false, 'off by default');
  assert.equal(registered.size, 0);
  assert.equal(r.data.keys.afk, 'Ctrl+Alt+A');

  r = call({ op: 'set', enabled: true });
  assert.deepEqual([...registered.keys()].sort(), ['Ctrl+Alt+A', 'Ctrl+Alt+C', 'Ctrl+Alt+M', 'Ctrl+Alt+R']);
  assert.deepEqual(r.data.failed, ['transition'], 'a shortcut in use elsewhere is reported');
  registered.get('Ctrl+Alt+A')();
  assert.deepEqual(sent.at(-1), ['hotkey', { action: 'afk' }]);
  assert.match(call({ op: 'set', keys: { clip: 'Shift+C' } }).error, /Shift alone/);
  assert.match(call({ op: 'set', keys: { clip: 'Ctrl+Alt+R' } }).error, /same shortcut/);
  assert.match(call({ op: 'set', keys: { 'stream-stop': 'Ctrl+Alt+S' } }).error, /Unknown shortcut/);
  r = call({ op: 'set', keys: { transition: 'Ctrl+Shift+F10' }, muteSource: 'Mic/Aux' });
  assert.deepEqual(r.data.failed, []);
  registered.get('Ctrl+Alt+M')();
  assert.deepEqual(sent.at(-1), ['hotkey', { action: 'mute', name: 'Mic/Aux' }]);
  // Typing a new shortcut: the others are off until done.
  call({ op: 'pause' });
  assert.equal(registered.size, 0);
  call({ op: 'resume' });
  assert.equal(registered.size, 5);
  // Remembered after a restart.
  globalShortcut.unregisterAll();
  start();
  r = handlers.hotkeys({}, { op: 'status' });
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.keys.transition, 'Ctrl+Shift+F10');
  assert.equal(r.data.muteSource, 'Mic/Aux');
  assert.equal(registered.size, 5);
  // Off: nothing registered.
  handlers.hotkeys({}, { op: 'set', enabled: false });
  assert.equal(registered.size, 0);
  console.log(
    'PASS keyboard shortcuts: off by default, safe keys only, in-use reported, pause while typing, remembered.'
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
