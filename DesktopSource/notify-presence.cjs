'use strict';
const fs = require('node:fs'),
  path = require('node:path');
function currentPresence(value, server, now = Date.now()) {
  if (
    !value ||
    !server ||
    value.origin !== server.address ||
    value.user !== server.id ||
    typeof value.session !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.session) ||
    !Number.isFinite(value.updated) ||
    now - value.updated > 35000 ||
    value.updated > now + 5000
  )
    return null;
  return { connected: value.connected === true, session: value.session };
}
exports.currentPresence = currentPresence;
exports.start = ({ app, BrowserWindow, parent, servers }) => {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return;
  const file = path.join(process.env.LOCALAPPDATA, 'Notify', 'collab-presence.json');
  let popup = null,
    lastSession = '',
    lastState = '';
  const draw = online => {
    if (!popup || popup.isDestroyed()) return;
    const text = online ? 'Private Notify is connected' : 'Private Notify is disconnected';
    popup
      .loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Notify connection</title><style>body{background:#160f25;color:#f7f0ff;font:16px "Segoe UI",sans-serif;padding:30px}small{color:#c8a3ff}h1{font-size:23px}p{color:#b9a9cd;line-height:1.6}</style><small>UNIVERSALCOLLAB INTEGRATION</small><h1>${text}</h1><p>${online ? 'Collaboration requests and teammate updates are available in Notify.' : 'Open private Notify and reconnect through Integrations → UniversalCollab.'}</p><p>You can close this window and continue streaming.</p>`
          )
      )
      .catch(() => {});
  };
  const timer = setInterval(() => {
    if (parent.isDestroyed()) return;
    let state = null;
    try {
      if (fs.statSync(file).size > 4096) throw Error();
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      const saved = servers.load();
      state = currentPresence(
        value,
        saved.servers.find(s => s.key === saved.selectedKey)
      );
    } catch {}
    if (state?.connected && state.session !== lastSession) {
      lastSession = state.session;
      if (!popup || popup.isDestroyed()) {
        popup = new BrowserWindow({
          width: 540,
          height: 330,
          parent,
          show: false,
          autoHideMenuBar: true,
          resizable: false,
          backgroundColor: '#160f25',
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
        });
        popup.setMenu(null);
        popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        popup.webContents.on('will-navigate', e => e.preventDefault());
        popup.once('ready-to-show', () => {
          if (!popup?.isDestroyed()) {
            popup.show();
            popup.focus();
          }
        });
      }
      lastState = '';
    }
    const key = state?.connected ? 'connected' : 'disconnected';
    if (key !== lastState) {
      lastState = key;
      draw(key === 'connected');
    }
  }, 2500);
  app.on('before-quit', () => {
    clearInterval(timer);
    if (popup && !popup.isDestroyed()) popup.destroy();
  });
};
