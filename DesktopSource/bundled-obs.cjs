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
// --disable-shutdown-check: no "run in Safe Mode?" question after an unclean exit. It would wait unseen in the tray,
// and Safe Mode turns off the WebSocket server the app connects through.
const ARGS = [
  '--portable',
  '--minimize-to-tray',
  '--disable-updater',
  '--disable-missing-files-check',
  '--disable-shutdown-check',
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

// OBS saves its window position (Qt saveGeometry, base64) in user.ini / global.ini, [BasicWindow] geometry. If it
// was saved while the window was minimised (Windows parks those at -32000) or on a screen that is not there now,
// OBS opens its window off-screen: Show in the tray then does nothing visible. Such a position is removed, so OBS
// opens on a screen. `displays`: the screens now ({ x, y, width, height }), when known.
function geometryOnScreen(b64, displays = []) {
  let b;
  try {
    b = Buffer.from(String(b64 || '').trim(), 'base64');
  } catch {
    return true;
  }
  if (b.length < 24 || b.readUInt32BE(0) !== 0x01d9d0cb) return true; // not understood: leave it
  const left = b.readInt32BE(8),
    top = b.readInt32BE(12),
    right = b.readInt32BE(16),
    bottom = b.readInt32BE(20);
  if (left < -20000 || top < -20000 || right - left < 200 || bottom - top < 150) return false;
  if (!displays.length) return true;
  // At least a grabbable part of the window (its title bar) must be on a screen.
  return displays.some(
    d =>
      Math.min(right, d.x + d.width) - Math.max(left, d.x) >= 100 &&
      Math.min(top + 40, d.y + d.height) - Math.max(top, d.y) >= 20
  );
}
// force: remove the saved position even if it looks on-screen (Reset OBS window position).
function repairGeometry(file, displays, { force = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let section = '',
    changed = false;
  const lines = text.split(/\r?\n/).filter(line => {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) section = m[1];
    const g = /^\s*geometry\s*=(.*)$/.exec(line);
    if (section === 'BasicWindow' && g && (force || !geometryOnScreen(g[1], displays))) {
      changed = true;
      return false;
    }
    return true;
  });
  if (changed) fs.writeFileSync(file, lines.join('\r\n'));
  return changed;
}

function prepare(found, { displays = [] } = {}) {
  const config = path.join(found.root, 'config', 'obs-studio');
  fs.writeFileSync(path.join(found.root, 'portable_mode.txt'), '');
  for (const f of ['user.ini', 'global.ini']) repairGeometry(path.join(config, f), displays);
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
  // Replay buffer on (60 s) so the app's Clip button works. Only fills keys that are missing, so a profile where
  // it was turned off in OBS stays off. "Untitled" is OBS's first profile, created here if OBS has not run yet.
  const profiles = path.join(config, 'basic', 'profiles');
  let names = [];
  try {
    names = fs.readdirSync(profiles).filter(n => fs.statSync(path.join(profiles, n)).isDirectory());
  } catch {}
  if (!names.length) names = ['Untitled'];
  for (const n of names) {
    const file = path.join(profiles, n, 'basic.ini');
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {}
    // A profile that already has a replay buffer setting (on or off, in either output mode) is left alone.
    if (/^\s*RecRB\s*=/m.test(text)) continue;
    iniMerge(file, {
      SimpleOutput: { RecRB: 'true', RecRBTime: '60' },
      AdvOut: { RecRB: 'true', RecRBTime: '60' }
    });
  }
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

// PowerShell that shows or hides OBS's main window like a click on OBS's tray icon. OBS keeps track of whether its
// window is shown; forcing the window open from outside (as 1.2.0 previews before 17 did) left OBS thinking it was
// still hidden, so its own tray Show / Hide and minimise stopped working. A click on the tray icon reaches OBS as a
// message to Qt's hidden tray window (class QTrayIconMessageWindowClass): WM_APP + 101 with NIN_SELECT (0x400) for
// icon 0, which makes OBS toggle its window itself.
// OBS started in the tray has no main window until it is first shown, so the windows are looked up again after each
// click and the result is waited for (up to 3 seconds) before deciding anything; a second click is only sent when
// the main window exists and is still the wrong way round. If there is no tray window it shows the window directly.
// target: OBS's process id, or { pid, exe } (exe also finds an OBS left running from an earlier session), or
// { any: true } for every OBS running on this PC (your own OBS).
function windowScript(target, mode) {
  const show = mode !== 'hide';
  const t = typeof target === 'object' && target ? target : { pid: target };
  const pid = Number.isInteger(Number(t.pid)) && Number(t.pid) > 0 ? Number(t.pid) : 0;
  const exe = typeof t.exe === 'string' ? t.exe.replace(/[\r\n\0]/g, '').replace(/'/g, "''") : '';
  const any = t.any === true;
  // UniversalCollab's own window: OBS is brought to the screen it is on.
  const near = Number.isSafeInteger(Number(t.near)) && Number(t.near) > 0 ? Number(t.near) : 0;
  return `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public R M; public R W; public uint F; }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(PT p, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  // On another Windows virtual desktop (Windows + Tab): the window is "cloaked" and cannot be brought here.
  public static bool Cloaked(IntPtr h) { int v = 0; return DwmGetWindowAttribute(h, 14, out v, 4) == 0 && v != 0; }
  // Shown in front of you: a minimised window is restored, and the window is moved to the middle of the screen
  // UniversalCollab is on (or the screen the mouse is on) whenever it is anywhere else. "Anywhere else" includes a
  // screen Windows still has but you cannot see (a TV or monitor that is off, a dummy plug, a virtual display), so it
  // never depends on guessing whether a screen is real. Briefly made topmost so it comes in front even when Windows
  // refuses to hand over the focus. Returns what it found and did, for the message and the log.
  public static string Bring(IntPtr h, IntPtr near) {
    bool wasMin = IsIconic(h);
    if (wasMin) ShowWindow(h, 9);
    R r; GetWindowRect(h, out r);
    IntPtr target;
    if (near != IntPtr.Zero) target = MonitorFromWindow(near, 2);
    else { PT c; GetCursorPos(out c); target = MonitorFromPoint(c, 2); }
    MI i = new MI(); i.cb = Marshal.SizeOf(typeof(MI));
    GetMonitorInfo(target, ref i);
    PT p = new PT(); p.X = (r.L + r.Rt) / 2; p.Y = r.T + 12;
    bool moved = false;
    if (MonitorFromPoint(p, 0) != target || r.Rt - r.L < 200 || r.B - r.T < 150) {
      if (IsZoomed(h)) ShowWindow(h, 9);
      int sw = i.W.Rt - i.W.L, sh = i.W.B - i.W.T;
      int w = Math.Min(1280, sw - 80), hh = Math.Min(800, sh - 80);
      SetWindowPos(h, IntPtr.Zero, i.W.L + (sw - w) / 2, i.W.T + (sh - hh) / 2, w, hh, 0x0044);
      moved = true;
    }
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0043);
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0043);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    R n; GetWindowRect(h, out n);
    return "was=" + r.L + "," + r.T + "," + (r.Rt - r.L) + "x" + (r.B - r.T) + (wasMin ? ",min" : "") +
      " now=" + n.L + "," + n.T + "," + (n.Rt - n.L) + "x" + (n.B - n.T) + (moved ? ",moved" : "") +
      " screen=" + i.W.L + "," + i.W.T + "," + (i.W.Rt - i.W.L) + "x" + (i.W.B - i.W.T) +
      (Cloaked(h) ? " cloaked" : "") + (IsWindowVisible(h) ? "" : " hidden");
  }
}
'@
$script:pids = @()
${pid ? '$script:pids += ' + pid : ''}
$exe = '${exe}'
${any ? 'Get-Process obs64 -ErrorAction SilentlyContinue | ForEach-Object { $script:pids += $_.Id }' : ''}
if ($exe) { Get-Process obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object { $script:pids += $_.Id } }
if ($script:pids.Count -eq 0) { Write-Output 'no-obs'; exit 4 }
function Find {
  $script:main = [IntPtr]::Zero; $script:tray = [IntPtr]::Zero
  [W]::EnumWindows({ param($h, $l) $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
    if ($script:pids -contains [int]$p) {
      $c = New-Object System.Text.StringBuilder 256; [void][W]::GetClassName($h, $c, 256)
      $t = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText($h, $t, 256)
      if ($c.ToString() -like 'QTrayIconMessageWindowClass*') { $script:tray = $h }
      elseif ($t.ToString() -like 'OBS *' -and ($script:main -eq [IntPtr]::Zero -or [W]::IsWindowVisible($h))) { $script:main = $h; $script:title = $t.ToString() } }
    return $true }, [IntPtr]::Zero) | Out-Null
}
function Visible { $script:main -ne [IntPtr]::Zero -and [W]::IsWindowVisible($script:main) }
function WaitFor($want) {
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 100; Find; if ((Visible) -eq $want) { return $true } }
  return $false
}
function TrayClick { [void][W]::PostMessage($script:tray, 0x8065, [IntPtr]::Zero, [IntPtr]0x400) }
$script:info = ''
$wantShown = $${show ? 'true' : 'false'}
Find
if ((Visible) -eq $wantShown) {
  if ($wantShown) { $script:info = [W]::Bring($script:main, [IntPtr][long]${near}) }
  Write-Output "already $script:info"; exit 0
}
if ($script:tray -ne [IntPtr]::Zero) {
  TrayClick
  $ok = WaitFor $wantShown
  # OBS may have thought the opposite (an earlier forced show): its window exists but is still the wrong way round.
  if (-not $ok -and $script:main -ne [IntPtr]::Zero) { TrayClick; $ok = WaitFor $wantShown }
  if ($ok) { if ($wantShown) { $script:info = [W]::Bring($script:main, [IntPtr][long]${near}) }; Write-Output "tray $script:info"; exit 0 }
}
if ($script:main -eq [IntPtr]::Zero) { Write-Output "no-window tray=$($script:tray -ne [IntPtr]::Zero)"; exit 3 }
# Hiding is only ever done by OBS itself: hiding its window behind its back leaves OBS sure it is showing (the tray
# then says Hide while nothing is on screen, and Show does nothing).
if (-not $wantShown) { Write-Output 'failed-hide'; exit 5 }
[void][W]::ShowWindow($script:main, 9); $script:info = [W]::Bring($script:main, [IntPtr][long]${near})
Find
if ((Visible) -eq $wantShown) { Write-Output "direct $script:info"; exit 0 }
Write-Output "failed $script:info title=$script:title"; exit 5`;
}

// What the window script reports: its last line, e.g. "tray was=3840,0,1280x800 now=320,140,1280x800,moved ...".
const windowReport = out =>
  String(out || '')
    .trim()
    .split(/\r?\n/)
    .pop()
    .trim()
    .slice(0, 300);
// Shows any OBS running on this PC (your own OBS), brought onto UniversalCollab's screen and in front.
// near: UniversalCollab's window handle. Resolves { shown, how }.
function showAnyOBS({ platform = process.platform, near = 0 } = {}) {
  if (platform !== 'win32') return Promise.resolve({ shown: false, how: 'not-windows' });
  return new Promise(resolve =>
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowScript({ any: true, near }, 'show')
      ],
      { windowsHide: true, timeout: 20000 },
      (e, out) => {
        const how = windowReport(out) || (e ? 'error' : '');
        resolve({ shown: !e && !/cloaked|hidden/.test(how), how: how + (e?.killed ? ' (timed out)' : '') });
      }
    )
  );
}

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
      let displays = [];
      try {
        displays = this.options.displays?.() || [];
      } catch {}
      this.credentials = prepare(this.found, { displays });
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
  // Shows the OBS window (from the tray) for advanced settings, filters and plugins, or hides it back to the tray.
  // Done the way OBS's own tray icon does it (windowScript), so OBS's Show / Hide and minimise keep working.
  show() {
    return this.window('show');
  }
  hide() {
    return this.window('hide');
  }
  // Resolves true when the window ended up as asked. this.lastWindow keeps how (or why not) for diagnosis.
  window(mode) {
    // An OBS left running from an earlier session (start() reuses it) has no child here: found by its program file.
    if (!this.running && !this.found) return Promise.reject(Error('The included OBS is not running.'));
    if (process.platform !== 'win32') return Promise.resolve(false);
    let near = 0;
    try {
      near = this.options.nearWindow?.() || 0;
    } catch {}
    const target = { pid: this.running ? this.child.pid : 0, exe: this.found?.exe || '', near };
    if (!target.pid && !target.exe) return Promise.reject(Error('The included OBS is not running.'));
    return new Promise(resolve =>
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowScript(target, mode)
        ],
        { windowsHide: true, timeout: 20000 },
        (e, out) => {
          this.lastWindow = (windowReport(out) || (e ? 'error' : '')) + (e?.killed ? ' (timed out)' : '');
          if (/no-obs|cloaked/.test(this.lastWindow) || (mode !== 'hide' && / hidden$/.test(this.lastWindow)))
            return resolve(false);
          resolve(!e);
        }
      )
    );
  }
  // Reset OBS window position: OBS is closed (it saves its window position when it closes), the saved position is
  // removed, and OBS opens its window in the middle of the main screen next time it starts.
  async resetWindow() {
    await this.stop();
    if (!this.found) return false;
    const config = path.join(this.found.root, 'config', 'obs-studio');
    let removed = false;
    for (const f of ['user.ini', 'global.ini'])
      if (repairGeometry(path.join(config, f), [], { force: true })) removed = true;
    this.closedByUser = false;
    return removed;
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
module.exports = {
  BundledOBS,
  showAnyOBS,
  repairGeometry,
  locate,
  prepare,
  iniMerge,
  windowScript,
  geometryOnScreen,
  PORT,
  ARGS
};
