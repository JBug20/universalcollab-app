'use strict';
const path = require('node:path'),
  fs = require('node:fs');
const { spawn } = require('node:child_process');
const actions = new Set([
  'accounts',
  'notifications',
  'preferences',
  'emotes',
  'integrations',
  'pulsoid',
  'tools',
  'streamDeck',
  'collaboration',
  'obs',
  'appearance',
  'popout',
  'chatPopout',
  'samples',
  'health',
  'toggleSound',
  'togglePopups',
  'connectSaved'
]);
exports.actions = actions;
exports.start = ({ app, ipcMain, guard, getWindow }) => {
  let child = null,
    state = null,
    error = '',
    buffer = '',
    sequence = 0;
  const pending = new Map();
  const preferenceFile = path.join(app.getPath('userData'), 'integrated-assist.json');
  let preferences = { enabled: false, reconnect: false };
  try {
    preferences = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'));
  } catch {}
  function save() {
    fs.mkdirSync(path.dirname(preferenceFile), { recursive: true });
    fs.writeFileSync(preferenceFile + '.tmp', JSON.stringify(preferences));
    fs.renameSync(preferenceFile + '.tmp', preferenceFile);
  }
  function settle() {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: error || 'Assist stopped.' });
    }
    pending.clear();
  }
  function launch() {
    if (child) return;
    if (!['win32', 'linux'].includes(process.platform)) {
      error = 'Stream Assist runs on Windows and Linux.';
      return;
    }
    error = '';
    state = null;
    buffer = '';
    // Windows: the bundled C# engine. Linux: this same executable in engine mode (assist-linux/), passing on sandbox/display flags.
    const passthrough = (process.argv || []).filter(a =>
      /^--(no-sandbox|disable-gpu|ozone-platform(-hint)?=|enable-features=|disable-features=)/.test(a)
    );
    const proc =
      process.platform === 'win32'
        ? spawn(path.join(__dirname, 'assist-engine', 'CollabAssistEngine.exe'), ['--integrated'], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
          })
        : spawn(
            process.execPath,
            [...(app.isPackaged ? [] : [app.getAppPath()]), ...passthrough, '--uc-assist-engine'],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: (() => {
                const e = { ...process.env, UC_ASSIST_INTEGRATED: '1' };
                delete e.ELECTRON_RUN_AS_NODE;
                return e;
              })()
            }
          );
    child = proc;
    proc.stdin.on('error', () => {});
    proc.stderr.resume();
    // A failed spawn emits 'error' (and 'close') but never 'exit', so both paths must release the child.
    const ended = () => {
      if (child !== proc) return;
      child = null;
      state = null;
      if (!error) error = 'Assist stopped. Choose Start Assist to reconnect.';
      settle();
    };
    proc.on('error', () => {
      error = 'Could not start the bundled Assist component. Extract the complete package.';
      ended();
    });
    proc.on('exit', ended);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) {
        error = 'Assist sent an oversized response.';
        proc.kill();
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const value = JSON.parse(line);
          if (value.type === 'state') {
            const first = !state;
            state = value;
            if (first && preferences.reconnect)
              proc.stdin.write(JSON.stringify({ id: 'auto', action: 'connectSaved' }) + '\n');
          } else if (value.type === 'error' || value.type === 'notice') error = value.error;
          else if (value.type === 'focus') {
            const w = getWindow();
            if (w && !w.isDestroyed()) {
              w.restore();
              w.show();
              w.focus();
            }
          } else if (value.type === 'reply') {
            const p = pending.get(value.id);
            if (p) {
              clearTimeout(p.timer);
              pending.delete(value.id);
              p.resolve(value);
            }
          }
        } catch {
          error = 'Could not read Assist status.';
        }
      }
    });
  }
  ipcMain.handle('integrated-assist', async (event, input = {}) => {
    guard(event);
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid request.' };
    if (input.op === 'status') return { ok: true, running: !!child, state, error };
    if (input.op === 'start') {
      preferences.enabled = true;
      save();
      launch();
      await new Promise(r => setTimeout(r, 0));
      return { ok: !!child, error };
    }
    if (input.op === 'stop') {
      preferences.enabled = false;
      save();
      if (child) child.stdin.end(JSON.stringify({ id: 'stop', action: 'shutdown' }) + '\n');
      return { ok: true };
    }
    if (input.op !== 'action' || !actions.has(input.action))
      return { ok: false, error: 'Unknown Assist action.' };
    if (!child || !state) return { ok: false, error: error || 'Start Assist and wait until it is ready.' };
    if (pending.size) return { ok: false, error: 'Finish the current Assist action first.' };
    if (input.action === 'connectSaved') {
      preferences.reconnect = true;
      save();
    }
    const id = String(++sequence);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'Close any open Assist settings window and try again.' });
      }, 300000);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ id, action: input.action }) + '\n');
    });
  });
  app.on('before-quit', () => {
    if (child) {
      const proc = child;
      proc.stdin.end(JSON.stringify({ id: 'exit', action: 'shutdown' }) + '\n');
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill();
      }, 2000).unref();
    }
  });
  if (preferences.enabled) launch();
};
