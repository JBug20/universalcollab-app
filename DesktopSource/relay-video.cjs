'use strict';
const http = require('node:http'),
  https = require('node:https'),
  crypto = require('node:crypto');
exports.start = ({ app, ipcMain, guard }) => {
  let target = null,
    active = null,
    server;
  const stop = () => {
    target = null;
    active?.destroy();
    active = null;
  };
  const ready = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const t = target;
      if (
        !t ||
        req.method !== 'GET' ||
        req.url !== '/' + t.key ||
        req.headers.host !== '127.0.0.1:' + server.address().port
      ) {
        res.writeHead(404).end();
        return;
      }
      active?.destroy();
      const upstream = (t.url.protocol === 'https:' ? https : http).request(
        t.url,
        { headers: { Authorization: 'Bearer ' + t.token, Origin: t.url.origin } },
        response => {
          if (
            response.statusCode !== 200 ||
            !String(response.headers['content-type']).startsWith('video/mp4')
          ) {
            response.resume();
            res.writeHead(502).end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
          response.pipe(res);
          response.on('error', () => res.destroy());
          response.on('close', () => res.destroy());
        }
      );
      active = upstream;
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.on('error', () => res.destroy());
      res.on('close', () => upstream.destroy());
      upstream.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  ipcMain.handle('relay-video', async (e, input) => {
    guard(e);
    if (input?.op === 'stop') {
      stop();
      return { ok: true };
    }
    try {
      const u = new URL(input.address);
      if (
        !['http:', 'https:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash ||
        !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{24,64}$/.test(input.token)
      )
        throw Error();
      await ready;
      stop();
      target = {
        url: new URL('/api/v3/preview.mp4', u),
        token: input.token,
        key: crypto.randomBytes(32).toString('hex')
      };
      return { ok: true, url: 'http://127.0.0.1:' + server.address().port + '/' + target.key };
    } catch {
      return { ok: false, error: 'Video preview could not start.' };
    }
  });
  app.on('before-quit', () => {
    stop();
    server?.close();
  });
};
