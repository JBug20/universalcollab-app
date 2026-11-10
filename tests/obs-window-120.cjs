// Show / hide the included OBS window (1.2.0): done like a click on OBS's tray icon (a message to Qt's tray window),
// so OBS's own Show / Hide and minimise keep working; forcing the window from outside is only the fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const {
  windowScript,
  BundledOBS,
  geometryOnScreen,
  repairGeometry,
  prepare
} = require('../DesktopSource/bundled-obs.cjs');
// A Qt saveGeometry() blob (as OBS stores it, base64) for a window at left, top, right, bottom.
function geometry(l, t, r, b) {
  const buf = Buffer.alloc(66);
  buf.writeUInt32BE(0x01d9d0cb, 0);
  buf.writeUInt16BE(3, 4);
  buf.writeUInt16BE(0, 6);
  [l, t, r, b, l + 8, t + 31, r - 8, b - 8].forEach((v, i) => buf.writeInt32BE(v, 8 + i * 4));
  return buf.toString('base64');
}
const screens = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -1920, y: 0, width: 1920, height: 1080 }
];
assert.equal(geometryOnScreen(geometry(100, 100, 1380, 900), screens), true);
assert.equal(geometryOnScreen(geometry(-1800, 50, -500, 900), screens), true, 'the left-hand screen');
assert.equal(
  geometryOnScreen(geometry(-32000, -32000, -31840, -31972), screens),
  false,
  'saved while minimised'
);
assert.equal(
  geometryOnScreen(geometry(-32000, -32000, -31840, -31972), []),
  false,
  'even without screen info'
);
assert.equal(
  geometryOnScreen(geometry(2000, 100, 3200, 900), screens),
  false,
  'on a screen that is not there now'
);
assert.equal(
  geometryOnScreen(geometry(100, 1070, 1300, 1900), screens),
  false,
  'title bar below every screen'
);
assert.equal(geometryOnScreen('not a geometry', screens), true, 'not understood: left alone');
// Removed from [BasicWindow] only when off-screen; everything else kept.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-geom-'));
try {
  const ini = path.join(dir, 'user.ini');
  const other = 'geometry=' + geometry(-32000, -32000, -31840, -31972);
  fs.writeFileSync(
    ini,
    [
      '[General]',
      'FirstRun=true',
      '[BasicWindow]',
      'SysTrayEnabled=true',
      other,
      'DockState=abc',
      '[Other]',
      other
    ].join('\r\n')
  );
  assert.equal(repairGeometry(ini, screens), true);
  assert.deepEqual(fs.readFileSync(ini, 'utf8').split('\r\n'), [
    '[General]',
    'FirstRun=true',
    '[BasicWindow]',
    'SysTrayEnabled=true',
    'DockState=abc',
    '[Other]',
    other
  ]);
  fs.writeFileSync(ini, '[BasicWindow]\r\ngeometry=' + geometry(100, 100, 1380, 900));
  assert.equal(repairGeometry(ini, screens), false, 'a good position is kept');
  // prepare() (each time the app starts the included OBS) does it for user.ini and global.ini.
  const root = path.join(dir, 'obs');
  const cfg = path.join(root, 'config', 'obs-studio');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'user.ini'), '[BasicWindow]\r\n' + other);
  prepare({ root }, { displays: screens });
  assert.doesNotMatch(fs.readFileSync(path.join(cfg, 'user.ini'), 'utf8'), /geometry=/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const show = windowScript(4321, 'show'),
  hide = windowScript(4321, 'hide');
for (const s of [show, hide]) {
  assert.match(s, /\$script:pids \+= 4321/, 'only this OBS');
  assert.match(s, /QTrayIconMessageWindowClass/, "OBS's tray window");
  assert.match(
    s,
    /PostMessage\(\$script:tray, 0x8065, \[IntPtr\]::Zero, \[IntPtr\]0x400\)/,
    'WM_APP + 101, NIN_SELECT'
  );
  // OBS started in the tray has no main window yet: after a click the windows are looked up again and the result
  // waited for, and a second click is only sent when the main window exists and is still the wrong way round.
  assert.match(s, /function WaitFor\(\$want\) \{[^}]*Find;/, 'looked up again while waiting');
  assert.match(s, /TrayClick\n  \$ok = WaitFor \$wantShown/);
  assert.match(
    s,
    /if \(-not \$ok -and \$script:main -ne \[IntPtr\]::Zero\) \{ TrayClick; \$ok = WaitFor \$wantShown \}/,
    'a second click only for an out-of-step OBS'
  );
}
assert.match(show, /\$wantShown = \$true/);
assert.match(hide, /\$wantShown = \$false/);
// Brought in front even when Windows will not hand over the focus (briefly topmost).
assert.match(show, /SetWindowPos\(h, new IntPtr\(-1\)/);
assert.match(show, /SetWindowPos\(h, new IntPtr\(-2\)/);
// Already as wanted: nothing toggled (a shown window is only brought to the front).
assert(show.indexOf('if ((Visible) -eq $wantShown) {') < show.indexOf('TrayClick\n'));
assert.equal(
  windowScript('1; Remove-Item C:\\', 'show').includes('Remove-Item'),
  false,
  'the process id is a number'
);
// An OBS left running from an earlier session is found by its program file; quotes in the path stay inside it.
const byExe = windowScript({ pid: 0, exe: "C:\\Program Files\\Bob's\\obs64.exe" }, 'show');
assert.match(byExe, /\$exe = 'C:\\Program Files\\Bob''s\\obs64\.exe'/);
assert.match(byExe, /Get-Process obs64/);
assert.doesNotMatch(byExe, /\$script:pids \+= 0/);
assert.equal(windowScript({ exe: "x'\n; Remove-Item" }, 'show').includes("x'\n"), false);
// Your own OBS: every OBS running on this PC.
const any = windowScript({ any: true }, 'show');
assert.match(
  any,
  /Get-Process obs64 -ErrorAction SilentlyContinue \| ForEach-Object \{ \$script:pids \+= \$_\.Id \}/
);
assert.doesNotMatch(
  show,
  /ForEach-Object \{ \$script:pids \+= \$_\.Id \}\n/,
  'the included OBS only: not every OBS'
);
// Off-screen is judged by the middle of the title bar (a window overlapping a screen by a few pixels cannot be
// grabbed) and by size; it is then moved to the main screen.
assert.match(show, /MonitorFromPoint\(p, 0\) == IntPtr\.Zero \|\| r\.Rt - r\.L < 200/);
assert.match(show, /GetMonitorInfo\(MonitorFromPoint\(new PT\(\), 1\), ref i\)/);
// Shown already (OBS thinks so) but off-screen: brought on screen without toggling.
assert.match(show, /if \(\(Visible\) -eq \$wantShown\) \{\n  if \(\$wantShown\) \{ \[W\]::Bring/);
// Your own OBS's saved window position is reset before UniversalCollab starts it.
{
  const { repairOwnGeometry } = require('../DesktopSource/own-obs.cjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-ownobs-'));
  try {
    fs.mkdirSync(path.join(home, 'obs-studio'));
    const off = Buffer.alloc(24);
    off.writeUInt32BE(0x01d9d0cb, 0);
    off.writeInt32BE(-32000, 8);
    off.writeInt32BE(-32000, 12);
    off.writeInt32BE(-30720, 16);
    off.writeInt32BE(-31200, 20);
    fs.writeFileSync(
      path.join(home, 'obs-studio', 'user.ini'),
      '[BasicWindow]\ngeometry=' + off.toString('base64') + '\n'
    );
    assert.equal(
      repairOwnGeometry({
        platform: 'win32',
        env: { APPDATA: home },
        displays: () => [{ x: 0, y: 0, width: 1920, height: 1080 }]
      }),
      1
    );
    assert.doesNotMatch(fs.readFileSync(path.join(home, 'obs-studio', 'user.ini'), 'utf8'), /geometry=/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
// Reset OBS window position: the saved position is removed even when it looks on-screen.
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-reset-'));
  try {
    const cfg = path.join(home, 'config', 'obs-studio');
    fs.mkdirSync(cfg, { recursive: true });
    const on = Buffer.alloc(24);
    on.writeUInt32BE(0x01d9d0cb, 0);
    on.writeInt32BE(100, 8);
    on.writeInt32BE(100, 12);
    on.writeInt32BE(1300, 16);
    on.writeInt32BE(900, 20);
    const ini = '[General]\nName=x\n[BasicWindow]\ngeometry=' + on.toString('base64') + '\nDockState=abc\n';
    fs.writeFileSync(path.join(cfg, 'user.ini'), ini);
    const b = new BundledOBS({ root: '/nonexistent' });
    b.found = { root: home, exe: path.join(home, 'obs64.exe') };
    b.stop = async () => {};
    return b
      .resetWindow()
      .then(removed => {
        assert.equal(removed, true);
        const after = fs.readFileSync(path.join(cfg, 'user.ini'), 'utf8');
        assert.doesNotMatch(after, /geometry=/);
        assert.match(after, /DockState=abc/, 'the rest is kept');
      })
      .finally(() => fs.rmSync(home, { recursive: true, force: true }))
      .then(rest);
  } catch (e) {
    fs.rmSync(home, { recursive: true, force: true });
    throw e;
  }
}
function rest() {
  // Not running: a clear error.
  const b = new BundledOBS({ root: '/nonexistent' });
  assert
    .rejects(b.hide(), /not running/)
    .then(() =>
      console.log(
        "PASS OBS window: shown and hidden like OBS's tray icon, kept in step, brought on screen, off-screen position reset."
      )
    );
}
