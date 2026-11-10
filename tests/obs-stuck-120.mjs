// OBS open but not accepting connections: after 20 seconds of failed reconnects the app says why, from what OBS
// reports (obs-diagnose.cjs), with Show OBS / Restart OBS when they help; it updates if the reason changes and
// clears once OBS connects.
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
    window.diagnosis = {
      running: true,
      reason: 'safe-mode',
      text: 'OBS started in Safe Mode, which turns its connection to UniversalCollab off. Restart OBS to start it normally.',
      actions: ['restart'],
      facts: { safeMode: true, logFile: '2026-11-01 10-00-00.txt' }
    };
    bridge.obs = async (op, input = {}) => {
      if (op === 'obs-diagnose' || op === 'bundled-restart' || op === 'obs-window-show') {
        calls.push({ obs: op, input });
        return op === 'obs-diagnose' ? window.diagnosis : op === 'obs-window-show' ? { shown: true } : {};
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
  assert.equal(await page.locator('#obsStuck').isHidden(), true, 'not before 20 seconds');
  await page.waitForFunction(() => /Safe Mode/.test(document.getElementById('notice').textContent), null, {
    timeout: 30000
  });
  assert.match(await page.locator('#obsStuck').textContent(), /^OBS started in Safe Mode.*Restart OBS/);
  assert.deepEqual(await page.locator('#obsStuck button').allTextContents(), ['Restart OBS', 'Copy details']);
  // Restart OBS: asks main to restart it; the box goes until the next diagnosis.
  await page.locator('#obsStuck button', { hasText: 'Restart OBS' }).click();
  await page.waitForFunction(() => window.calls.some(c => c.obs === 'bundled-restart'));
  await page.waitForFunction(() => document.getElementById('obsStuck').hidden);
  // Still not connecting, now for another reason: a question waiting, with Show OBS.
  await page.evaluate(() => {
    window.diagnosis = {
      running: true,
      reason: 'dialog',
      text: 'OBS is showing a window waiting for an answer: "OBS Studio". Show OBS to answer it.',
      actions: ['show', 'restart'],
      facts: {}
    };
  });
  await page.waitForFunction(
    () => /waiting for an answer/.test(document.getElementById('obsStuck').textContent),
    null,
    {
      timeout: 40000
    }
  );
  await page.locator('#obsStuck button', { hasText: 'Show OBS' }).click();
  await page.waitForFunction(() => window.calls.some(c => c.obs === 'obs-window-show'));
  // Your own OBS, reason unknown: a button to the OBS connection settings.
  await page.evaluate(() => {
    window.diagnosis = {
      running: true,
      reason: 'unknown',
      text: 'UniversalCollab cannot reach your OBS on port 4455. In OBS: Tools → WebSocket Server Settings.',
      actions: ['settings'],
      facts: {}
    };
  });
  await page.waitForFunction(
    () => /cannot reach your OBS/.test(document.getElementById('obsStuck').textContent),
    null,
    {
      timeout: 40000
    }
  );
  await page.locator('#obsStuck button', { hasText: 'OBS connection settings' }).click();
  await page.waitForFunction(() => document.getElementById('obsPairWindow').open);
  await page.evaluate(() => document.getElementById('obsPairWindow').close());
  // Connected: cleared.
  await page.evaluate(() => (window.obsBlocked = false));
  await page.waitForFunction(() => window.obsConnected === true, null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('obsStuck').hidden);
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'OBS connected.');
  assert.deepEqual(errors, []);
  console.log(
    'PASS OBS not accepting connections: reason after 20 seconds, Restart / Show OBS, cleared when it connects.'
  );
} finally {
  await browser.close();
}
