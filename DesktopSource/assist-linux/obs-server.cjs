'use strict';
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const defaults = {
  font: 'Arial',
  size: 20,
  text: '#f7f0ff',
  name: '#c8a3ff',
  background: '#251937',
  emote: 30,
  transparent: true,
  timestamps: true,
  platforms: true,
  limit: 30,
  duration: 0
};
function appearance(value = {}) {
  const p = { ...defaults };
  if (typeof value.font === 'string' && /^[\p{L}\p{N} _-]{1,80}$/u.test(value.font)) p.font = value.font;
  for (const k of ['text', 'name', 'background']) if (/^#[a-f0-9]{6}$/i.test(value[k])) p[k] = value[k];
  for (const [k, min, max] of [
    ['size', 12, 40],
    ['emote', 16, 64],
    ['limit', 1, 100],
    ['duration', 0, 600]
  ])
    if (Number.isFinite(value[k])) p[k] = Math.max(min, Math.min(max, Math.round(value[k])));
  for (const k of ['transparent', 'timestamps', 'platforms'])
    if (typeof value[k] === 'boolean') p[k] = value[k];
  return p;
}
function messages(chats, catalog) {
  return chats.slice(-100).map(a => ({
    id: a.id,
    name: a.name,
    platform: a.platform,
    received: a.received || Date.parse(a.time) || 0,
    runs: String(a.detail || '')
      .split(/(\s+)/)
      .slice(0, 256)
      .map(text => ({
        text,
        url: a.emotes?.[text] || (a.platform === 'Twitch' ? catalog[text] : null) || null
      }))
  }));
}
class ObsServer {
  constructor(port = 18743) {
    this.port = port;
    this.server = null;
    this.json = '{"messages":[]}';
    this.etag = '"0"';
  }
  publish(value) {
    const json = JSON.stringify(value);
    if (json !== this.json) {
      this.json = json;
      this.etag = '"' + crypto.createHash('sha256').update(json).digest('hex') + '"';
    }
  }
  async start(token, sendToken = null, onSend = null) {
    if (this.server) return;
    const assets = Object.fromEntries(
      ['obs.html', 'obs.css', 'obs.js'].map(n => [n, fs.readFileSync(path.join(__dirname, n))])
    );
    const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
      const host = '127.0.0.1:' + this.port;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src https://cdn.7tv.app https://static-cdn.jtvnw.net https://files.kick.com https://cdn.betterttv.net https://cdn.frankerfacez.com https://d3aqoihi2n8ty8.cloudfront.net; base-uri 'none'; frame-ancestors 'none'"
      );
      const fail = code => {
        res.writeHead(code);
        res.end('Unavailable');
      };
      if (req.method === 'POST' && req.url === '/chat-send' && sendToken && onSend) {
        if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host))
          return fail(403);
        if (req.headers.authorization !== 'Bearer ' + sendToken) return fail(401);
        const length = Number(req.headers['content-length']);
        if (req.headers['transfer-encoding'] || !Number.isInteger(length) || length < 1 || length > 4096)
          return fail(400);
        req.setTimeout(55000);
        res.setTimeout(55000);
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', c => {
          raw += c;
          if (raw.length > 4096) req.destroy();
        });
        req.on('end', async () => {
          let out;
          try {
            const body = JSON.parse(raw);
            out = await onSend(body.target, body.text);
          } catch {
            out = { error: 'Could not send. Check your connection.' };
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(out));
        });
        return;
      }
      if (req.method !== 'GET') return fail(405);
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host))
        return fail(403);
      if (req.url === '/state') {
        if (req.headers.authorization !== 'Bearer ' + token) return fail(401);
        res.setHeader('ETag', this.etag);
        if (req.headers['if-none-match'] === this.etag) {
          res.writeHead(304);
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(this.json);
      }
      const name = ['/dock', '/overlay', '/effects'].includes(req.url)
        ? 'obs.html'
        : req.url === '/obs.css'
          ? 'obs.css'
          : req.url === '/obs.js'
            ? 'obs.js'
            : null;
      if (!name) return fail(404);
      res.setHeader(
        'Content-Type',
        name.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : name.endsWith('.css')
            ? 'text/css'
            : 'text/javascript'
      );
      res.end(assets[name]);
    });
    server.maxConnections = 16;
    server.headersTimeout = 5000;
    server.requestTimeout = sendToken ? 60000 : 5000;
    server.keepAliveTimeout = 1000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        this.port = server.address().port;
        resolve();
      });
    });
    this.server = server;
  }
  stop() {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }
}
module.exports = { ObsServer, appearance, messages };
