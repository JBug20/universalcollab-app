// Status bar fit (1.2.0): live with timers, relay health and both storage parts, nothing is cut off at the right
// edge; the least important parts are hidden first; storage that is running low and warnings always stay; a wide
// window shows everything.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const GB = 2 ** 30;
async function check(width) {
  const { browser, page, errors } = await openStudio({ viewport: { width, height: 800 } });
  try {
    await page.evaluate(GB => {
      window.fakeDisk = { folder: 'C:\\Videos', drive: 'C:\\', freeBytes: 2989 * GB, totalBytes: 4000 * GB };
      window.fakeHealth = {
        at: Date.now(),
        cpu: { percent: 18, cores: 4 },
        memory: { usedBytes: 453 * 2 ** 20, limitBytes: 3.7 * GB, percent: 12 },
        network: { txMbps: 0.1, rxMbps: 0.1 },
        storage: { limitBytes: 0, usedBytes: 0, freeBytes: 0 },
        warnings: [],
        sessions: [],
        otherBroadcasts: 0
      };
      window.live = true;
      document.getElementById('serverConnect').click();
    }, GB);
    await page.waitForFunction(() => connected && view?.status?.broadcast);
    // OBS streaming and recording, with timers, as in the report.
    await page.evaluate(() =>
      setInterval(() => {
        window.obsOutputs = {
          stream: { outputActive: true, outputDuration: 270000 },
          record: { outputActive: true, outputDuration: 3000 },
          at: Date.now()
        };
      }, 200)
    );
    await page.waitForFunction(() => !document.querySelector('.status-seg.local').hidden, null, {
      timeout: 40000
    });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const bar = document.getElementById('statusBar').getBoundingClientRect();
      const shown = [...document.querySelectorAll('.status-seg')].filter(s => s.offsetParent);
      return {
        cut: shown.filter(s => s.getBoundingClientRect().right > bar.right + 1).map(s => s.className),
        shown: shown.map(s => s.classList[1]),
        squeezed: [...document.querySelectorAll('.status-seg.squeezed')].map(s => s.classList[1])
      };
    });
    assert.deepEqual(r.cut, [], width + 'px: cut off: ' + JSON.stringify(r));
    for (const must of ['stream-time', 'record-time', 'live'])
      assert.ok(r.shown.includes(must), width + ' keeps ' + must + ': ' + JSON.stringify(r));
    assert.deepEqual(errors, []);
    return r;
  } finally {
    await browser.close();
  }
}
const narrow = await check(1280);
assert.ok(narrow.squeezed.includes('upload'), 'upload goes first: ' + JSON.stringify(narrow));
const wide = await check(1920);
assert.deepEqual(wide.squeezed, [], 'a wide window shows everything');
assert.ok(wide.shown.includes('local'));
console.log('PASS status bar fit: nothing cut off when live; least important hidden first; wide shows all.');
