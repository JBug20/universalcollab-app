// Compact studio (1.0.0-rc.8): OBS mixer meters and the End Relay controls.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  const meterCalls = () =>
    page.evaluate(() => calls.filter(c => c.obs === 'meters').map(c => c.input.enabled));
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => document.querySelectorAll('#obsMixer .obs-meter').length === 2);
  await page.waitForFunction(() => calls.some(c => c.obs === 'meters' && c.input.enabled));

  // Meters use a dB scale: -6 dB (0.5) sits at 90%, silence at the bottom, clipping at the top.
  const levels = async inputs => {
    await page.evaluate(i => emitOBS({ type: 'meters', inputs: i }), inputs);
    return page.evaluate(() =>
      [...document.querySelectorAll('#obsMixer .obs-meter')].map(m =>
        Number(m.style.getPropertyValue('--level'))
      )
    );
  };
  let [mic, desktop] = await levels([
    { name: 'Mic', level: 0.5 },
    { name: 'Desktop Audio', level: 0 }
  ]);
  assert(Math.abs(mic - 0.9) < 0.01, 'mic at -6 dB should fill 90%, got ' + mic);
  assert.equal(desktop, 0);
  [mic, desktop] = await levels([
    { name: 'Mic', level: 0.001 },
    { name: 'Desktop Audio', level: 1.4 }
  ]);
  assert.equal(mic, 0);
  assert.equal(desktop, 1);
  assert.equal(await page.locator('#obsMixer .obs-meter').first().getAttribute('aria-valuenow'), '-60');

  // After OBS reconnects, the page asks for meter events again.
  const enabledBefore = (await meterCalls()).filter(Boolean).length;
  await page.evaluate(() => {
    emitOBS({ type: 'connection', connected: false });
    emitOBS({ type: 'connection', connected: true });
  });
  await page
    .waitForFunction(
      n => calls.filter(c => c.obs === 'meters' && c.input.enabled).length > n,
      enabledBefore,
      { timeout: 8000 }
    )
    .catch(() => assert.fail('meters were not re-enabled after OBS reconnected'));

  // End Relay sits under Start Stream, asks first, then ends the broadcast.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#streamsPanel button')].map(b => b.id).filter(Boolean)
  );
  assert(
    order.indexOf('endRelay') > order.indexOf('startStream') &&
      order.indexOf('endRelay') > order.indexOf('stopOBSStream'),
    order.join()
  );
  assert(!(await page.locator('#endRelay').isDisabled()));
  page.once('dialog', d => d.dismiss());
  await page.locator('#endRelay').click();
  assert(
    !(await page.evaluate(() => calls.some(c => c.route?.endsWith('/end')))),
    'End Relay must not end without confirmation'
  );
  page.once('dialog', d => d.accept());
  await page.locator('#endRelay').click();
  await page.waitForFunction(() => calls.some(c => c.route?.endsWith('/end')));
  await page.waitForFunction(() => document.getElementById('endRelay').disabled, null, { timeout: 10000 });

  // The gear holds the auto-end timer and fallback choices, and saves them to the relay.
  await page.locator('#endRelaySettings').click();
  for (const id of ['fallbackTimeout', 'fallback1', 'fallback2', 'collab', 'forceFallback'])
    assert(await page.locator('#endRelayWindow #' + id).isVisible(), id + ' missing from End Relay settings');
  await page.locator('#fallbackTimeout').fill('5');
  await page.locator('#fallback1').selectOption('bob');
  await page.waitForTimeout(1500);
  assert.equal(
    await page.locator('#fallbackTimeout').inputValue(),
    '5',
    'refresh overwrote an unsaved timer'
  );
  await page.locator('#endRelaySave').click();
  await page.waitForFunction(() =>
    calls.some(
      c =>
        c.route?.endsWith('/settings') && c.body.fallbackTimeoutMinutes === 5 && c.body.fallback[0] === 'bob'
    )
  );
  assert(!(await page.locator('#endRelayWindow').evaluate(d => d.open)));
  assert.equal(await page.locator('#streamMore').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS mixer meters on a dB scale and after reconnect, End Relay placement and confirmation, auto-end timer and fallback saved from its settings.'
  );
} finally {
  await browser.close();
}
