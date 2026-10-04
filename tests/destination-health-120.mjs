// Destination health (1.2.0): platform icons coloured by output health, in the real page with its
// Content-Security-Policy (which blocks inline <style> blocks, so the colours must come from portal.css).
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForSelector('#destinationHealthCard .destination-icons button');
  const icons = () =>
    page.$$eval('#destinationHealthCard .destination-icons button', buttons =>
      buttons.map(b => ({
        platform: b.dataset.platform,
        health: b.dataset.health,
        border: getComputedStyle(b).borderTopColor,
        fill: getComputedStyle(b.querySelector('svg')).fill
      }))
    );

  // Live with no outputs reported: every platform is grey.
  let shown = await icons();
  assert.deepEqual(
    shown.map(i => i.platform + '=' + i.health),
    ['youtube=disconnected', 'twitch=disconnected', 'kick=disconnected']
  );

  // Sending is green, any other state is yellow, a missing platform stays grey; the colours really apply.
  await page.evaluate(() =>
    setInterval(() => {
      view.status.outputs = [
        { id: 'twitch', name: 'Twitch', state: 'sending', bitrateKbps: 6000, fps: 60, reconnects: 0 },
        { id: 'youtube', name: 'YouTube', state: 'reconnecting', bitrateKbps: 0, fps: 0, reconnects: 1 }
      ];
    }, 100)
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#destinationHealthCard [data-platform=twitch]')?.dataset.health === 'healthy'
  );
  shown = Object.fromEntries((await icons()).map(i => [i.platform, i]));
  assert.equal(shown.youtube.health, 'issues');
  assert.equal(shown.kick.health, 'disconnected');
  assert.equal(shown.twitch.border, 'rgb(62, 207, 110)', 'green border did not apply');
  assert.equal(shown.twitch.fill, 'rgb(62, 207, 110)', 'green icon did not apply');
  assert.equal(shown.youtube.fill, 'rgb(242, 194, 48)', 'yellow icon did not apply');
  assert.equal(shown.kick.fill, 'rgb(125, 120, 137)', 'grey icon did not apply');

  // Hovering shows a positioned box with kbps and fps.
  await page.hover('#destinationHealthCard [data-platform=twitch]');
  const tip = page.locator('.destination-tip');
  await tip.waitFor({ state: 'visible' });
  assert.equal(await tip.evaluate(t => getComputedStyle(t).position), 'fixed');
  assert.match(await tip.innerText(), /6000 kbps · 60 fps/);

  assert.deepEqual(errors, []);
  console.log('PASS destination health: icon colours apply under the page CSP; hover shows kbps and fps.');
} finally {
  await browser.close();
}
