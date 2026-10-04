const http = require('node:http'),
  crypto = require('node:crypto');
const COMMANDS = new Set(['toggleSound', 'pauseRules', 'resumeRules', 'replay', 'showChat']);
class Controls {
  constructor(dispatch, state, port = 18746) {
    this.dispatch = dispatch;
    this.state = state;
    this.port = port;
    this.server = null;
  }
  start(token) {
    if (this.server) return Promise.resolve();
    if (!/^[a-f0-9]{64}$/.test(token)) return Promise.reject(Error('Invalid control token'));
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const end = (code, data) => res.writeHead(code).end(JSON.stringify(data));
        if (req.headers.host !== '127.0.0.1:' + this.port || req.headers.origin)
          return end(403, { error: 'Forbidden' });
        const got = Buffer.from(req.headers.authorization || ''),
          want = Buffer.from('Bearer ' + token);
        if (got.length !== want.length || !crypto.timingSafeEqual(got, want))
          return end(401, { error: 'Unauthorized' });
        if (req.method === 'GET' && req.url === '/state') return end(200, this.state());
        if (req.method !== 'POST' || req.url !== '/command') return end(404, { error: 'Not found' });
        const length = Number(req.headers['content-length']);
        if (req.headers['transfer-encoding'] || !Number.isInteger(length) || length < 1 || length > 64)
          return end(413, { error: 'Invalid size' });
        let body = '';
        req.setTimeout(3000, () => req.destroy());
        req.on('data', b => {
          body += b;
          if (body.length > 64) req.destroy();
        });
        req.on('end', () => {
          if (!COMMANDS.has(body)) return end(400, { error: 'Unknown command' });
          try {
            this.dispatch(body);
            end(202, { accepted: true });
          } catch {
            end(409, { error: 'Command unavailable' });
          }
        });
      });
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      server.on('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    });
  }
  stop() {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }
}
module.exports = { Controls, COMMANDS };
