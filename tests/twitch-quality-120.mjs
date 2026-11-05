// Twitch quality check (1.2.0): warns when Twitch is set to, or is getting, a lower quality than other platforms.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { settingsGaps, liveGaps } = createRequire(import.meta.url)('../DesktopSource/twitch-quality.js');

// Settings: empty means the same as the source.
const src = { size: '', bitrateKbps: null, fps: null };
assert.deepEqual(settingsGaps({ ...src, name: 'Twitch' }, [{ ...src, name: 'YouTube' }]), []);
assert.deepEqual(settingsGaps({ ...src, size: '1280x720' }, [{ ...src, name: 'YouTube' }]), [
  'Twitch is 720p but YouTube is source size.'
]);
assert.deepEqual(
  settingsGaps({ ...src, size: '1920x1080' }, [{ ...src, name: 'Kick', size: '1920x1080' }]),
  []
);
assert.match(
  settingsGaps({ ...src, fps: 30 }, [{ ...src, name: 'Kick', fps: 60 }])[0],
  /30 fps but Kick is 60 fps/
);
assert.match(
  settingsGaps({ ...src, bitrateKbps: 4500 }, [{ ...src, name: 'YouTube', bitrateKbps: 8000 }])[0],
  /4\.5 Mbps but YouTube is 8 Mbps/
);
assert.deepEqual(
  settingsGaps({ ...src, bitrateKbps: 6000 }, [{ ...src, name: 'YouTube' }]),
  [],
  'auto bitrate is not compared'
);
assert.deepEqual(settingsGaps({ ...src }, [{ ...src, name: 'YouTube', size: '1280x720', fps: 30 }]), []);
// Live: small differences are noise.
assert.deepEqual(liveGaps({ kbps: 5800, fps: 59 }, [{ name: 'YouTube', kbps: 6200, fps: 60 }]), []);
assert.match(
  liveGaps({ kbps: 6000, fps: 30 }, [{ name: 'YouTube', kbps: 6000, fps: 60 }])[0],
  /30 fps but YouTube 60/
);
assert.match(
  liveGaps({ kbps: 3000, fps: 60 }, [{ name: 'Kick', kbps: 6000, fps: 60 }])[0],
  /3000 kbps but Kick 6000/
);

const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => window.twitchQuality && document.getElementById('twitchQualityWarning'));
  // Preparing: destination rows as studio-ui.js builds them.
  await page.evaluate(() => {
    document.getElementById('productionForm').hidden = false;
    const list = document.getElementById('productionDestinations');
    list.replaceChildren();
    const sizes = ['', '1920x1080', '1280x720'];
    for (const [id, name] of [
      ['twitch', 'Twitch'],
      ['youtube', 'YouTube']
    ]) {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = id;
      box.checked = true;
      label.append(box, document.createTextNode(name));
      const row = document.createElement('div');
      for (const [aria, values] of [
        ['output resolution', sizes],
        ['video bitrate', ['', '4500', '8000']],
        ['frame rate', ['', '60', '30']]
      ]) {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', name + ' ' + aria);
        for (const v of values) sel.append(new Option(v || 'source', v));
        row.append(sel);
      }
      label.append(row);
      list.append(label);
    }
  });
  const warning = page.locator('#twitchQualityWarning');
  const choose = (label, value) =>
    page.evaluate(
      ([label, value]) => {
        const sel = document.querySelector(`select[aria-label="${label}"]`);
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [label, value]
    );
  const tick = on =>
    page.evaluate(on => {
      const box = document.querySelector('#productionDestinations input[value=twitch]');
      box.checked = on;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, on);
  const shown = on =>
    page.waitForFunction(on => !document.getElementById('twitchQualityWarning').hidden === on, on);
  await shown(false);
  await choose('Twitch output resolution', '1280x720');
  await shown(true);
  assert.match(await warning.textContent(), /Twitch is 720p but YouTube is source size/);
  // Twitch no longer selected: nothing to compare.
  await tick(false);
  await shown(false);
  await tick(true);
  await choose('YouTube output resolution', '1280x720');
  await shown(false);
  await choose('Twitch frame rate', '30');
  await shown(true);
  // Create & prepare asks first; No stops it.
  let asked = '';
  page.once('dialog', d => {
    asked = d.message();
    d.dismiss();
  });
  // A later submit listener stands in for the form's own handler.
  await page.evaluate(() =>
    document.getElementById('productionForm').addEventListener('submit', e => {
      e.preventDefault();
      window.reached = (window.reached || 0) + 1;
    })
  );
  const submit = () =>
    page.evaluate(() =>
      document.getElementById('productionForm').dispatchEvent(new Event('submit', { cancelable: true }))
    );
  await submit();
  assert.match(asked, /Twitch is 30 fps but YouTube is source fps/);
  assert.equal(await page.evaluate(() => window.reached || 0), 0, 'No stops Create & prepare');
  page.once('dialog', d => d.accept());
  await submit();
  assert.equal(await page.evaluate(() => window.reached || 0), 1, 'Yes continues');

  // Live: Twitch at 30 fps for 30 seconds while YouTube gets 60.
  await page.evaluate(() =>
    setInterval(() => {
      view.status.broadcast = { id: 'b' };
      view.status.outputs = [
        { id: 'twitch', name: 'Twitch', state: 'sending', bitrateKbps: 6000, fps: 30, reconnects: 0 },
        { id: 'youtube', name: 'YouTube', state: 'sending', bitrateKbps: 6000, fps: 60, reconnects: 0 }
      ];
    }, 100)
  );
  const liveWarning = page.locator('#destinationHealthCard #twitchQualityLive');
  await page.waitForTimeout(5000);
  assert.equal(await liveWarning.isVisible(), false, 'not before 30 seconds of measurements');
  await page.waitForFunction(() => !document.getElementById('twitchQualityLive').hidden, null, {
    timeout: 40000
  });
  assert.match(await liveWarning.textContent(), /Twitch is getting 30 fps but YouTube 60 fps/);
  assert.match(await page.locator('#notice').textContent(), /Twitch is streaming at a lower quality/);
  assert.deepEqual(errors, []);
  console.log('PASS Twitch quality check: settings warning and confirmation, live warning after 30 seconds.');
} finally {
  await browser.close();
}
