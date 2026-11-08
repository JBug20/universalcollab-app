// Stream labels (1.2.0), window side: Stream Assist events update the label files, Tools → Stream labels shows what
// each label says now, own formats are used, Add to OBS asks the app, and a new relay broadcast starts the "this
// stream" labels from zero while the latest ones stay.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.openStreamLabels && window.streamLabels);
  // The files exist from the start.
  await page.waitForFunction(() => window.labelFiles && 'latest_follower' in window.labelFiles);
  const assist = alerts =>
    page.evaluate(
      alerts => window.dispatchEvent(new CustomEvent('integrated-assist-state', { detail: { alerts } })),
      alerts
    );
  await assist([{ id: 'a0', kind: 'Follow', name: 'Yesterday', platform: 'Twitch' }]);
  await assist([
    { id: 'a3', kind: 'Cheer', name: 'Bitsy', detail: '300 bits  wow', platform: 'Twitch' },
    { id: 'a2', kind: 'Follow', name: 'Ada', detail: 'Welcome', platform: 'Kick' },
    { id: 'a1', kind: 'SuperChat', name: 'Fan', detail: '$10.00  hi', platform: 'YouTube' },
    { id: 'a0', kind: 'Follow', name: 'Yesterday', platform: 'Twitch' }
  ]);
  await page.waitForFunction(() => window.labelFiles.latest_follower === 'Ada');
  const files = await page.evaluate(() => window.labelFiles);
  assert.equal(files.latest_cheer, 'Bitsy (300 bits)');
  assert.equal(files.latest_superchat, 'Fan ($10.00)');
  assert.equal(files.session_follower_count, '1', 'Yesterday was before the stream');
  assert.equal(files.session_bits, '300');

  // Tools → Stream labels.
  await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Tools'
    );
    menu.open = true;
  });
  await page.locator('.app-menu[open] .menu-popup').getByText('Stream labels').click();
  const win = page.locator('#streamLabelsWindow');
  await win.waitFor({ state: 'visible' });
  assert.match(await page.locator('#streamLabelsFolder').textContent(), /Stream Labels/);
  const row = id => win.locator(`.labels-row[data-label="${id}"]`);
  assert.equal(await row('latest_follower').locator('.labels-now').textContent(), 'Ada');
  assert.equal(await row('latest_raid').locator('.labels-now').textContent(), '—');
  // An own format.
  await row('latest_follower').locator('input').fill('New: {name} ({platform})');
  await row('latest_follower').locator('input').dispatchEvent('change');
  await page.waitForFunction(() => window.labelFiles.latest_follower === 'New: Ada (Kick)');
  // "Nothing yet" text.
  await page.locator('#streamLabelsEmpty').fill('None yet');
  await page.locator('#streamLabelsEmpty').dispatchEvent('change');
  await page.waitForFunction(() => window.labelFiles.latest_raid === 'None yet');
  // Add to OBS.
  await row('latest_cheer').getByRole('button', { name: 'Add to OBS' }).click();
  await page.waitForFunction(() =>
    calls.some(c => c.labels === 'add-to-obs' && c.input.id === 'latest_cheer')
  );
  await page.waitForFunction(() => /is in the OBS scene "Live"/.test(streamLabelsStatus.textContent));
  await page.evaluate(() => (window.labelsOBSFail = 'Connect to OBS first (Settings → OBS).'));
  await row('latest_cheer').getByRole('button', { name: 'Add to OBS' }).click();
  await page.waitForFunction(() => /Connect to OBS first/.test(streamLabelsStatus.textContent));

  // A new relay broadcast: "this stream" labels from zero, latest ones kept.
  await page.evaluate(() => {
    window.live = false;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && view?.status && !view.status.broadcast);
  // The app checks once a second; under load that can be late, so give it a few seconds to see "not live".
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.live = true;
    return refresh();
  });
  await page.waitForFunction(() => window.labelFiles.session_bits === '0', null, { timeout: 60000 });
  const after = await page.evaluate(() => window.labelFiles);
  assert.equal(after.session_follower_count, '0');
  assert.equal(after.latest_cheer, 'Bitsy (300 bits)');
  // Kept for the next start: the formats and the latest labels are saved. (Not checked with a reload: headless
  // Chromium sometimes drops a file:// page's storage on reload, which the app never sees.)
  const saved = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('uc-stream-labels-settings')),
    state: JSON.parse(localStorage.getItem('uc-stream-labels'))
  }));
  assert.equal(saved.settings.formats.latest_follower, 'New: {name} ({platform})');
  assert.equal(saved.settings.empty, 'None yet');
  assert.equal(saved.state.latest.follower.name, 'Ada');
  assert.equal(saved.state.session.bits, 0);
  const restored = await page.evaluate(
    s => window.streamLabels.texts(s.state, s.settings).latest_follower,
    saved
  );
  assert.equal(restored, 'New: Ada (Kick)');
  assert.deepEqual(errors, []);
  console.log(
    'PASS stream labels window: files follow events, formats, Add to OBS, new stream, saved for the next start.'
  );
} finally {
  await browser.close();
}
