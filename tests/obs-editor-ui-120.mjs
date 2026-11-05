// OBS scene editor (1.2.0), window: the scene's sources get OBS-style boxes over the scene picture; dragging moves
// (snapping to the screen and other sources, Ctrl places freely), handles resize keeping the shape (Shift stretches),
// Alt+drag crops, locked sources do not move, the right-click menu centres/rotates, arrow keys nudge and Ctrl+Z undoes.
// Every change reaches OBS as a transform for that scene item.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio({ viewport: { width: 1600, height: 1000 } });
const T = (x = {}) => ({
  positionX: 0,
  positionY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alignment: 5,
  boundsType: 'OBS_BOUNDS_NONE',
  boundsWidth: 0,
  boundsHeight: 0,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  sourceWidth: 1920,
  sourceHeight: 1080,
  ...x
});
const transform = id =>
  page.evaluate(id => window.fakeEditor.items.find(i => i.sceneItemId === id).sceneItemTransform, id);
const box = id => page.locator(`.obs-ebox[data-id="${id}"]`);
// The editor re-reads OBS every 0.7 s; measure handles only after the boxes show OBS's latest state.
const settle = () => page.waitForTimeout(900);
const near = (a, b, d = 2) => assert(Math.abs(a - b) <= d, `${a} is not about ${b}`);
try {
  const items = [
    {
      sceneItemId: 1,
      sourceName: 'Background',
      sceneItemIndex: 0,
      sceneItemEnabled: true,
      sceneItemLocked: true,
      sceneItemTransform: T()
    },
    {
      sceneItemId: 2,
      sourceName: 'Webcam',
      sceneItemIndex: 1,
      sceneItemEnabled: true,
      sceneItemLocked: false,
      sceneItemTransform: T({
        positionX: 300,
        positionY: 200,
        scaleX: 0.5,
        scaleY: 0.5,
        sourceWidth: 1280,
        sourceHeight: 720
      })
    },
    {
      sceneItemId: 3,
      sourceName: 'Logo',
      sceneItemIndex: 2,
      sceneItemEnabled: true,
      sceneItemLocked: false,
      sceneItemTransform: T({
        positionX: 1700,
        positionY: 100,
        rotation: 90,
        alignment: 0,
        sourceWidth: 200,
        sourceHeight: 100
      })
    },
    {
      sceneItemId: 4,
      sourceName: 'Hidden alert',
      sceneItemIndex: 3,
      sceneItemEnabled: false,
      sceneItemLocked: false,
      sceneItemTransform: T({ sourceWidth: 400, sourceHeight: 200 })
    }
  ];
  await page.evaluate(items => {
    window.fakeScenes = ['Main', 'BRB'];
    window.fakeEditor = { base: { width: 1920, height: 1080 }, items };
    document.getElementById('serverConnect').click();
  }, items);
  await page.waitForFunction(
    () => window.obsConnected && window.openObsSceneEditor && document.getElementById('obsEditOnScreen')
  );
  // Opened from OBS sources → Edit on screen… (or Tools → Edit OBS scene on screen).
  assert.equal(await page.locator('#obsSourcesPanel #obsEditOnScreen').count(), 1);
  await page.evaluate(() => window.openObsSceneEditor(document.getElementById('obsEditScene').value));
  await page.locator('#obsEditor').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('.obs-ebox').length === 3);
  assert.equal(await page.locator('#obsEditorScene').inputValue(), 'Main');
  assert.equal(await page.locator('.obs-editor-row').count(), 4, 'hidden sources are listed');
  assert.equal(await page.locator('#obsEditorImage').getAttribute('src'), 'data:image/jpeg;base64,AAAA');
  const stage = await page.locator('#obsEditorStage').boundingBox();
  const k = stage.width / 1920;
  near(stage.height / stage.width, 1080 / 1920, 0.01);
  // The webcam box sits where OBS has it: 300,200, 640 × 360.
  const b = await box(2).boundingBox();
  near(b.x - stage.x, 300 * k, 1.5);
  near(b.y - stage.y, 200 * k, 1.5);
  near(b.width, 640 * k, 1.5);

  // Move (Ctrl: no snapping).
  const cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move(cx + 100 * k, cy + 50 * k, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => Math.abs(window.fakeEditor.items[1].sceneItemTransform.positionX - 400) < 2
  );
  near((await transform(2)).positionY, 250);
  assert.match(await page.locator('#obsEditorInfo').textContent(), /^Webcam: 400, 250 · 640 × 360/);
  // Snap: dragged to 6 px from the left edge, it lands on 0.
  const b2 = await box(2).boundingBox();
  await page.mouse.move(b2.x + 20, b2.y + 20);
  await page.mouse.down();
  await page.mouse.move(b2.x + 20 - 394 * k, b2.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => window.fakeEditor.items[1].sceneItemTransform.positionX === 0);

  // Resize from the bottom-right corner: keeps 16:9.
  await settle();
  await page.waitForSelector('.obs-ebox[data-id="2"] .obs-ehandle.se');
  const se = await page.locator('.obs-ebox[data-id="2"] .obs-ehandle.se').boundingBox();
  await page.mouse.move(se.x + 5, se.y + 5);
  await page.mouse.down();
  await page.mouse.move(se.x + 5 + 320 * k, se.y + 5 + 10 * k, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    () => Math.abs(window.fakeEditor.items[1].sceneItemTransform.scaleX - 0.75) < 0.01
  );
  near((await transform(2)).scaleY, 0.75, 0.01);
  // Shift: stretch freely.
  await settle();
  const se2 = await page.locator('.obs-ebox[data-id="2"] .obs-ehandle.se').boundingBox();
  await page.mouse.move(se2.x + 5, se2.y + 5);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(se2.x + 5 + 128 * k, se2.y + 5, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForFunction(
    () => Math.abs(window.fakeEditor.items[1].sceneItemTransform.scaleX - 0.85) < 0.01
  );
  near((await transform(2)).scaleY, 0.75, 0.01);

  // Alt+drag the left handle: crop, the picture stays put.
  await settle();
  const before = await transform(2);
  const w = await page.locator('.obs-ebox[data-id="2"] .obs-ehandle.w').boundingBox();
  await page.mouse.move(w.x + 5, w.y + 5);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(w.x + 5 + 85 * k, w.y + 5, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForFunction(
    () => Math.abs(window.fakeEditor.items[1].sceneItemTransform.cropLeft - 100) <= 1
  );
  const cropped = await transform(2);
  near(cropped.cropLeft, 100, 1);
  near(cropped.positionX, before.positionX + 85, 1);
  assert.equal(cropped.scaleX, before.scaleX, 'cropping does not change the scale');

  // Locked background: does not move; the editor says why.
  const bg = await box(1).boundingBox();
  await page.mouse.move(bg.x + bg.width - 30, bg.y + bg.height - 30);
  await page.mouse.down();
  await page.mouse.move(bg.x + bg.width - 130, bg.y + bg.height - 80, { steps: 4 });
  await page.mouse.up();
  assert.match(
    await page.locator('#obsEditorInfo').textContent(),
    /^Background: 0, 0 · 1920 × 1080 · 🔒 locked: unlock it/
  );
  assert.equal((await transform(1)).positionX, 0);
  assert.equal(await page.locator('.obs-ebox[data-id="1"] .obs-ehandle').count(), 0);

  // Rotated logo: moves, but no resize handles.
  const logo = await box(3).boundingBox();
  await page.mouse.click(logo.x + logo.width / 2, logo.y + logo.height / 2);
  await page.waitForSelector('.obs-ebox[data-id="3"].selected');
  assert.equal(await page.locator('.obs-ebox[data-id="3"] .obs-ehandle').count(), 0);
  near(logo.width, 100 * k, 1.5);
  near(logo.height, 200 * k, 1.5);

  // Right-click → Centre; Ctrl+Z puts it back.
  await settle();
  const cam = await box(2).boundingBox();
  const was = await transform(2);
  await page.mouse.click(cam.x + cam.width / 2, cam.y + cam.height / 2, { button: 'right' });
  await page.locator('#obsEditorMenu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#obsEditorMenu button', { hasText: 'Unlock' }).count(), 0);
  await page.locator('#obsEditorMenu button', { hasText: /^Centre$/ }).click();
  await page.waitForFunction(() => {
    const t = window.fakeEditor.items[1].sceneItemTransform;
    const w = (1280 - t.cropLeft) * t.scaleX,
      h = 720 * t.scaleY;
    return Math.abs(t.positionX + w / 2 - 960) < 1 && Math.abs(t.positionY + h / 2 - 540) < 1;
  });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    x => window.fakeEditor.items[1].sceneItemTransform.positionX === x,
    was.positionX
  );
  // Rotate 90° keeps the centre.
  await page.mouse.click(cam.x + cam.width / 2, cam.y + cam.height / 2, { button: 'right' });
  await page.locator('#obsEditorMenu button', { hasText: 'Rotate 90° clockwise' }).click();
  await page.waitForFunction(() => window.fakeEditor.items[1].sceneItemTransform.rotation === 90);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.fakeEditor.items[1].sceneItemTransform.rotation === 0);

  // Arrow keys nudge (Shift: 10).
  const x0 = (await transform(2)).positionX;
  await page.locator('#obsEditorStage').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(x => window.fakeEditor.items[1].sceneItemTransform.positionX === x + 1, x0);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForFunction(x => window.fakeEditor.items[1].sceneItemTransform.positionX === x - 9, x0);

  // Lock from the list: the box can no longer move.
  await page.locator('.obs-editor-row button[aria-label="Lock Webcam"]').click();
  await page.waitForFunction(() => window.fakeEditor.items[1].sceneItemLocked === true);
  await page.waitForSelector('.obs-ebox[data-id="2"].locked');
  // Every change went to OBS for this scene.
  const sent = await page.evaluate(() =>
    window.calls.filter(c => c.obs === 'item-transform').map(c => c.input)
  );
  assert(sent.length >= 8);
  assert(sent.every(c => c.sceneName === 'Main' && [2, 3].includes(c.id)));
  assert(
    sent.every(c => !('sourceWidth' in c.transform)),
    'only changeable fields are sent'
  );
  await page.locator('#obsEditor button', { hasText: 'Close' }).click();
  assert.deepEqual(errors, []);
  console.log('PASS OBS scene editor: boxes, move, snap, resize, crop, locks, rotated, menu, nudge, undo.');
} finally {
  await browser.close();
}
