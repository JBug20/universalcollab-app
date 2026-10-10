'use strict';
// Stream Deck control (1.2.0). The UniversalCollab Stream Deck plugin connects to a local WebSocket here.
// Safety: off until enabled in Tools → Stream Deck; listens on 127.0.0.1 only; every connection must send the
// pairing token first; connections from web pages are refused (browsers always send an Origin header, the
// Stream Deck plugin does not, and the Host must be this machine). Commands run in the window through the
// same code as the buttons (remote-control.js), and the window's state is pushed back so keys can light up.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const WebSocket = require('./vendor/ws');
const PORT = 18750;
const ACTIONS = new Set([
  'stream-start',
  'stream-stop',
  'record',
  'clip',
  'end-relay',
  'afk',
  'obs-scene',
  'relay-scene',
  'studio-mode',
  'transition',
  'mute',
  'assist'
]);
const ASSIST_ACTIONS = new Set([
  'toggleSound',
  'togglePopups',
  'samples',
  'chatPopout',
  'popout',
  'connectSaved'
]);
const hash = v => crypto.createHash('sha256').update(String(v)).digest();
const sameToken = (a, b) => typeof a === 'string' && !!b && crypto.timingSafeEqual(hash(a), hash(b));

// Checks a command from the plugin before it reaches the window.
function validCommand(m) {
  if (!m || typeof m !== 'object' || !ACTIONS.has(m.action)) return null;
  if (typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id)) return null;
  const args = {};
  if (['obs-scene', 'relay-scene', 'mute'].includes(m.action)) {
    const name = m.args?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 256) return null;
    args.name = name;
  }
  if (m.action === 'assist') {
    if (!ASSIST_ACTIONS.has(m.args?.action)) return null;
    args.action = m.args.action;
  }
  return { id: m.id, action: m.action, args };
}

exports.ACTIONS = ACTIONS;
exports.ASSIST_ACTIONS = ASSIST_ACTIONS;
exports.validCommand = validCommand;
exports.PORT = PORT;
exports.start = ({ app, ipcMain, guard, getWindow, safeStorage, clipboard, port = PORT }) => {
  const file = path.join(app.getPath('userData'), 'stream-deck.json');
  let settings = { enabled: false, token: '' };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.enabled = saved.enabled === true;
    if (saved.token && safeStorage.isEncryptionAvailable())
      settings.token = safeStorage.decryptString(Buffer.from(saved.token, 'base64'));
  } catch {}
  function save() {
    if (!safeStorage.isEncryptionAvailable())
      throw Error('Unlock your desktop keyring so the Stream Deck pairing token can be stored securely.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const token = settings.token ? safeStorage.encryptString(settings.token).toString('base64') : '';
    fs.writeFileSync(file + '.tmp', JSON.stringify({ enabled: settings.enabled, token }), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  let server = null,
    error = '',
    state = null,
    stateText = '',
    sequence = 0;
  const pending = new Map();
  const clients = new Set();
  const send = (ws, value) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };

  function listen() {
    if (server) return;
    error = '';
    server = new WebSocket.Server({
      host: '127.0.0.1',
      port,
      maxPayload: 16 * 1024,
      verifyClient: ({ origin, req }) => {
        if (origin || req.headers.origin) return false;
        const host = String(req.headers.host || '');
        return host === '127.0.0.1:' + port || host === 'localhost:' + port;
      }
    });
    server.on('error', e => {
      error =
        e.code === 'EADDRINUSE'
          ? 'Port ' + port + ' is already in use. Close the other program using it, then enable again.'
          : 'Stream Deck control could not start.';
      server?.close();
      server = null;
    });
    server.on('connection', ws => {
      let authed = false,
        recent = [];
      const timer = setTimeout(() => !authed && ws.close(4401, 'Pairing token required'), 5000);
      ws.on('message', raw => {
        let m;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return ws.close(4400, 'Invalid message');
        }
        if (!authed) {
          if (m?.type !== 'hello' || !sameToken(m.token, settings.token))
            return ws.close(4401, 'Wrong pairing token');
          authed = true;
          clearTimeout(timer);
          clients.add(ws);
          send(ws, { type: 'hello', app: 'UniversalCollab', version: app.getVersion() });
          if (state) send(ws, { type: 'state', state });
          return;
        }
        if (m?.type !== 'command') return;
        const now = Date.now();
        recent = recent.filter(t => now - t < 1000);
        if (recent.length >= 10)
          return send(ws, { type: 'result', id: m.id, ok: false, error: 'Too many presses.' });
        recent.push(now);
        const c = validCommand(m);
        if (!c) return send(ws, { type: 'result', id: m.id, ok: false, error: 'Unknown or invalid action.' });
        const w = getWindow();
        if (!w || w.isDestroyed())
          return send(ws, { type: 'result', id: c.id, ok: false, error: 'UniversalCollab is not open.' });
        const internal = 'r' + ++sequence;
        const t = setTimeout(() => {
          pending.delete(internal);
          send(ws, { type: 'result', id: c.id, ok: false, error: 'UniversalCollab did not answer in time.' });
        }, 30000);
        pending.set(internal, { ws, id: c.id, timer: t });
        w.webContents.send('remote-command', { id: internal, action: c.action, args: c.args });
      });
      ws.on('close', () => {
        clearTimeout(timer);
        clients.delete(ws);
      });
      ws.on('error', () => {});
    });
  }
  function stop() {
    for (const ws of clients) ws.close(4000, 'Stream Deck control turned off');
    clients.clear();
    server?.close();
    server = null;
  }

  ipcMain.on('remote-result', (e, r) => {
    try {
      guard(e);
    } catch {
      return;
    }
    const p = pending.get(r?.id);
    if (!p) return;
    pending.delete(r.id);
    clearTimeout(p.timer);
    send(p.ws, {
      type: 'result',
      id: p.id,
      ok: r.ok === true,
      message: typeof r.message === 'string' ? r.message.slice(0, 200) : '',
      error: typeof r.error === 'string' ? r.error.slice(0, 300) : ''
    });
  });
  ipcMain.on('remote-state', (e, s) => {
    try {
      guard(e);
    } catch {
      return;
    }
    const text = JSON.stringify(s ?? null);
    if (text.length > 65536 || text === stateText) return;
    stateText = text;
    state = s;
    for (const ws of clients) send(ws, { type: 'state', state });
  });
  ipcMain.handle('remote-control', (e, input = {}) => {
    guard(e);
    const status = () => ({
      ok: true,
      enabled: !!server,
      port,
      clients: clients.size,
      paired: !!settings.token,
      error
    });
    try {
      if (input.op === 'status') return status();
      if (input.op === 'enable') {
        if (!settings.token) settings.token = crypto.randomBytes(24).toString('base64url');
        settings.enabled = true;
        save();
        listen();
        return status();
      }
      if (input.op === 'disable') {
        settings.enabled = false;
        save();
        stop();
        return status();
      }
      if (input.op === 'reset-token') {
        settings.token = crypto.randomBytes(24).toString('base64url');
        save();
        for (const ws of clients) ws.close(4401, 'Pairing token changed');
        clients.clear();
        return status();
      }
      // The token goes to the clipboard, never into the page.
      if (input.op === 'copy-token') {
        if (!settings.token) throw Error('Enable Stream Deck control first.');
        clipboard.writeText(settings.token);
        return status();
      }
      return { ok: false, error: 'Unknown request.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  app.on('before-quit', stop);
  if (settings.enabled && settings.token) listen();
  return {
    stop,
    listen,
    get server() {
      return server;
    }
  };
};
