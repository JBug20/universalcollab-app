// Compact studio (1.0.0-rc.8): OBS mixer meters and the End Relay controls.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
// The main flow runs against a 1.2.0 relay (text, picture and browser sources go to the relay); the last
// part runs against a relay without the media API, like the rc.8 relay published on GitHub.
const { browser, page, errors } = await openStudio({
  initScript: () => (window.relayCaps = { mediaSourcesApi: 1, mediaSources: true })
});
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

  // Text sources survive saving, relay scene switches and presets.
  await page.evaluate(() => {
    document.getElementById('canvasSource').value = 'text:new';
    document.getElementById('canvasAdd').click();
  });
  // The text is typed in the source settings window (no prompt box).
  await page.locator('#sourcePropertiesWindow textarea').fill('Hello chat');
  await page.locator('#sourcePropertiesWindow input[type=submit]').click();
  const textItems = () => page.locator('#layoutPreview .canvas-item.text').count();
  assert.equal(await textItems(), 1);
  assert(await page.evaluate(() => window.streamCanvas.save()));
  assert.equal(await textItems(), 1, 'a saved text source disappeared from the editor');
  assert(
    await page.evaluate(() =>
      calls.some(c => c.route?.endsWith('/settings') && c.body.mediaOverlays?.[0]?.text === 'Hello chat')
    )
  );
  await page.evaluate(() => window.streamCanvas.restore(window.streamCanvas.snapshot()));
  assert.equal(await textItems(), 1, 'switching relay scenes dropped the text source');
  await page.evaluate(() => {
    const withText = window.streamCanvas.snapshot();
    window.streamCanvas.restore({ items: [{ id: 'main', kind: 'main', x: 0, y: 0, width: 1, height: 1 }] });
    window.sceneWithText = withText;
  });
  assert.equal(
    await page.locator('#fallbackTimeout').inputValue(),
    '5',
    'a scene switch reset the auto-end timer'
  );
  assert.equal(await page.locator('#fallback1').inputValue(), 'bob', 'a scene switch cleared the fallback');
  await page.evaluate(() => window.streamCanvas.restore(window.sceneWithText));
  await page.evaluate(() => {
    document.getElementById('streamPresetName').value = 'With text';
    document.getElementById('saveStreamPreset').click();
    document.getElementById('streamPresetSelect').value = 'With text';
    document.getElementById('loadStreamPreset').click();
  });
  assert.equal(await textItems(), 1, 'loading a preset dropped the text source');
  assert.deepEqual(errors, []);

  // A relay without the media API (like rc.8): the source stays on this PC, saving still works, and nothing
  // media-related is sent for the relay to reject.
  {
    const old = await openStudio();
    try {
      await old.page.evaluate(() => document.getElementById('serverConnect').click());
      await old.page.waitForSelector('#canvasSource', { state: 'attached' });
      await old.page.evaluate(() => {
        document.getElementById('canvasSource').value = 'text:new';
        document.getElementById('canvasAdd').click();
      });
      await old.page.locator('#sourcePropertiesWindow textarea').fill('Hello chat');
      await old.page.locator('#sourcePropertiesWindow input[type=submit]').click();
      const oldText = () => old.page.locator('#layoutPreview .canvas-item.text').count();
      assert.equal(await oldText(), 1);
      assert(await old.page.evaluate(() => window.streamCanvas.save()), 'saving works with an older relay');
      const body = await old.page.evaluate(
        () => calls.filter(c => c.route?.endsWith('/settings')).at(-1).body
      );
      assert.equal(body.mediaOverlays, undefined, 'sources are not sent to a relay that cannot take them');
      assert.equal(await oldText(), 1, 'the source stays in the editor');
      assert.deepEqual(old.errors, []);
    } finally {
      await old.browser.close();
    }
  }
  console.log(
    'PASS mixer meters on a dB scale and after reconnect, End Relay placement and confirmation, auto-end timer and fallback saved from its settings, text sources kept through save, scene switch and preset, and kept local with a relay that has no media API.'
  );
} finally {
  await browser.close();
}
