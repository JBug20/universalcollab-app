// Post-stream report (1.2.0), window: notes are taken while a relay broadcast runs (outputs, OBS, viewers, drops,
// markers, clips); when it ends the report is saved and shown with its key numbers; Tools → Stream reports opens it
// again; it can be set not to pop up.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = false;
    window.fakeViewers = { twitch: 42, youtube: 7 };
    document.getElementById('serverConnect').click();
    setInterval(() => {
      if (view?.status?.broadcast)
        view.status.outputs = [
          { id: 'twitch', name: 'Twitch', state: 'sending', bitrateKbps: 6000, fps: 60 },
          { id: 'kick', name: 'Kick', state: 'sending', bitrateKbps: 5000, fps: 30 }
        ];
    }, 100);
  });
  await page.waitForFunction(() => connected && window.openStreamReports && window.streamMarkers);
  await page.waitForTimeout(1500);
  await page.locator('#productionTitle').evaluate(n => (n.value = 'Friday chaos'));
  await page.evaluate(() => (window.live = true));
  await page.waitForFunction(() => window.streamReportNow()?.title === 'Friday chaos');
  // A marker, a drop and a clip during the broadcast.
  await page.evaluate(() => {
    window.obsStreaming = true;
    window.obsRecording = true;
  });
  await page.waitForFunction(() => window.obsOutputs?.record?.outputActive);
  await page.evaluate(() => window.streamMarkers.add('Big play'));
  await page.evaluate(() => {
    const at = Date.now();
    window.dispatchEvent(
      new CustomEvent('destination-alert', {
        detail: { type: 'down', id: 'kick', name: 'Kick', state: 'reconnecting', at }
      })
    );
    window.dispatchEvent(
      new CustomEvent('destination-alert', {
        detail: { type: 'back', id: 'kick', name: 'Kick', at: at + 30000 }
      })
    );
    window.dispatchEvent(new CustomEvent('obs-clip-saved', { detail: { path: 'D:\\Rec\\Replay 1.mp4' } }));
  });
  await page.waitForFunction(() => window.streamReportNow()?.viewers?.twitch?.peak === 42);
  await page.waitForTimeout(1500);
  // Ended: saved and shown.
  await page.evaluate(() => (window.live = false));
  await page.locator('#streamReportWindow').waitFor({ state: 'visible', timeout: 10000 });
  const text = await page.locator('#streamReportText').textContent();
  for (const want of [
    /^Stream report: Friday chaos/,
    /- Twitch: 6,000 kbps, 60 fps; no drops/,
    /- Kick: 5,000 kbps, 30 fps; stopped receiving 1× \(\d\d:\d\d, back after 0:30\)/,
    /- Recorded: 1:30/,
    /- Twitch: peak 42/,
    /- YouTube: peak 7/,
    /Markers \(1\)\n- #1 · Big play · stream /,
    /Clips \(1\)\n- Replay 1\.mp4 at /
  ])
    assert.match(text, want);
  const facts = await page.locator('.report-fact').allTextContents();
  assert.deepEqual(facts.slice(1), [
    '1destination drop',
    '–frames dropped',
    '42peak viewers',
    '1marker',
    '1clip'
  ]);
  assert.match(await page.locator('#streamReportWindow').textContent(), /Saved as Stream report\.txt/);
  assert.equal(await page.evaluate(() => window.fakeReports.length), 1);
  assert.match(await page.locator('#notice').textContent(), /Stream report saved: Stream report\.txt/);
  assert.equal(await page.locator('#streamReportList .report-item').count(), 1);
  // Do not pop up next time; Tools → Stream reports still opens the latest.
  await page.locator('#streamReportShow').uncheck();
  await page.locator('#streamReportWindow button', { hasText: 'Close' }).click();
  await page.evaluate(() => (window.live = true));
  await page.waitForFunction(() => window.streamReportNow());
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window.live = false));
  await page.waitForFunction(() => window.fakeReports.length === 2);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#streamReportWindow').isVisible(), false);
  await page.evaluate(() => window.openStreamReports());
  await page.locator('#streamReportWindow').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#streamReportList .report-item').count(), 2);
  assert.deepEqual(errors, []);
  console.log('PASS stream report window: notes during the broadcast, saved and shown at the end, history.');
} finally {
  await browser.close();
}
