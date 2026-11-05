'use strict';
// Why OBS is open but UniversalCollab cannot connect (1.2.0). Instead of guessing, look at what OBS says: the
// connection error (refused, wrong password, no answer), OBS's latest log (Safe Mode, its WebSocket server failing
// to start or starting on another port, plugins that failed to load, still starting), a recent crash report, and
// any OBS window waiting for an answer (e.g. a question at start-up). Returns a plain message and the buttons that
// help (Show OBS, Restart OBS) for obs-ui.js.
const fs = require('node:fs'),
  path = require('node:path'),
  { execFile } = require('node:child_process');

// What the latest OBS log says. Only the newest run counts (OBS writes one log file per run).
function analyseLog(text) {
  const t = String(text || '');
  const started =
    /\[obs-websocket\] \[WebSocketServer::Start\] Server started successfully on port (\d+)/.exec(t);
  const failed = /\[obs-websocket\] \[WebSocketServer::Start\] Listen failed: (.*)/.exec(t);
  const modules = [...t.matchAll(/Failed to load module file '([^']+)'/g)].map(m => path.basename(m[1]));
  return {
    safeMode: /Skipping module '[^']+', not on safe list/.test(t),
    wsPort: started ? Number(started[1]) : 0,
    wsFailed: failed ? failed[1].trim().slice(0, 200) : '',
    wsLoaded: /\[obs-websocket\]/.test(t),
    modulesFailed: [...new Set(modules)].slice(0, 5),
    loaded: /==== Startup complete/.test(t),
    shutDown: /==== Shutting down/.test(t)
  };
}
function newest(dir, test = () => true) {
  try {
    return fs
      .readdirSync(dir)
      .filter(test)
      .map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
  } catch {
    return null;
  }
}
// OBS's config folder: the included OBS's own (portable), or the user's (%APPDATA%\obs-studio).
function configDir({ bundledRoot, env = process.env, platform = process.platform } = {}) {
  if (bundledRoot) return path.join(bundledRoot, 'config', 'obs-studio');
  if (platform === 'win32') return env.APPDATA ? path.join(env.APPDATA, 'obs-studio') : '';
  if (platform === 'darwin')
    return env.HOME ? path.join(env.HOME, 'Library', 'Application Support', 'obs-studio') : '';
  return env.HOME ? path.join(env.HOME, '.config', 'obs-studio') : '';
}
function readFacts(dir, now = Date.now()) {
  const log = newest(path.join(dir, 'logs'), f => f.endsWith('.txt'));
  let text = '';
  try {
    if (log) text = fs.readFileSync(log.f, 'utf8').slice(-400000);
  } catch {}
  const crash = newest(path.join(dir, 'crashes'), f => f.endsWith('.txt'));
  return {
    ...analyseLog(text),
    logFile: log?.f || '',
    logAge: log ? now - log.t : null,
    crashedRecently: !!crash && now - crash.t < 15 * 60000,
    crashFile: crash?.f || ''
  };
}
// Visible OBS windows (the main window is hidden in the tray; a visible one is usually a question or an error).
function windowTitles({ pid = 0, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve([]);
  const match = pid ? `$p -eq ${Number(pid)}` : `$ids -contains $p`;
  const script = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$ids = @(Get-Process -Name obs64 -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
[W]::EnumWindows({ param($h, $l) $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
  if ((${match}) -and [W]::IsWindowVisible($h)) { $s = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText($h, $s, 256)
    if ($s.Length -gt 0) { Write-Output $s.ToString() } }
  return $true }, [IntPtr]::Zero) | Out-Null`;
  return new Promise(resolve =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 10000 },
      (e, out) =>
        resolve(
          String(out || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 10)
        )
    )
  );
}

// The message and buttons. `d`: { bundled, failure, expectedPort, windows, ...readFacts }.
function explain(d) {
  const own = !d.bundled;
  const restart = d.bundled ? ['restart'] : [];
  const dialogs = (d.windows || []).filter(t => !/^OBS \d/.test(t));
  const fixOwn = 'In OBS: Tools → WebSocket Server Settings.';
  if (d.safeMode)
    return {
      reason: 'safe-mode',
      text:
        'OBS started in Safe Mode, which turns its connection to UniversalCollab off. ' +
        (d.bundled
          ? 'Restart OBS to start it normally.'
          : 'Close OBS and open it again, choosing Run Normally.'),
      actions: restart
    };
  if (dialogs.length)
    return {
      reason: 'dialog',
      text: `OBS is showing a window waiting for an answer: "${dialogs[0]}". ${
        d.bundled ? 'Show OBS to answer it' : 'Answer it in OBS'
      } (if it asks about Safe Mode, choose Run Normally).`,
      actions: d.bundled ? ['show', 'restart'] : []
    };
  if (d.wsFailed)
    return {
      reason: 'listen-failed',
      text:
        `OBS could not open its connection: ${d.wsFailed}. Another program may be using port ${d.expectedPort || 'its port'}. ` +
        (d.bundled
          ? 'Restart OBS; if it happens again, restart the computer.'
          : fixOwn + ' Choose another port and enter it in Settings → OBS.'),
      actions: restart
    };
  if (d.failure === 'auth')
    return {
      reason: 'password',
      text: own
        ? 'OBS refused the password. ' +
          fixOwn +
          ' Show Connect Info, and copy the password into Settings → OBS → Connect OBS.'
        : 'The included OBS refused its password (its settings changed while it was running). Restart OBS.',
      actions: restart
    };
  if (d.wsPort && d.expectedPort && d.wsPort !== d.expectedPort)
    return {
      reason: 'port',
      text: own
        ? `OBS's connection is on port ${d.wsPort}, but UniversalCollab is set to ${d.expectedPort}. Enter ${d.wsPort} in Settings → OBS → Connect OBS.`
        : `The included OBS opened its connection on port ${d.wsPort} instead of ${d.expectedPort}. Restart OBS.`,
      actions: restart
    };
  if (own && d.wsLoaded && !d.wsPort && d.loaded)
    return {
      reason: 'server-off',
      text: "OBS's WebSocket server is off. " + fixOwn + ' Tick Enable WebSocket server, then OK.',
      actions: []
    };
  if (d.crashedRecently && !d.loaded)
    return {
      reason: 'crashed',
      text:
        'OBS crashed while starting' +
        (d.modulesFailed.length ? ` (it could not load ${d.modulesFailed.join(', ')})` : '') +
        '. ' +
        (d.bundled ? 'Restart OBS.' : 'Open OBS again.') +
        ' If it keeps happening, a plugin added recently may not suit this OBS version.',
      actions: restart
    };
  if (d.failure === 'timeout')
    return {
      reason: 'busy',
      text:
        'OBS is open but not answering (busy or frozen). ' +
        (d.bundled ? 'Show OBS to check it, or restart it.' : 'Check OBS, or close and reopen it.'),
      actions: d.bundled ? ['show', 'restart'] : []
    };
  if (d.logFile && !d.loaded && !d.shutDown)
    return {
      reason: 'starting',
      text:
        'OBS is still starting, or stuck while starting' +
        (d.modulesFailed.length ? ` (it could not load ${d.modulesFailed.join(', ')})` : '') +
        '. ' +
        (d.bundled ? 'Show OBS to check it, or restart it.' : 'Check OBS, or close and reopen it.'),
      actions: d.bundled ? ['show', 'restart'] : []
    };
  return {
    reason: 'unknown',
    text: 'OBS is open but not accepting connections. If OBS is asking whether to run in Safe Mode, choose Run Normally (open OBS from the system tray if you cannot see the question). If OBS is already in Safe Mode, close it and open it again normally.',
    actions: d.bundled ? ['show', 'restart'] : []
  };
}

async function diagnose({ bundledRoot = '', pid = 0, failure = '', expectedPort = 0 } = {}) {
  const dir = configDir({ bundledRoot });
  const facts = dir ? readFacts(dir) : analyseLog('');
  const windows = await windowTitles({ pid: bundledRoot ? pid : 0 }).catch(() => []);
  const d = { ...facts, bundled: !!bundledRoot, failure, expectedPort, windows };
  return { ...explain(d), facts: { ...d, logFile: facts.logFile ? path.basename(facts.logFile) : '' } };
}
module.exports = { analyseLog, readFacts, configDir, explain, diagnose };
