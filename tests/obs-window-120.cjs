// Show / hide the included OBS window (1.2.0): done like a click on OBS's tray icon (a message to Qt's tray window),
// so OBS's own Show / Hide and minimise keep working; forcing the window from outside is only the fallback.
const assert = require('node:assert/strict');
const { windowScript, BundledOBS } = require('../DesktopSource/bundled-obs.cjs');

const show = windowScript(4321, 'show'),
  hide = windowScript(4321, 'hide');
for (const s of [show, hide]) {
  assert.match(s, /\$p -eq 4321/, 'only this OBS');
  assert.match(s, /QTrayIconMessageWindowClass/, "OBS's tray window");
  assert.match(
    s,
    /PostMessage\(\$script:tray, 0x8065, \[IntPtr\]::Zero, \[IntPtr\]0x400\)/,
    'WM_APP + 101, NIN_SELECT'
  );
  assert.match(
    s,
    /if \(\(Visible\) -ne \$wantShown\) \{ TrayClick \}/,
    'a second click puts an out-of-step OBS right'
  );
}
assert.match(show, /\$wantShown = \$true/);
assert.match(hide, /\$wantShown = \$false/);
// Already as wanted: nothing toggled (a shown window is only brought to the front).
assert(show.indexOf('if ((Visible) -eq $wantShown) {') < show.indexOf('TrayClick\n'));
assert.equal(
  windowScript('1; Remove-Item C:\\', 'show').includes('Remove-Item'),
  false,
  'the process id is a number'
);
// Not running: a clear error.
const b = new BundledOBS({ root: '/nonexistent' });
assert
  .rejects(b.hide(), /not running/)
  .then(() => console.log("PASS OBS window: shown and hidden like OBS's tray icon, kept in step, fallback."));
