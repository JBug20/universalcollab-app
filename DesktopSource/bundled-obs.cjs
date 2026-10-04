'use strict';
// "With OBS" builds ship a portable copy of OBS Studio in an `obs-studio` folder next to the app.
// This module sets it up (WebSocket on, no first-run wizard, no self-updates, starts in the tray),
// starts it hidden, and closes it when the app quits. Standard builds have no `obs-studio` folder,
// so everything here reports "not available" and the app keeps using the user's own OBS.
const fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  crypto = require('node:crypto'),
  { spawn, execFile } = require('node:child_process');

const PORT = 4466; // not OBS's default 4455, so a separately installed OBS can keep its own port
const ARGS = [
  '--portable',
  '--minimize-to-tray',
  '--disable-updater',
  '--disable-missing-files-check',
  '--multi'
];

function locate({ env = process.env, execPath = process.execPath, platform = process.platform } = {}) {
  const roots = [env.UC_BUNDLED_OBS, path.join(path.dirname(execPath), 'obs-studio')].filter(Boolean);
  const exe =
    platform === 'win32' ? path.join('bin', '64bit', 'obs64.exe') : path.join('bin', '64bit', 'obs');
  for (const root of roots) {
    const file = path.join(root, exe);
    try {
      if (fs.statSync(file).isFile()) return { root, exe: file, cwd: path.dirname(file) };
    } catch {}
  }
  return null;
}

// INI files: only fill in keys that are missing, so changes made in OBS itself are kept.
function iniMerge(file, wanted) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {}
  const sections = new Map(),
    order = [];
  let current = '';
  sections.set('', []);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) {
      current = m[1];
      if (!sections.has(current)) (sections.set(current, []), order.push(current));
    } else if (line.trim()) sections.get(current).push(line);
  }
  for (const [section, keys] of Object.entries(wanted)) {
    if (!sections.has(section)) (sections.set(section, []), order.push(section));
    const lines = sections.get(section);
    for (const [k, v] of Object.entries(keys))
      if (!lines.some(l => l.split('=')[0].trim() === k)) lines.push(k + '=' + v);
  }
  const out = [...sections.get('')];
  for (const s of order) out.push('[' + s + ']', ...sections.get(s), '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join('\r\n'));
}

function prepare(found) {
  const config = path.join(found.root, 'config', 'obs-studio');
  fs.writeFileSync(path.join(found.root, 'portable_mode.txt'), '');
  const general = {
    General: {
      FirstRun: 'true',
      EnableAutoUpdates: 'false',
      WarnBeforeStartingStream: 'false',
      WarnBeforeStoppingStream: 'false',
      WarnBeforeStoppingRecord: 'false'
    },
    BasicWindow: {
      SysTrayEnabled: 'true',
      SysTrayWhenStarted: 'true',
      SysTrayMinimizeToTray: 'false'
    }
  };
  // OBS 30 keeps these in global.ini; OBS 31+ moved user settings to user.ini.
  iniMerge(path.join(config, 'global.ini'), general);
  iniMerge(path.join(config, 'user.ini'), general);
  const wsFile = path.join(config, 'plugin_config', 'obs-websocket', 'config.json');
  let ws = {};
  try {
    ws = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  } catch {}
  if (typeof ws.server_password !== 'string' || ws.server_password.length < 16)
    ws.server_password = crypto.randomBytes(18).toString('base64url');
  ws = {
    ...ws,
    first_load: false,
    alerts_enabled: false,
    server_enabled: true,
    auth_required: true,
    server_port: Number.isInteger(ws.server_port) ? ws.server_port : PORT
  };
  fs.mkdirSync(path.dirname(wsFile), { recursive: true });
  fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  return { port: ws.server_port, password: ws.server_password };
}

function clearSentinels(found) {
  const dir = path.join(found.root, 'config', 'obs-studio', '.sentinel');
  try {
    for (const name of fs.readdirSync(dir))
      if (name.startsWith('run_')) fs.rmSync(path.join(dir, name), { force: true });
  } catch {}
}

const listening = (port, ms = 400) =>
  new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });

class BundledOBS {
  constructor(options = {}) {
    this.options = options;
    this.found = locate(options);
    this.child = null;
    this.credentials = null;
    this.closedByUser = false;
    this.lastError = '';
    this.starting = null;
  }
  get available() {
    return !!this.found;
  }
  get running() {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }
  info() {
    let version = '';
    try {
      version = fs.readFileSync(path.join(this.found.root, 'OBS-VERSION.txt'), 'utf8').trim().slice(0, 40);
    } catch {}
    return {
      available: this.available,
      running: this.running,
      closedByUser: this.closedByUser,
      version,
      error: this.lastError
    };
  }
  // Starts the included OBS (once) and resolves with its WebSocket credentials when it is listening.
  start({ wait = 45000 } = {}) {
    if (!this.found) return Promise.reject(Error('This build does not include OBS.'));
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.credentials = prepare(this.found);
      if (!this.running) {
        if (await listening(this.credentials.port))
          // Already running (e.g. left over from a crash); use it.
          return this.credentials;
        // OBS 32 asks to start in Safe Mode (which turns WebSockets off) after an unclean exit,
        // e.g. a forced close. It is not running now, so clear its "still running" markers.
        clearSentinels(this.found);
        this.closedByUser = false;
        this.lastError = '';
        const child = spawn(this.found.exe, ARGS, {
          cwd: this.found.cwd,
          detached: false,
          stdio: 'ignore',
          windowsHide: false
        });
        this.child = child;
        this.stopping = false;
        child.once('error', e => {
          this.lastError = 'The included OBS could not start: ' + e.message;
        });
        child.once('exit', code => {
          if (this.child === child) this.child = null;
          if (!this.stopping) {
            this.closedByUser = true;
            if (code) this.lastError = 'The included OBS closed (code ' + code + ').';
          }
        });
      }
      const until = Date.now() + wait;
      while (Date.now() < until) {
        if (await listening(this.credentials.port)) return this.credentials;
        if (!this.running && this.lastError) throw Error(this.lastError);
        await new Promise(r => setTimeout(r, 500));
      }
      throw Error(
        this.lastError ||
          'The included OBS did not start in time. If this keeps happening, install the Microsoft Visual C++ Redistributable (x64) and try again.'
      );
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  // Brings the OBS window up (from the tray) for advanced settings, filters and plugins.
  show() {
    if (!this.running) return Promise.reject(Error('The included OBS is not running.'));
    if (process.platform !== 'win32') return Promise.resolve(false);
    const pid = this.child.pid;
    const script = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$found = $false
[W]::EnumWindows({ param($h, $l) $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq ${pid}) { $s = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText($h, $s, 256)
    if ($s.ToString() -like 'OBS *') { [void][W]::ShowWindow($h, 9); [void][W]::SetForegroundWindow($h); $script:found = $true; return $false } }
  return $true }, [IntPtr]::Zero) | Out-Null
if (-not $found) { exit 3 }`;
    return new Promise(resolve =>
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 10000 },
        e => resolve(!e)
      )
    );
  }
  // Closes OBS politely (like clicking Exit), then forcefully if it does not close in time.
  async stop(timeout = 8000) {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    this.stopping = true;
    const exited = new Promise(r => child.once('exit', r));
    if (process.platform === 'win32')
      execFile('taskkill', ['/PID', String(child.pid), '/T'], { windowsHide: true }, () => {});
    else child.kill('SIGTERM');
    const done = await Promise.race([
      exited.then(() => true),
      new Promise(r => setTimeout(r, timeout, false))
    ]);
    if (!done) {
      if (process.platform === 'win32')
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill('SIGKILL');
      await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    }
  }
}
module.exports = { BundledOBS, locate, prepare, iniMerge, PORT, ARGS };
