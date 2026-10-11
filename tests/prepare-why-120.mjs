// Prepare stream (1.2.0): when Create & prepare is greyed out, the reason is shown next to it (not connected to a
// relay, a broadcast running); once it can be used the note goes away.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  const why = () =>
    page.evaluate(() =>
      document.getElementById('prepareWhy')?.hidden ? '' : document.getElementById('prepareWhy')?.textContent
    );
  await page.waitForFunction(() => document.getElementById('prepareWhy'));
  assert.equal(await page.locator('#prepareStream').isDisabled(), true);
  assert.match(await why(), /Connect to a relay first \(Settings → Relay\)/);
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => connected && !document.getElementById('prepareStream').disabled);
  await page.waitForFunction(() => document.getElementById('prepareWhy').hidden);
  // A broadcast running.
  await page.evaluate(() => {
    window.live = true;
    return refresh();
  });
  await page.waitForFunction(() =>
    /End the relay broadcast/.test(document.getElementById('prepareWhy').textContent)
  );
  assert.equal(await page.locator('#prepareStream').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS prepare stream: says why Create & prepare is greyed out.');
} finally {
  await browser.close();
}
