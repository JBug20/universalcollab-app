// Clip with the user's own OBS when its replay buffer is switched off: Clip says where to turn it on, the
// button works again afterwards, and Start Stream is not held up by the missing replay buffer.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  const message =
    'Turn on the replay buffer in OBS (Settings → Output → Replay Buffer → Enable Replay Buffer), then press Clip again.';
  await page.evaluate(msg => {
    const original = window.relayDesktop.obs;
    window.relayDesktop.obs = async (op, input = {}) => {
      if (op === 'clip' || op === 'replay-start') {
        calls.push({ obs: op, input });
        throw new Error(msg);
      }
      return original(op, input);
    };
    document.getElementById('serverConnect').click();
  }, message);
  const clip = page.locator('#obsClip');
  await clip.waitFor({ state: 'visible' });

  // Pressing Clip shows the instruction where the user will see it, and nothing claims a clip was saved.
  await clip.click();
  await page.waitForFunction(m => document.getElementById('obsControlStatus').innerText.includes(m), message);
  assert.equal(await page.locator('#obsClipNote').isHidden(), true, 'no "Clip saved" message');
  await page.waitForFunction(() => !document.getElementById('obsClip').disabled);

  // Start Stream still starts: the replay buffer is only a bonus, and its failure is not shown as an error.
  await page.evaluate(() => (document.getElementById('obsControlStatus').textContent = ''));
  await page.locator('#startStream').click();
  await page.waitForFunction(() => calls.some(c => c.obs === 'start'));
  await page.waitForFunction(() => calls.some(c => c.obs === 'replay-start'));
  await page.waitForFunction(() =>
    /Stream started in OBS/.test(document.getElementById('obsControlStatus').innerText)
  );
  assert(!(await page.locator('#obsControlStatus').innerText()).includes('replay buffer'));
  assert.deepEqual(errors, []);
  console.log(
    'PASS clip with the replay buffer off: instructions shown, button recovers, Start Stream unaffected.'
  );
} finally {
  await browser.close();
}
