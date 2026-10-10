// Destination alerts (1.2.0): a destination not receiving for 20 seconds during a broadcast raises one alert
// (sound + notice + card line); receiving again says so; paused outputs and short blips do not alert.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { step, text } = createRequire(import.meta.url)('../DesktopSource/destination-alerts.js');

const yt = state => ({ id: 'youtube', name: 'YouTube', state });
const known = new Map();
assert.deepEqual(step([yt('sending')], 0, known), []);
assert.deepEqual(step([yt('reconnecting')], 1000, known), [], 'not straight away');
assert.deepEqual(step([yt('reconnecting')], 15000, known), []);
assert.deepEqual(step([yt('sending')], 16000, known), [], 'a short blip that recovers says nothing');
step([yt('stalled')], 17000, known);
let e = step([yt('stalled')], 37000, known);
assert.equal(e.length, 1);
assert.equal(e[0].type, 'down');
assert.match(text(e[0]), /YouTube stopped receiving your stream: it has stalled/);
assert.deepEqual(step([yt('reconnecting')], 60000, known), [], 'once per drop');
e = step([yt('sending')], 61000, known);
assert.equal(e[0].type, 'back');
assert.equal(text(e[0]), 'YouTube is receiving your stream again.');
assert.deepEqual(step([yt('paused')], 62000, known), []);
assert.deepEqual(step([yt('paused')], 200000, known), [], 'paused on purpose: no alert');

const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
    window.outs = [
      { id: 'twitch', name: 'Twitch', state: 'sending', bitrateKbps: 6000, fps: 60, reconnects: 0 },
      { id: 'kick', name: 'Kick', state: 'sending', bitrateKbps: 6000, fps: 60, reconnects: 0 }
    ];
    setInterval(() => {
      view.status.broadcast = { id: 'b' };
      view.status.outputs = window.outs;
    }, 100);
  });
  await page.waitForSelector('#destinationHealthCard #destinationAlertSound');
  assert.equal(await page.locator('#destinationAlertSound').isChecked(), true, 'sound on by default');
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window.outs = [window.outs[0], { ...window.outs[1], state: 'reconnecting' }]));
  await page.waitForTimeout(10000);
  assert.equal(await page.evaluate(() => window.destinationAlertBeeps || 0), 0, 'nothing before 20 seconds');
  await page.waitForFunction(
    () => /Kick stopped receiving/.test(document.getElementById('notice').textContent),
    null,
    {
      timeout: 20000
    }
  );
  assert.equal(await page.evaluate(() => window.destinationAlertBeeps), 1);
  assert.match(
    await page.locator('#destinationAlerts .quality-warning').textContent(),
    /Not receiving your stream: Kick/
  );
  await page.evaluate(() => (window.outs = window.outs.map(o => ({ ...o, state: 'sending' }))));
  await page.waitForFunction(
    () => document.getElementById('notice').textContent === 'Kick is receiving your stream again.'
  );
  assert.equal(await page.locator('#destinationAlerts .quality-warning').isVisible(), false);
  assert.equal(await page.evaluate(() => window.destinationAlertBeeps), 2);
  // Sound off: still told, no sound; remembered.
  await page.locator('#destinationAlertSound').uncheck();
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-destination-alert-sound')), 'false');
  await page.evaluate(() => (window.outs = [{ ...window.outs[0], state: 'stalled' }, window.outs[1]]));
  await page.waitForFunction(
    () => /Twitch stopped receiving/.test(document.getElementById('notice').textContent),
    null,
    {
      timeout: 30000
    }
  );
  assert.equal(await page.evaluate(() => window.destinationAlertBeeps), 2, 'no sound when turned off');
  assert.deepEqual(errors, []);
  console.log('PASS destination alerts: after 20 seconds, once per drop, back again, sound setting.');
} finally {
  await browser.close();
}
