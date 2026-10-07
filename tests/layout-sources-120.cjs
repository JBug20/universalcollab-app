// Layout pictures (layout-media.cjs) and browser sources (browser-sources.cjs): validation, storage by content
// hash, backups, and the isolation settings of the hidden browser-source windows.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createLayoutMedia } = require('../DesktopSource/layout-media.cjs');
const browserSources = require('../DesktopSource/browser-sources.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-sources-'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const url = 'data:image/png;base64,' + png.toString('base64');
const hash = crypto.createHash('sha256').update(png).digest('hex');

// --- pictures
const media = createLayoutMedia(path.join(dir, 'media'));
assert.equal(media.put(url).hash, hash, 'stored under its content hash');
assert.equal(media.put(url).hash, hash, 'storing it again is harmless');
assert.equal(fs.readdirSync(path.join(dir, 'media')).length, 1);
assert.equal(media.get(hash), url);
assert.equal(media.get('../../etc/passwd'), null, 'only hashes are looked up');
assert.equal(media.get('0'.repeat(64)), null);
assert.throws(() => media.put('data:image/svg+xml;base64,PHN2Zy8+'), /PNG, JPEG or WebP/);
assert.throws(
  () => media.put('data:image/png;base64,' + Buffer.from('not a picture at all').toString('base64')),
  /PNG, JPEG or WebP/,
  'the bytes must really be a picture'
);
assert.throws(
  () =>
    media.put(
      'data:image/png;base64,' +
        Buffer.concat([png.subarray(0, 8), Buffer.alloc(9 * 1024 * 1024)]).toString('base64')
    ),
  /8 MB/
);
// backups
const { media: out, skipped } = media.read([hash, hash, 'f'.repeat(64)]);
assert.deepEqual(Object.keys(out), [hash]);
assert.equal(skipped, 0);
assert.equal(media.read([hash], 10).skipped, 1, 'pictures over the backup limit are skipped, not truncated');
const other = createLayoutMedia(path.join(dir, 'restored'));
other.write(media.validate(out));
assert.equal(other.get(hash), url, 'a restored backup brings the picture back');
assert.deepEqual(media.validate(undefined), {});
assert.throws(
  () => media.validate({ [hash]: 'png:' + Buffer.from('tampered').toString('base64') }),
  /Invalid/
);
assert.throws(
  () => media.validate({ ['a'.repeat(64)]: 'png:' + png.toString('base64') }),
  /Invalid/,
  'hash must match'
);
assert.throws(() => media.validate([]), /Invalid/);

// --- browser sources
const handlers = new Map(),
  windows = [],
  appEvents = {};
class Window {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.events = {};
    this.loaded = null;
    this.webContents = {
      muted: false,
      rate: 0,
      opened: null,
      on: (n, f) => (this.events[n] = f),
      setAudioMuted: v => (this.webContents.muted = v),
      setWindowOpenHandler: f => (this.webContents.opened = f),
      setFrameRate: v => (this.webContents.rate = v),
      setZoomFactor() {},
      invalidate() {},
      reloadIgnoringCache: () => (this.reloaded = true)
    };
    windows.push(this);
  }
  loadURL(u) {
    this.loaded = u;
    return Promise.resolve();
  }
  setContentSize() {}
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  on() {}
}
const part = { perm: null, check: null, download: null };
const session = {
  fromPartition: name => {
    part.name = name;
    return {
      setPermissionRequestHandler: f => (part.perm = f),
      setPermissionCheckHandler: f => (part.check = f),
      on: (n, f) => (part.download = f)
    };
  }
};
browserSources.start({
  app: { on: (n, f) => (appEvents[n] = f) },
  ipcMain: { handle: (n, f) => handlers.set(n, f) },
  guard() {},
  BrowserWindow: Window,
  session,
  mainWindow: { on() {} }
});
const call = input => handlers.get('browser-source')({}, input);
const source = (n, extra = {}) => ({
  id: 'browser:source-' + n,
  url: 'https://example.com/' + n,
  width: 640,
  height: 360,
  pageWidth: 1280,
  ...extra
});
let r = call({
  op: 'sync',
  sources: [
    source(1),
    source(2, { url: 'file:///etc/passwd' }),
    source(3, { url: 'javascript:alert(1)' }),
    source(4, { id: 'bad id' }),
    source(5, { pageWidth: 10 })
  ]
});
assert.equal(r.ok, true);
assert.equal(windows.length, 1, 'only the valid http(s) source opens');
const w = windows[0],
  prefs = w.options.webPreferences;
assert.equal(w.options.show, false);
assert.equal(prefs.offscreen, true);
assert.equal(prefs.sandbox, true);
assert.equal(prefs.contextIsolation, true);
assert.equal(prefs.nodeIntegration, false);
assert.equal(prefs.preload, undefined, 'no preload bridge in browser sources');
assert.equal(part.name, 'uc-browser-sources', 'a named session without "persist:" is not saved to disk');
assert.equal(w.webContents.muted, true);
assert.equal(w.webContents.rate, 1);
assert.deepEqual(w.webContents.opened(), { action: 'deny' });
let denied = null;
part.perm({}, 'camera', v => (denied = v));
assert.equal(denied, false);
assert.equal(part.check(), false);
let prevented = false;
part.download({ preventDefault: () => (prevented = true) });
assert.equal(prevented, true);
for (const [bad, ok] of [
  ['file:///etc/passwd', false],
  ['chrome://gpu', false],
  ['https://example.org/', true]
]) {
  let stopped = false;
  w.events['will-navigate']({ preventDefault: () => (stopped = true) }, bad);
  assert.equal(stopped, !ok, bad);
}
assert.equal(w.loaded, 'https://example.com/1');
// the same page is reused, a changed URL reopens it, removal closes it, and the limit is four
r = call({ op: 'sync', sources: [source(1)] });
assert.equal(windows.length, 1);
r = call({ op: 'sync', sources: [source(1, { url: 'https://example.com/changed' })] });
assert.equal(windows.length, 2);
assert.equal(w.destroyed, true);
r = call({ op: 'sync', sources: [1, 2, 3, 4, 5, 6].map(n => source(n)) });
assert.equal(r.limit, 4);
assert.equal(r.skipped, 2);
assert.equal(windows.filter(x => !x.destroyed).length, 4);
// frames: nothing painted yet means nothing to send; errors are reported
assert.deepEqual(call({ op: 'frames' }).frames, []);
const live = windows.filter(x => !x.destroyed)[0];
live.events['render-process-gone']();
assert.match(call({ op: 'frames' }).frames[0].error, /stopped responding/);
call({ op: 'reload', id: 'browser:source-1' });
assert.equal(call({ op: 'bogus' }).ok, false);
r = call({ op: 'sync', sources: [] });
assert.equal(windows.filter(x => !x.destroyed).length, 0, 'removed sources close their windows');
call({ op: 'sync', sources: [source(7)] });
appEvents['before-quit']();
assert.equal(windows.filter(x => !x.destroyed).length, 0, 'quitting closes every hidden page');
console.log('PASS layout pictures and browser sources: validation, storage, backups and isolation.');
