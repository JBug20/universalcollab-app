// Stream markers and pause / split (1.2.0), window: Mark appears while live or recording and adds a Twitch marker,
// a recording chapter and a list entry with times; the shortcut / Stream Deck action does the same; Pause / Resume
// shows while recording; "new file every" splits once the recording reaches the time, and stops trying if OBS
// cannot.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
const notice = () => page.locator('#notice').textContent();
try {
  await page.evaluate(() => {
    window.live = false;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(
    () => connected && window.obsConnected && window.streamMarkers && window.streamControls
  );
  await page.waitForFunction(() => document.getElementById('streamMark'));
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#streamMark').isHidden(), true, 'nothing to mark yet');
  await assert.rejects(
    page.evaluate(() => window.streamMarkers.add()),
    /Nothing to mark/
  );

  // Live: the list starts, Mark shows, Twitch marker added.
  await page.evaluate(() => (window.live = true));
  await page.waitForFunction(() => view?.status?.broadcast === true);
  await page.waitForTimeout(1500);
  await page.locator('#streamMark').waitFor({ state: 'visible' });
  await page.locator('#streamMark').click();
  await page.waitForFunction(() =>
    /Marker 1 at stream 0:0\d \(added to Twitch\)\./.test(document.getElementById('notice').textContent)
  );
  assert.equal(
    (await page.evaluate(() => window.calls.filter(c => c.op === 'twitch-marker').at(-1).input)).description,
    'Marker 1'
  );

  // Recording too: a chapter and the recording time; via the shortcut / Stream Deck action.
  await page.evaluate(() => {
    window.obsRecording = true;
    window.recordMs = 3725000;
  });
  await page.waitForFunction(() => window.obsOutputs?.record?.outputActive);
  const r = await page.evaluate(() => window.runControlAction('marker', {}));
  assert.match(
    r,
    /^Marker 2 at stream 0:\d\d, recording 1:02:0\d \(added to Twitch and recording chapter\)\.$/
  );
  // Twitch refuses (e.g. VODs off): the marker still goes on the list.
  await page.evaluate(() => (window.twitchMarkerFail = 'Twitch did not add a marker'));
  assert.match(
    await page.evaluate(() => window.streamMarkers.add('Clutch')),
    /^Clutch at .*\(added to recording chapter\)\.$/
  );
  const list = await page.evaluate(() => window.streamMarkers.list());
  assert.deepEqual(
    list.map(m => [m.n, m.label, m.twitch, m.chapter]),
    [
      [1, '', true, false],
      [2, '', true, true],
      [3, 'Clutch', false, true]
    ]
  );

  // Pause / Resume while recording.
  await page.locator('#obsRecordPause').waitFor({ state: 'visible' });
  await page.locator('#obsRecordPause').click();
  await page.waitForFunction(() => document.getElementById('obsRecordPause').textContent === 'Resume');
  assert.equal(await page.locator('#obsRecordPause').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.runControlAction('record-pause', {})), 'Recording resumed.');
  await page.waitForFunction(() => document.getElementById('obsRecordPause').textContent === 'Pause');

  // New file every 30 minutes: the 62-minute recording is split once, not again until 30 minutes later.
  await page.evaluate(() => window.workspaceUI.openSettings('obs'));
  await page.locator('#obsRecordSplit').selectOption('30');
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-record-split')), '30');
  await page.waitForFunction(() => window.splits === 1, null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => window.splits), 1);
  await page.evaluate(() => (window.recordMs = 3725000 + 31 * 60000));
  await page.waitForFunction(() => window.splits === 2, null, { timeout: 15000 });
  // OBS cannot split: it says how, and stops trying.
  await page.evaluate(() => {
    window.splitFail = 'OBS could not start a new file. In OBS: Settings → Output … Automatic File Splitting';
    window.recordMs += 31 * 60000;
  });
  await page.waitForFunction(() => window.splits === 3, null, { timeout: 15000 });
  await page.waitForFunction(() =>
    /Automatic File Splitting/.test(document.getElementById('notice').textContent)
  );
  assert.equal(await page.locator('#obsRecordSplit').inputValue(), '0');
  await page.evaluate(() => (window.recordMs += 31 * 60000));
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => window.splits), 3);

  // Stopping the recording hides Pause; a new broadcast starts a new marker list.
  await page.evaluate(() => {
    window.obsRecording = false;
    window.live = false;
  });
  await page.waitForFunction(
    () => document.getElementById('obsRecordPause').hidden && view.status.broadcast === false
  );
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window.live = true));
  await page.waitForFunction(() => view.status.broadcast === true);
  await page.waitForFunction(() => window.streamMarkers.list().length === 0);
  assert(!(await notice()).includes('failed'));
  assert.deepEqual(errors, []);
  console.log(
    'PASS markers, pause and split window: Mark, Twitch + chapter, list, pause/resume, auto split.'
  );
} finally {
  await browser.close();
}
