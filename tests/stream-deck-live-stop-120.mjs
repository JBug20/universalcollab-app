// Stream Deck Live key (1.2.0): with OBS streaming and the relay broadcasting, stopping ends the whole broadcast
// (relay end + OBS stop), not only OBS; it waits briefly if the app is busy and reports when it could not run; every
// press is reported in the notice line.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    window.obsStreaming = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && view?.status?.broadcast && window.remoteCommand);
  const press = (action, args = {}) =>
    page.evaluate(
      async ([action, args]) => {
        const id = 'k' + Math.random();
        await window.remoteCommand({ id, action, args });
        return window.remoteReplies.find(r => r.id === id);
      },
      [action, args]
    );
  // The app is busy with another relay request for a moment: the stop waits for it instead of doing nothing.
  await page.evaluate(() => {
    busy = true;
    setTimeout(() => (busy = false), 1000);
  });
  const r = await press('stream-stop', { endRelay: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.message, 'Broadcast ended (OBS and relay).');
  assert.ok(await page.evaluate(() => calls.some(c => c.route?.endsWith('/end'))), 'relay broadcast ended');
  assert.ok(await page.evaluate(() => calls.some(c => c.obs === 'stream-stop')), 'OBS stopped');
  assert.match(
    await page.locator('#notice').textContent(),
    /Stream Deck · Stop Stream: Broadcast ended \(OBS and relay\)/
  );
  // Stuck busy: it says so instead of claiming success.
  await page.evaluate(() => {
    window.live = true;
    window.obsStreaming = true;
    return refresh();
  });
  await page.waitForFunction(() => view?.status?.broadcast);
  await page.evaluate(() => (busy = true));
  const stuck = await press('end-relay');
  assert.equal(stuck.ok, false);
  assert.match(stuck.error, /busy or not connected/);
  assert.match(
    await page.locator('#notice').textContent(),
    /Stream Deck · End Relay failed: The relay is busy/
  );
  await page.evaluate(() => (busy = false));
  // "Stop OBS only" keys: OBS stops, the relay keeps broadcasting.
  const before = await page.evaluate(() => calls.filter(c => c.route?.endsWith('/end')).length);
  const obsOnly = await press('stream-stop');
  assert.equal(obsOnly.message, 'Stream stopped.');
  assert.equal(await page.evaluate(() => calls.filter(c => c.route?.endsWith('/end')).length), before);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Stream Deck Live key: ends OBS and relay, waits when busy, reports failures, OBS-only option.'
  );
} finally {
  await browser.close();
}
