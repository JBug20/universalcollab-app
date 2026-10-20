'use strict';
// Vertical clips (1.2.0), main side. After Clip, a 9:16 copy is made next to the clip: "<clip name> (vertical).mp4".
// The conversion runs in a hidden window with its own private session (no network, no permissions, no Node), which
// reads the clip and returns the result over a private ucclip:// address handled here. Only clips OBS reported
// saving in this session can be converted, one at a time.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { Readable } = require('node:stream');

const SCHEME = 'ucclip';
const PAGES = {
  '/convert.html': 'text/html; charset=utf-8',
  '/convert.js': 'text/javascript; charset=utf-8',
  '/layout.js': 'text/javascript; charset=utf-8'
};
const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const LAYOUTS = ['stack', 'blur', 'crop'];
// Must run before the app is ready (main.cjs, at the top).
exports.registerScheme = protocol =>
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);

// A byte range request ("bytes=100-" / "bytes=100-199") for a file of `size` bytes, or null for the whole file.
function range(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start, end;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : { invalid: true };
}
function verticalName(file, ext) {
  const p = path.parse(file);
  return path.join(p.dir, p.name + ' (vertical).' + ext);
}
// The facecam region and layout the window asked for, checked.
function options(i) {
  const layout = LAYOUTS.includes(i.layout) ? i.layout : 'stack';
  let facecam = null;
  const f = i.facecam;
  if (
    f &&
    ['x', 'y', 'w', 'h'].every(k => Number.isFinite(f[k]) && f[k] >= -1 && f[k] <= 2) &&
    f.w > 0 &&
    f.h > 0
  )
    facecam = { x: f.x, y: f.y, w: f.w, h: f.h };
  const share = Number.isFinite(i.share) ? Math.min(0.6, Math.max(0.2, i.share)) : 0.35;
  return { layout, facecam, share };
}
exports.range = range;
exports.verticalName = verticalName;
exports.options = options;

exports.start = ({
  ipcMain,
  guard,
  BrowserWindow,
  session,
  isClip,
  addClip = () => {},
  getWindow = () => null,
  logFile = '',
  dir = path.join(__dirname, 'vertical'),
  stallMs = 45000
}) => {
  let ses = null,
    queue = Promise.resolve(),
    queued = 0;
  const jobs = new Map();
  const waiting = () => Math.max(0, queued - 1);
  // The window shows what is happening (vertical-clip-ui.js).
  const tell = data => {
    try {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('vertical-clip', data);
    } catch {}
  };
  // A short log of each copy, to see why one was not made (app data folder, vertical-clips.log).
  const log = line => {
    if (!logFile) return;
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200000) {
        const keep = fs.readFileSync(logFile, 'utf8').slice(-100000);
        fs.writeFileSync(logFile, keep.slice(keep.indexOf('\n') + 1));
      }
      fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n');
    } catch {}
  };
  function partition() {
    if (ses) return ses;
    ses = session.fromPartition('uc-vertical-clips');
    ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', e => e.preventDefault());
    ses.protocol.handle(SCHEME, handle);
    return ses;
  }
  const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  async function handle(req) {
    const u = new URL(req.url);
    if (u.host !== 'app') return text(404, 'Not found');
    if (req.method === 'GET' && PAGES[u.pathname]) {
      const headers = { 'content-type': PAGES[u.pathname], 'cache-control': 'no-store' };
      if (u.pathname.endsWith('.html'))
        headers['content-security-policy'] =
          "default-src 'none'; script-src 'self'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'";
      return new Response(fs.readFileSync(path.join(dir, u.pathname.slice(1))), { headers });
    }
    const m = /^\/(clip|out|fail|progress)\/([A-Za-z0-9_-]{16,64})$/.exec(u.pathname);
    const job = m && jobs.get(m[2]);
    if (!job) return text(404, 'Not found');
    if (m[1] === 'clip' && req.method === 'GET') {
      const size = fs.statSync(job.file).size;
      const r = range(req.headers.get('range'), size);
      const type = TYPES[path.extname(job.file).toLowerCase()] || 'application/octet-stream';
      if (r?.invalid)
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      const { start, end } = r || { start: 0, end: size - 1 };
      const body = Readable.toWeb(fs.createReadStream(job.file, { start, end }));
      return new Response(body, {
        status: r ? 206 : 200,
        headers: {
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-length': String(end - start + 1),
          ...(r ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
        }
      });
    }
    if (m[1] === 'out' && req.method === 'POST') {
      const ext = u.searchParams.get('ext') === 'webm' ? 'webm' : 'mp4';
      const data = Buffer.from(await req.arrayBuffer());
      if (!data.length || data.length > 2 * 1024 ** 3)
        return text(400, 'The vertical copy is empty or too large.');
      const out = verticalName(job.file, ext);
      fs.writeFileSync(out, data);
      job.done({ path: out, file: path.basename(out) });
      return text(200, 'ok');
    }
    if (m[1] === 'progress' && req.method === 'POST') {
      const t = Number(u.searchParams.get('t')),
        d = Number(u.searchParams.get('d'));
      if (Number.isFinite(t) && t !== job.t) {
        job.t = t;
        job.moved = Date.now();
      }
      if (Number.isFinite(d) && d > 0) job.d = d;
      tell({ state: 'progress', file: job.file, t: job.t || 0, d: job.d || 0, waiting: waiting() });
      return text(200, 'ok');
    }
    if (m[1] === 'fail' && req.method === 'POST') {
      job.fail(Error((await req.text()).slice(0, 500) || 'The vertical copy failed.'));
      return text(200, 'ok');
    }
    return text(405, 'Not allowed');
  }
  function convert(file, opts) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(18).toString('base64url');
      let win = null,
        timer = null;
      const finish = (fn, v) => {
        clearInterval(timer);
        jobs.delete(token);
        try {
          if (win && !win.isDestroyed()) win.destroy();
        } catch {}
        fn(v);
      };
      const job = { file, moved: Date.now(), done: v => finish(resolve, v), fail: e => finish(reject, e) };
      jobs.set(token, job);
      // It plays once in real time and reports how far it is every second; if that stops moving, give up rather
      // than hold up the clips waiting after it.
      timer = setInterval(() => {
        if (Date.now() - job.moved > stallMs)
          finish(
            reject,
            Error('The clip stopped playing part way through, so the vertical copy was not finished.')
          );
      }, 2000);
      win = new BrowserWindow({
        show: false,
        width: 540,
        height: 960,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          session: partition(),
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required',
          spellcheck: false
        }
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
      win.webContents.on('render-process-gone', () => finish(reject, Error('The vertical copy stopped.')));
      win
        .loadURL(
          `${SCHEME}://app/convert.html#` + encodeURIComponent(JSON.stringify({ token, ...opts, fps: 30 }))
        )
        .catch(e => finish(reject, e));
    });
  }
  ipcMain.handle('vertical-clip', async (e, input = {}) => {
    guard(e);
    try {
      const file = typeof input.file === 'string' ? input.file : '';
      if (!file || !isClip(file) || !fs.existsSync(file)) throw Error('That clip is not available.');
      const ext = path.extname(file).toLowerCase();
      if (!TYPES[ext])
        throw Error(
          'This clip is ' +
            (ext.slice(1).toUpperCase() || 'an unknown format') +
            '. Vertical copies need MP4: in OBS, Settings → Output → Recording → Recording Format → MP4 or Hybrid MP4.'
        );
      queued++;
      tell({ state: 'queued', file, waiting: waiting() });
      log('queued ' + path.basename(file));
      const run = (queue = queue
        .catch(() => {})
        .then(() => {
          tell({ state: 'making', file, waiting: waiting() });
          log('making ' + path.basename(file));
          return convert(file, options(input));
        }));
      let data;
      try {
        data = await run;
      } catch (err) {
        log('failed ' + path.basename(file) + ': ' + err.message);
        err.logged = true;
        tell({ state: 'failed', file, error: err.message, waiting: Math.max(0, queued - 1) });
        throw err;
      } finally {
        queued--;
      }
      log('saved ' + data.file);
      tell({ state: 'done', file, out: data.path, name: data.file, waiting: waiting() });
      addClip(data.path);
      return { ok: true, data };
    } catch (err) {
      if (!err.logged) log('not made: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
};
