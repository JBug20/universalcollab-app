// Vertical clips (1.2.0), window: Settings → OBS → Vertical clips is off by default; when on, each clip also gets a
// vertical copy, with the webcam found in the live OBS scene for the facecam layout (or the chosen source); the
// result or the reason it failed shows in the notice line.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
const T = x => ({
  positionX: 0,
  positionY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alignment: 5,
  boundsType: 'OBS_BOUNDS_NONE',
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  sourceWidth: 1920,
  sourceHeight: 1080,
  ...x
});
const items = [
  {
    sceneItemId: 1,
    sourceName: 'Game',
    inputKind: 'game_capture',
    sceneItemIndex: 0,
    sceneItemEnabled: true,
    sceneItemLocked: false,
    sceneItemTransform: T()
  },
  {
    sceneItemId: 2,
    sourceName: 'Facecam',
    inputKind: 'dshow_input',
    sceneItemIndex: 1,
    sceneItemEnabled: true,
    sceneItemLocked: false,
    sceneItemTransform: T({ positionX: 1440, positionY: 760, scaleX: 0.25, scaleY: 0.25 })
  }
];
const vertical = () => page.evaluate(() => window.calls.filter(c => c.vertical).map(c => c.vertical));
try {
  await page.evaluate(items => {
    window.fakeEditor = { base: { width: 1920, height: 1080 }, items };
    window.clipPath = 'D:\\Rec\\Replay 1.mp4';
    document.getElementById('serverConnect').click();
  }, items);
  await page.waitForFunction(
    () => window.obsConnected && window.streamControls && window.verticalClips?.refresh
  );
  await page.evaluate(() => window.workspaceUI.openSettings('obs'));
  await page.locator('#verticalClipOn').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#verticalClipOn').isChecked(), false, 'off by default');
  assert.equal(await page.locator('#verticalClipLayout').isDisabled(), true);
  // Off: clips stay as they are.
  await page.evaluate(() => window.streamControls.clip());
  await page.waitForTimeout(500);
  assert.equal((await vertical()).length, 0);

  // On: the webcam in the live scene is found.
  await page.locator('#verticalClipOn').check();
  await page.waitForFunction(() =>
    /Facecam: "Facecam" in the live scene/.test(document.getElementById('verticalClipInfo').textContent)
  );
  assert.deepEqual(await page.locator('#verticalClipCam option').allTextContents(), [
    'Find my webcam automatically',
    'Game',
    'Facecam'
  ]);
  // While it is made, the line under Clip says how far it is; then the file, with Show file.
  await page.evaluate(() => {
    window.verticalHold = new Promise(r => (window.releaseVertical = r));
  });
  await page.evaluate(() => window.streamControls.clip());
  await page.waitForFunction(() =>
    /Making the vertical copy: 0:42 of 1:00 · 1 more waiting/.test(
      document.getElementById('verticalClipStatus').textContent
    )
  );
  await page.evaluate(() => window.releaseVertical());
  await page.waitForFunction(() =>
    /Vertical clip saved: Replay 1 \(vertical\)\.mp4/.test(document.getElementById('notice').textContent)
  );
  assert.match(
    await page.locator('#verticalClipStatus').textContent(),
    /^Vertical clip saved: Replay 1 \(vertical\)\.mp4 Show file$/
  );
  await page.locator('#verticalClipStatus button', { hasText: 'Show file' }).click();
  await page.waitForFunction(() =>
    window.calls.some(c => c.obs === 'clip-show' && /\(vertical\)/.test(c.input.path))
  );
  await page.evaluate(() => (window.verticalHold = null));
  const [first] = await vertical();
  assert.equal(first.file, 'D:\\Rec\\Replay 1.mp4');
  assert.equal(first.layout, 'stack');
  assert.equal(first.facecam.name, 'Facecam');
  assert(Math.abs(first.facecam.x - 0.75) < 0.001 && Math.abs(first.facecam.w - 0.25) < 0.001);

  // Another layout; a failure is reported.
  await page.locator('#verticalClipLayout').selectOption('blur');
  assert.equal(
    await page.locator('#verticalClipCam').locator('xpath=..').isHidden(),
    true,
    'facecam only for that layout'
  );
  await page.evaluate(() => (window.verticalFail = 'This clip is MKV. Vertical copies need MP4.'));
  await page.evaluate(() => window.streamControls.clip());
  await page.waitForFunction(() =>
    /Vertical clip: This clip is MKV/.test(document.getElementById('notice').textContent)
  );
  // The failure stays visible under Clip.
  assert.match(
    await page.locator('#verticalClipStatus').textContent(),
    /^Vertical copy failed: This clip is MKV/
  );
  assert.equal(await page.locator('#verticalClipStatus').evaluate(n => n.classList.contains('bad')), true);
  // OBS did not say where it saved the clip: said, not silent.
  await page.evaluate(() => {
    window.verticalFail = '';
    window.dispatchEvent(new CustomEvent('obs-clip-saved', { detail: { path: '' } }));
  });
  await page.waitForFunction(() =>
    /No vertical copy: OBS saved the clip but did not say where/.test(
      document.getElementById('verticalClipStatus').textContent
    )
  );
  assert.equal((await vertical()).at(-1).layout, 'blur');
  assert.equal((await vertical()).at(-1).facecam, null);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('uc-vertical-clips'))), {
    on: true,
    layout: 'blur',
    camera: ''
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS vertical clips window: off by default, facecam found, copy after each clip, failures reported.'
  );
} finally {
  await browser.close();
}
