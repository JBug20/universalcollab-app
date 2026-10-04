'use strict';
// Browser sources for the relay layout. Each page renders off-screen on this
// computer in an isolated, non-persistent session with no preload, no Node, no
// permissions, no pop-ups, no downloads and muted audio. About one frame per
// second is captured for the editor and uploaded to the relay as an image.
const crypto = require('node:crypto');
const MAX_SOURCES = 4,
  MAX_W = 1920,
  MAX_H = 1080;
exports.start = ({ app, ipcMain, guard, BrowserWindow, session, mainWindow }) => {
  const pages = new Map();
  let isolated = null;
  function partition() {
    if (isolated) return isolated;
    isolated = session.fromPartition('uc-browser-sources');
    isolated.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', e => e.preventDefault());
    return isolated;
  }
  const even = n => Math.max(2, Math.floor(n / 2) * 2);
  function close(id) {
    const p = pages.get(id);
    if (!p) return;
    pages.delete(id);
    try {
      if (!p.win.isDestroyed()) p.win.destroy();
    } catch {}
  }
  function open(source) {
    const width = even(Math.min(MAX_W, source.width)),
      height = even(Math.min(MAX_H, source.height));
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      transparent: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: partition(),
        backgroundThrottling: false,
        spellcheck: false,
        autoplayPolicy: 'document-user-activation-required'
      }
    });
    const page = {
      win,
      url: source.url,
      width,
      height,
      pageWidth: source.pageWidth,
      image: null,
      seq: 0,
      error: '',
      sent: -1
    };
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url)) e.preventDefault();
    });
    wc.on('will-redirect', (e, url) => {
      if (!/^https?:\/\//i.test(url)) e.preventDefault();
    });
    wc.on('will-attach-webview', e => e.preventDefault());
    wc.on('did-fail-load', (_e, code, _d, _u, main) => {
      if (main && code !== -3) page.error = 'The page could not load.';
    });
    wc.on('render-process-gone', () => {
      page.error = 'The page stopped responding. Use Reload.';
    });
    wc.on('did-finish-load', () => {
      page.error = '';
      try {
        wc.setZoomFactor(width / page.pageWidth);
      } catch {}
    });
    wc.on('paint', (_e, _dirty, image) => {
      page.image = image;
      page.seq++;
    });
    wc.setFrameRate(1);
    win.loadURL(source.url).catch(() => {
      page.error = 'The page could not load.';
    });
    pages.set(source.id, page);
  }
  function encode(image) {
    const size = image.getSize(),
      bitmap = image.toBitmap();
    let opaque = true;
    for (let i = 3; i < bitmap.length; i += 4)
      if (bitmap[i] !== 255) {
        opaque = false;
        break;
      }
    const data = opaque ? image.toJPEG(88) : image.toPNG();
    return { format: opaque ? 'jpeg' : 'png', data, width: size.width, height: size.height };
  }
  ipcMain.handle('browser-source', (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'sync') {
        const ok = s =>
          /^browser:[A-Za-z0-9-]{8,64}$/.test(s?.id || '') &&
          typeof s.url === 'string' &&
          s.url.length <= 2048 &&
          /^https?:\/\/[^\s]+$/i.test(s.url) &&
          Number.isFinite(s.width) &&
          Number.isFinite(s.height) &&
          s.width >= 16 &&
          s.height >= 16 &&
          Number.isInteger(s.pageWidth) &&
          s.pageWidth >= 320 &&
          s.pageWidth <= 3840;
        const valid = (Array.isArray(input.sources) ? input.sources : []).filter(ok),
          list = valid.slice(0, MAX_SOURCES),
          keep = new Set();
        for (const s of list) {
          keep.add(s.id);
          const p = pages.get(s.id),
            w = even(Math.min(MAX_W, s.width)),
            h = even(Math.min(MAX_H, s.height));
          if (p && p.url === s.url) {
            if (p.width !== w || p.height !== h || p.pageWidth !== s.pageWidth) {
              p.width = w;
              p.height = h;
              p.pageWidth = s.pageWidth;
              try {
                p.win.setContentSize(w, h);
                p.win.webContents.setZoomFactor(w / s.pageWidth);
                p.win.webContents.invalidate();
              } catch {}
            }
            continue;
          }
          if (p) close(s.id);
          open(s);
        }
        for (const id of [...pages.keys()]) if (!keep.has(id)) close(id);
        return { ok: true, limit: MAX_SOURCES, skipped: Math.max(0, valid.length - MAX_SOURCES) };
      }
      if (input.op === 'frames') {
        const known = input.known && typeof input.known === 'object' ? input.known : {};
        const frames = [];
        for (const [id, p] of pages) {
          if (p.error) {
            frames.push({ id, error: p.error });
            continue;
          }
          if (!p.image || p.image.isEmpty() || known[id] === p.seq) continue;
          const f = encode(p.image);
          frames.push({
            id,
            seq: p.seq,
            format: f.format,
            width: f.width,
            height: f.height,
            hash: crypto.createHash('sha256').update(f.data).digest('hex'),
            data: f.data.toString('base64')
          });
        }
        return { ok: true, frames };
      }
      if (input.op === 'reload') {
        const p = pages.get(input.id);
        if (p) {
          p.error = '';
          p.win.webContents.reloadIgnoringCache();
        }
        return { ok: true };
      }
      return { ok: false, error: 'Unknown browser source action.' };
    } catch {
      return { ok: false, error: 'Browser source unavailable.' };
    }
  });
  const closeAll = () => {
    for (const id of [...pages.keys()]) close(id);
  };
  // Hidden off-screen pages must never keep the app alive after its window closes.
  app.on('before-quit', closeAll);
  mainWindow?.on('closed', closeAll);
};
