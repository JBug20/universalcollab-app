// Stream Deck and shortcuts while UniversalCollab's window is hidden (behind a game, minimised): Stop Stream must
// see that OBS is live and stop it (it used to read a state from before the window hid and do nothing), and the
// state sent to the keys keeps up.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(
    () => connected && window.obsConnected && window.remoteCommand && window.streamControls
  );
  // The window goes into the background; then OBS goes live (e.g. started from the Stream Deck or OBS itself).
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.obsStreaming = true;
  });
  const press = action =>
    page.evaluate(async action => {
      const id = 'k' + Math.random();
      await window.remoteCommand({ id, action, args: {} });
      return window.remoteReplies.find(r => r.id === id);
    }, action);
  const r = await press('stream-stop');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.message, 'Stream stopped.', 'it saw OBS was live: ' + JSON.stringify(r));
  assert.ok(await page.evaluate(() => calls.some(c => c.obs === 'stream-stop')), 'OBS was told to stop');
  assert.equal(await page.evaluate(() => window.obsStreaming), false);
  // The keys keep up while hidden (checked every few seconds).
  await page.evaluate(() => (window.obsStreaming = true));
  await page.waitForFunction(() => window.remoteStateLast?.obs?.live === true, null, { timeout: 10000 });
  await page.evaluate(() => (window.obsStreaming = false));
  await page.waitForFunction(() => window.remoteStateLast?.obs?.live === false, null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  console.log('PASS Stream Deck with the window hidden: Stop Stream stops a live OBS; key state keeps up.');
} finally {
  await browser.close();
}
