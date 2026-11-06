'use strict';
// Panels in their own windows (studio-ui-v2.js "Open in a new window", e.g. for a second monitor). The window is an
// empty page named uc-panel-<id>; the panel itself is moved into it by the main window's own code. The new window
// loads nothing, has no preload, and cannot open pages, navigate or open more windows. They close with the main window.
const NAME = /^uc-panel-[A-Za-z0-9-]{1,40}$/;

// What the main window may open: only an empty page with a panel window name.
function openHandler({ url, frameName }) {
  if (url !== 'about:blank' || !NAME.test(frameName || '')) return { action: 'deny' };
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      minWidth: 240,
      minHeight: 160,
      autoHideMenuBar: true,
      backgroundColor: '#101017',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    }
  };
}

function start(win) {
  const children = new Set();
  win.webContents.setWindowOpenHandler(openHandler);
  win.webContents.on('did-create-window', child => {
    children.add(child);
    child.setMenu?.(null);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', e => e.preventDefault());
    child.webContents.on('will-attach-webview', e => e.preventDefault());
    child.on('closed', () => children.delete(child));
  });
  win.on('closed', () => {
    for (const child of children) if (!child.isDestroyed()) child.close();
  });
  return children;
}

exports.NAME = NAME;
exports.openHandler = openHandler;
exports.start = start;
