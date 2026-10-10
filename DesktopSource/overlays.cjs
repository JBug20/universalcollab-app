'use strict';
// Stream overlays (1.2.0): End credits and Alerts as OBS browser sources (or relay browser sources), served on this
// PC only (127.0.0.1) at http://127.0.0.1:<port>/o/<token>/credits and /alerts. The token is private: anyone with
// the link on this PC can show the overlays, nothing else. The pages are read-only views of what the window collects
// from Stream Assist (end-credits.js); they cannot change anything.
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  crypto = require('node:crypto');

const PORT = 18752;
const STATIC = {
  credits: ['credits.html', 'text/html; charset=utf-8'],
  alerts: ['alerts.html', 'text/html; charset=utf-8'],
  'credits.js': ['credits.js', 'text/javascript; charset=utf-8'],
  'alerts.js': ['alerts.js', 'text/javascript; charset=utf-8'],
  'overlay.css': ['overlay.css', 'text/css; charset=utf-8']
};
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// What the window may publish: names and short texts only, size-limited.
function clean(input) {
  const c = input?.credits || {};
  const credits = {
    title: text(c.title, 120) || 'Thanks for watching!',
    subtitle: text(c.subtitle, 200),
    speed: Math.min(200, Math.max(10, Number(c.speed) || 40)),
    loop: c.loop !== false,
    rollAt: Number.isSafeInteger(c.rollAt) ? c.rollAt : 0,
    sections: (Array.isArray(c.sections) ? c.sections : []).slice(0, 12).map(s => ({
      title: text(s?.title, 60),
      names: (Array.isArray(s?.names) ? s.names : [])
        .slice(0, 500)
        .map(n => text(n, 80))
        .filter(Boolean)
    }))
  };
  const alerts = (Array.isArray(input?.alerts) ? input.alerts : []).slice(-50).map(a => ({
    seq: Number.isSafeInteger(a?.seq) ? a.seq : 0,
    title: text(a?.title, 60),
    name: text(a?.name, 80),
    detail: text(a?.detail, 200),
    platform: text(a?.platform, 20)
  }));
  const config = {
    sound: input?.config?.sound !== false,
    seconds: Math.min(30, Math.max(2, Number(input?.config?.seconds) || 6))
  };
  return { credits, alerts, config };
}

exports.PORT = PORT;
exports.clean = clean;
exports.start = ({ app, ipcMain, guard, clipboard, dir = path.join(__dirname, 'overlays'), port = PORT }) => {
  const file = path.join(app.getPath('userData'), 'overlays.json');
  let token = '';
  try {
    token = JSON.parse(fs.readFileSync(file, 'utf8')).token || '';
  } catch {}
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ token }));
  };
  if (!/^[A-Za-z0-9_-]{22,}$/.test(token)) {
    token = crypto.randomBytes(18).toString('base64url');
    save();
  }
  let data = clean({}),
    listening = 0,
    error = '';
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const deny = (code = 404) => {
      res.writeHead(code, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end(code === 404 ? 'Not found' : 'Not allowed');
    };
    const host = String(req.headers.host || '');
    if (req.method !== 'GET' || (host !== '127.0.0.1:' + listening && host !== 'localhost:' + listening))
      return deny(403);
    const m = /^\/o\/([A-Za-z0-9_-]+)\/([a-z.-]+)$/.exec((req.url || '').split('?')[0]);
    if (!m || !same(m[1], token)) return deny();
    const headers = {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
    };
    if (m[2] === 'data.json') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json' });
      return res.end(JSON.stringify(data));
    }
    const s = STATIC[m[2]];
    if (!s) return deny();
    try {
      const body = fs.readFileSync(path.join(dir, s[0]));
      res.writeHead(200, { ...headers, 'content-type': s[1] });
      res.end(body);
    } catch {
      deny();
    }
  });
  // The usual port, or the next free one of the ten after it.
  const listen = p =>
    server
      .once('error', e => {
        if (e.code === 'EADDRINUSE' && p < port + 10) listen(p + 1);
        else error = 'Overlays are unavailable: ' + e.message;
      })
      .listen(p, '127.0.0.1', () => {
        listening = server.address().port;
        error = '';
      });
  listen(port);
  const urls = () =>
    listening
      ? {
          credits: `http://127.0.0.1:${listening}/o/${token}/credits`,
          alerts: `http://127.0.0.1:${listening}/o/${token}/alerts`
        }
      : null;
  ipcMain.handle('overlays', (e, input = {}) => {
    guard(e);
    if (input.op === 'status') return { ok: true, data: { urls: urls(), error } };
    if (input.op === 'update') {
      data = clean(input);
      return { ok: true, data: { urls: urls(), error } };
    }
    if (input.op === 'copy') {
      const u = urls()?.[input.which];
      if (!u) return { ok: false, error: error || 'Overlays are starting.' };
      clipboard.writeText(u);
      return { ok: true, data: { urls: urls(), error } };
    }
    if (input.op === 'reset-token') {
      token = crypto.randomBytes(18).toString('base64url');
      save();
      return { ok: true, data: { urls: urls(), error } };
    }
    return { ok: false, error: 'Unknown request.' };
  });
  app.on('will-quit', () => server.close());
  return { server, urls };
};
