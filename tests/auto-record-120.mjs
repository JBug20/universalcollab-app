// Auto-record (1.2.0): "Start recording when I start streaming" starts a recording with the stream and stops it
// with the stream; a recording you started or stopped yourself is left alone; nothing is recorded when this PC is
// almost out of space; off by default.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.fakeDisk = {
      folder: 'D:\\Rec',
      drive: 'D:\\',
      freeBytes: 200 * 2 ** 30,
      totalBytes: 1000 * 2 ** 30
    };
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && window.obsConnected && window.streamControls);
  await page.waitForFunction(() => !document.getElementById('obsVideoFields').hidden);
  // Settings → OBS, next to the recordings folder.
  await page.evaluate(() => window.workspaceUI.openSettings('obs'));
  await page.locator('#obsAutoRecord').waitFor({ state: 'visible' });
  const sc = (fn, ...a) => page.evaluate(([fn, a]) => window.streamControls[fn](...a), [fn, a]);
  const recording = () => page.evaluate(() => !!window.obsRecording);

  // Off by default: streaming does not record.
  assert.equal(await page.locator('#obsAutoRecord').isChecked(), false);
  assert.equal(await page.locator('#obsAutoRecordStop').isDisabled(), true);
  await sc('start');
  assert.equal(await recording(), false);
  await sc('stop', false);

  // On: recording starts with the stream and stops with it.
  await page.locator('#obsAutoRecord').check();
  assert.equal(await page.locator('#obsAutoRecordStop').isChecked(), true, 'stop with the stream by default');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('uc-auto-record')).start), true);
  assert.match(await sc('start'), /Stream started\. Recording started\./);
  assert.equal(await recording(), true);
  assert.match(await sc('stop', false), /Recording stopped/);
  assert.equal(await recording(), false);

  // A recording you started yourself before going live is not stopped with the stream.
  await sc('record', false);
  assert.equal(await recording(), true);
  assert.doesNotMatch(await sc('start'), /Recording started/);
  await sc('stop', false);
  assert.equal(await recording(), true, 'your own recording keeps going');
  await sc('record', false);

  // Stopped and restarted by hand during the stream: yours now, left running.
  await sc('start');
  await sc('record', false);
  await sc('record', false);
  await sc('stop', false);
  assert.equal(await recording(), true);
  await sc('record', false);

  // "Stop that recording" off: keeps recording after the stream.
  await page.locator('#obsAutoRecordStop').uncheck();
  await sc('start');
  await sc('stop', false);
  assert.equal(await recording(), true);
  await sc('record', false);

  // Almost out of space: no automatic recording, and it says why.
  await page.evaluate(() => (window.fakeDisk.freeBytes = 1.5 * 2 ** 30));
  assert.doesNotMatch(await sc('start'), /Recording started/);
  assert.equal(await recording(), false);
  assert.match(
    await page.locator('#notice').textContent(),
    /Not recording automatically: only 1536 MB free on D:/
  );
  await sc('stop', false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS auto-record: with the stream, stopped with it, own recordings left alone, low space skipped.'
  );
} finally {
  await browser.close();
}
