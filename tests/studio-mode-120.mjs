// Studio Mode: edit in Preview, send to the stream with Transition (relay layout and OBS), and follow OBS.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio({
  initScript: () => {
    window.obsStudio = { enabled: false, preview: null };
  }
});
try {
  const settingsSaves = () =>
    page.evaluate(() => calls.filter(c => c.route?.endsWith('/settings') && c.body).length);
  const obsCalls = op => page.evaluate(o => calls.filter(c => c.obs === o).map(c => c.input), op);
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() =>
    document.getElementById('serverStatus')?.textContent.startsWith('Connected')
  );
  await page.waitForFunction(() => window.obsConnected && window.studioMode);

  // Off by default: the editor sits in its normal place and nothing about studio mode is shown.
  assert.equal(await page.evaluate(() => window.studioMode.enabled), false);
  assert.equal(await page.locator('#studioStage').count(), 0);
  assert.equal(await page.locator('#studioModeToggle').getAttribute('aria-pressed'), 'false');

  // Turn it on: Preview (the editor) and Program side by side, a Transition button, OBS follows.
  await page.evaluate(() => document.getElementById('studioModeToggle').click());
  await page.waitForSelector('#studioStage');
  assert.equal(await page.locator('#studioModeToggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#studioStage .studio-preview-pane #layoutPreview').count(), 1);
  assert.equal(await page.locator('#studioStage #programView').count(), 1);
  assert.equal(await page.locator('#studioTransition').count(), 1);
  assert(await page.evaluate(() => document.body.classList.contains('studio-mode')));
  await page.waitForFunction(() => calls.some(c => c.obs === 'studio-mode' && c.input.enabled === true));
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-studio-mode')), 'true');

  // Edits and scene changes stay in Preview: nothing is sent to the relay.
  const before = await settingsSaves();
  await page.evaluate(() => {
    document.getElementById('sceneName').value = 'Second';
    document.getElementById('sceneNew').click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#sceneList button')].length === 2);
  await page.evaluate(() => document.querySelectorAll('#sceneList button')[0].click());
  await page.waitForTimeout(400);
  assert.equal(await settingsSaves(), before, 'scene changes do not reach the stream in studio mode');

  // Transition sends Preview to the relay and runs OBS's transition.
  await page.evaluate(() => document.getElementById('studioTransition').click());
  await page.waitForFunction(
    n => calls.filter(c => c.route?.endsWith('/settings') && c.body).length > n,
    before
  );
  await page.waitForFunction(() => calls.some(c => c.obs === 'transition'));
  assert.equal((await obsCalls('transition')).length, 1);

  // Selecting an OBS scene sets the OBS preview scene, not the program.
  await page.evaluate(() => (window.obsStudio = { enabled: true, preview: null }));
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#obsScenes button').click());
  await page.waitForFunction(() => calls.some(c => c.obs === 'preview-scene'));
  assert.equal(await page.evaluate(() => calls.some(c => c.obs === 'scene-switch')), false);

  // Turning it off puts the editor back and OBS follows.
  await page.evaluate(() => document.getElementById('studioModeToggle').click());
  await page.waitForFunction(() => !document.getElementById('studioStage'));
  assert.equal(
    await page.evaluate(() => document.getElementById('layoutPreview').closest('.studio-pane')),
    null
  );
  assert(!(await page.evaluate(() => document.body.classList.contains('studio-mode'))));
  await page.waitForFunction(() => calls.filter(c => c.obs === 'studio-mode').at(-1).input.enabled === false);
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-studio-mode')), 'false');

  // Normal mode again: a scene change applies straight away.
  const normal = await settingsSaves();
  await page.evaluate(() => document.querySelectorAll('#sceneList button')[1].click());
  await page.waitForFunction(
    n => calls.filter(c => c.route?.endsWith('/settings') && c.body).length > n,
    normal
  );

  // OBS's own studio mode switch is followed by the app.
  await page.evaluate(() => (window.obsStudio = { enabled: true, preview: 'Main' }));
  await page.waitForFunction(() => window.studioMode.enabled, null, { timeout: 15000 });

  assert.deepEqual(errors, []);
  console.log('PASS Studio Mode: Preview/Program, Transition, OBS preview scene and following OBS.');
} finally {
  await browser.close();
}
