// The Electron side of panels in their own windows: only an empty page with a panel window name may be opened, the
// new window is locked down, and panel windows close with the main window.
const assert = require('node:assert/strict');
const { openHandler, start, NAME } = require('../DesktopSource/panel-windows.cjs');

// What may be opened.
const ok = openHandler({ url: 'about:blank', frameName: 'uc-panel-obsMixer' });
assert.equal(ok.action, 'allow');
assert.deepEqual(ok.overrideBrowserWindowOptions.webPreferences, {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
});
assert.equal(ok.overrideBrowserWindowOptions.webPreferences.preload, undefined, 'no preload bridge');
for (const bad of [
  { url: 'https://example.com', frameName: 'uc-panel-x' },
  { url: 'file:///etc/passwd', frameName: 'uc-panel-x' },
  { url: 'javascript:alert(1)', frameName: 'uc-panel-x' },
  { url: 'about:blank', frameName: '' },
  { url: 'about:blank', frameName: '_blank' },
  { url: 'about:blank', frameName: 'uc-panel-' },
  { url: 'about:blank', frameName: 'uc-panel-../x' },
  { url: 'about:blank', frameName: 'uc-panel-' + 'a'.repeat(41) },
  {}
])
  assert.equal(openHandler(bad).action, 'deny', JSON.stringify(bad));
assert(NAME.test('uc-panel-obsScenes') && NAME.test('uc-panel-tool-1a2b'));

// Wiring: the new window is locked down and closes with the main window.
const events = (target = {}) => ({
  ...target,
  handlers: {},
  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
  }
});
let opener = null;
const win = events({
  webContents: events({
    setWindowOpenHandler(fn) {
      opener = fn;
    }
  })
});
const children = start(win);
assert.equal(opener({ url: 'https://evil.test', frameName: 'x' }).action, 'deny');
let closed = 0,
  menu = 'unset',
  childOpen = null,
  prevented = [];
const child = events({
  isDestroyed: () => false,
  close() {
    closed++;
  },
  setMenu(m) {
    menu = m;
  },
  webContents: events({
    setWindowOpenHandler(fn) {
      childOpen = fn;
    }
  })
});
win.webContents.handlers['did-create-window'][0](child);
assert.equal(children.size, 1);
assert.equal(menu, null);
assert.equal(childOpen({ url: 'about:blank', frameName: 'uc-panel-a' }).action, 'deny', 'no more windows');
for (const name of ['will-navigate', 'will-attach-webview']) {
  child.webContents.handlers[name][0]({ preventDefault: () => prevented.push(name) });
}
assert.deepEqual(prevented, ['will-navigate', 'will-attach-webview']);
win.handlers.closed[0]();
assert.equal(closed, 1, 'panel windows close with the main window');
child.handlers.closed[0]();
assert.equal(children.size, 0);
console.log('PASS panel windows: only empty panel pages open, locked down, close with the main window.');
