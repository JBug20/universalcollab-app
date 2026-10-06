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

  // The Clip button sits right after Start/Stop Recording.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#streamsPanel button')].map(b => b.id)
  );
  assert.equal(order.indexOf('obsClip'), order.indexOf('obsRecord') + 1, order.join());
  assert.deepEqual(errors, []);
  console.log('PASS clip UI: starts the replay buffer, saves clips, Show file sends the saved path.');
} finally {
  await browser.close();
}
