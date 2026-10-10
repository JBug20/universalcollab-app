// OBS open but not accepting connections (its "run in Safe Mode?" question waiting, or Safe Mode with WebSockets
// off): after 20 seconds of failed reconnects the app says what to do, and clears it once OBS connects.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.obsConnected === true && window.connectOBSAutomatically);
  // Connected once before, so the app reconnects by itself.
  await page.evaluate(() => window.connectOBSAutomatically());
  await page.evaluate(() => {
    const bridge = window.relayDesktop,
      real = bridge.obs;
    window.obsBlocked = true;
    bridge.obs = async (op, input = {}) => {
      if (op === 'obs-process') {
        calls.push({ obs: op, input });
        return { running: true };
      }
      if (window.obsBlocked && op === 'state') return { connected: false };
      if (window.obsBlocked && (op === 'connect' || op === 'snapshot'))
        throw Error('OBS WebSocket is not reachable.');
      return real(op, input);
    };
    window.emitOBS?.({ type: 'disconnected' });
  });
  await page.waitForFunction(() => window.obsConnected === false, null, { timeout: 15000 });
  await page.waitForTimeout(8000);
  assert.doesNotMatch(await page.locator('#notice').textContent(), /Safe Mode/, 'not before 20 seconds');
  await page.waitForFunction(() => /Safe Mode/.test(document.getElementById('notice').textContent), null, {
    timeout: 30000
  });
  assert.match(await page.locator('#notice').textContent(), /choose Run Normally/);
  await page.evaluate(() => (window.obsBlocked = false));
  await page.waitForFunction(() => window.obsConnected === true, null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'OBS connected.');
  assert.deepEqual(errors, []);
  console.log('PASS OBS not accepting connections: explained after 20 seconds, cleared when it connects.');
} finally {
  await browser.close();
}
