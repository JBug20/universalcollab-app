// Clip button (1.2.0) in Stream controls: first press starts the replay buffer, then each press saves a clip
// and offers Show file; Start Stream also starts the replay buffer.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    let active = false,
      n = 0;
    const original = window.relayDesktop.obs;
    window.relayDesktop.obs = async (op, input = {}) => {
      if (op === 'replay-start') {
        calls.push({ obs: op, input });
        active = true;
        return { supported: true, active: true, started: true, seconds: 60 };
      }
      if (op === 'clip') {
        calls.push({ obs: op, input });
        if (window.clipError) throw Error(window.clipError);
        if (window.clipSlow) await new Promise(r => setTimeout(r, 1500));
        if (!active) return window.relayDesktop.obs('replay-start');
        n++;
        return {
          supported: true,
          active: true,
          saved: true,
          seconds: 60,
          path: 'C:\\Videos\\Replay ' + n + '.mkv'
        };
      }
      if (op === 'clip-show') {
        calls.push({ obs: op, input });
        return { shown: true, path: input.path };
      }
      return original(op, input);
    };
    document.getElementById('serverConnect').click();
  });
  const clip = page.locator('#obsClip');
  await clip.waitFor({ state: 'visible' });
  const note = page.locator('#obsClipNote');

  await clip.click();
  await page.waitForFunction(() =>
    /Replay buffer started/.test(document.getElementById('obsClipNote').textContent)
  );
  assert.match(await note.innerText(), /last 60 seconds/);

  await clip.click();
  await page.waitForFunction(() =>
    /Clip saved: Replay 1\.mkv/.test(document.getElementById('obsClipNote').textContent)
  );
  await note.getByRole('button', { name: 'Show file' }).click();
  await page.waitForFunction(() => calls.some(c => c.obs === 'clip-show'));
  assert.equal(
    await page.evaluate(() => calls.find(c => c.obs === 'clip-show').input.path),
    'C:\\Videos\\Replay 1.mkv'
  );

  // The Clip button sits right after Start/Stop Recording (and Pause, shown while recording).
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#streamsPanel button')].map(b => b.id)
  );
  assert.equal(order.indexOf('obsRecordPause'), order.indexOf('obsRecord') + 1, order.join());
  assert.equal(order.indexOf('obsClip'), order.indexOf('obsRecordPause') + 1, order.join());
  // While it saves, it says so; a second click meanwhile is not silently ignored.
  await page.evaluate(() => (window.clipSlow = true));
  await page.locator('#obsClip').click();
  assert.equal(await page.locator('#obsClipNote').textContent(), 'Saving clip…');
  await page.evaluate(() => document.getElementById('obsClip').onclick());
  assert.match(await page.locator('#notice').textContent(), /still finishing the last OBS action/);
  await page.waitForFunction(() => /Clip saved/.test(document.getElementById('obsClipNote').textContent));
  await page.evaluate(() => (window.clipSlow = false));
  // A failure is shown under the button and in the notice line, not only in the OBS settings window.
  await page.evaluate(
    () =>
      (window.clipError =
        'Turn on the replay buffer in OBS (Settings → Output → Replay Buffer → Enable Replay Buffer), then press Clip again.')
  );
  await page.locator('#obsClip').click();
  await page.waitForFunction(() =>
    /Clip failed: Turn on the replay buffer/.test(document.getElementById('obsClipNote').textContent)
  );
  assert.match(await page.locator('#notice').textContent(), /Turn on the replay buffer/);
  assert.deepEqual(errors, []);
  console.log('PASS clip UI: starts the replay buffer, saves clips, Show file sends the saved path.');
} finally {
  await browser.close();
}
