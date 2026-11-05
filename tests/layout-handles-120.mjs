// Relay layout editor, OBS-style (1.2.0): the selected item shows 8 handles; corners keep the shape, Shift stretches,
// edges stretch one side and snap; nothing leaves the frame; right-click Fit / Stretch / Centre; Ctrl+Z and the
// Undo menu item step back through moves, resizes, nudges and menu changes; locked items have no handles.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const g = (await import('node:module')).createRequire(import.meta.url)('../DesktopSource/layout-geometry.js');
const { browser, page, errors } = await openStudio({ viewport: { width: 1600, height: 1000 } });
const near = (a, b, d = 0.006) => assert(Math.abs(a - b) <= d, `${a} is not about ${b}`);
try {
  // Geometry first.
  const it = { x: 0.5, y: 0.5, width: 0.4, height: 0.4 };
  assert.deepEqual(g.box(it), { left: 0.3, top: 0.3, right: 0.7, bottom: 0.7 });
  const se = g.resize(it, 'se', 0.1, 0);
  near(se.width, 0.5);
  near(se.height, 0.5);
  near(g.box(se).left, 0.3);
  const nw = g.box(g.resize(it, 'nw', -0.1, 0));
  near(nw.left, 0.2);
  near(nw.top, 0.2);
  near(nw.right, 0.7);
  const e = g.resize(it, 'e', 0.1, 0.3, { free: true });
  near(e.width, 0.5);
  near(e.height, 0.4);
  const big = g.box(g.resize(it, 'se', 0.9, 0.9));
  assert(big.right <= 1.000001 && big.bottom <= 1.000001, 'stays in the frame');
  near(big.right - big.left, big.bottom - big.top);
  const tiny = g.resize(it, 'w', 0.9, 0, { free: true });
  near(tiny.width, 0.04);
  const fit = g.ACTIONS.fit({ x: 0, y: 0, width: 0.1, height: 0.4 }, 16 / 9);
  assert.deepEqual([fit.x, fit.y, fit.height], [0.5, 0.5, 1]);
  near(fit.width, 0.25);
  assert.deepEqual(g.ACTIONS.stretch(), { x: 0, y: 0, width: 1, height: 1 });
  const snapped = g.snapEdges(
    { left: 0.3, top: 0.3, right: 0.495, bottom: 0.7 },
    'e',
    { x: [0.5], y: [] },
    0.012
  );
  assert.equal(snapped.box.right, 0.5);
  assert.deepEqual(snapped.used.v, [0.5]);

  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && window.streamCanvas);
  await page.evaluate(() =>
    window.streamCanvas.restore({
      items: [
        { id: 'main', kind: 'main', x: 0, y: 0, width: 1, height: 1 },
        { id: 'video:bob', kind: 'video', publisher: 'bob', x: 0.5, y: 0.5, width: 0.4, height: 0.4, z: 1 },
        { id: 'video:cat', kind: 'video', publisher: 'cat', x: 0, y: 0, width: 0.2, height: 0.2, z: 2 }
      ]
    })
  );
  const item = id => page.evaluate(id => window.streamCanvas.snapshot().items.find(i => i.id === id), id);
  const tile = id => page.locator(`#layoutPreview .canvas-item[data-item="${id}"]`);
  const frame = await page.locator('#layoutPreview').boundingBox();
  // Select bob: its 8 handles show; other items' do not.
  const b = await tile('video:bob').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForSelector('#layoutPreview .canvas-item.selected[data-item="video:bob"]');
  assert.equal(await tile('video:bob').locator('.canvas-handle:visible').count(), 8);
  assert.equal(await tile('video:cat').locator('.canvas-handle:visible').count(), 0);

  const drag = async (sel, dx, dy, mods = []) => {
    const h = await page.locator(sel).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx * frame.width, h.y + h.height / 2 + dy * frame.height, {
      steps: 6
    });
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
  };
  const handle = (id, h) => `#layoutPreview .canvas-item[data-item="${id}"] .canvas-handle.${h}`;
  // Corner: keeps the shape.
  await drag(handle('video:bob', 'se'), 0.1, 0.02);
  let bob = await item('video:bob');
  near(bob.width, 0.5, 0.01);
  near(bob.height, 0.5, 0.01);
  near(g.box(bob).left, 0.3, 0.005);
  // Shift: stretch freely.
  await drag(handle('video:bob', 'se'), -0.1, 0, ['Shift']);
  bob = await item('video:bob');
  near(bob.width, 0.4, 0.01);
  near(bob.height, 0.5, 0.01);
  // Left edge: one side, snapping to the frame's quarter line.
  await drag(handle('video:bob', 'w'), -0.046, 0);
  bob = await item('video:bob');
  near(g.box(bob).left, 0.25, 0.0005);
  near(g.box(bob).right, 0.7, 0.005);

  // Undo (Ctrl+Z) steps back: the edge, then Shift, then the corner.
  await tile('video:bob').focus();
  await page.keyboard.press('Control+z');
  near(g.box(await item('video:bob')).left, 0.3, 0.005);
  await page.keyboard.press('Control+z');
  near((await item('video:bob')).width, 0.5, 0.01);
  await page.keyboard.press('Control+z');
  near((await item('video:bob')).width, 0.4, 0.001);
  // Arrow presses in a row undo as one step.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  near((await item('video:bob')).x, 0.5, 0.0001);

  // Right-click: Fit keeps the shape; Stretch fills; Undo from the menu.
  const menu = async (id, label) => {
    await tile(id).dispatchEvent('contextmenu', { clientX: 300, clientY: 200 });
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  await menu('video:bob', 'Fit to screen (keep shape)');
  bob = await item('video:bob');
  assert.deepEqual([bob.width, bob.height], [1, 1]);
  await menu('video:bob', 'Undo');
  near((await item('video:bob')).width, 0.4, 0.001);
  await menu('video:cat', 'Centre horizontally');
  assert.deepEqual([(await item('video:cat')).x, (await item('video:cat')).y], [0.5, 0]);
  await menu('video:cat', 'Stretch to screen');
  assert.equal((await item('video:cat')).width, 1);
  await menu('video:cat', 'Undo');
  assert.equal((await item('video:cat')).width, 0.2);

  // Locked: no handles, cannot be resized.
  await page.evaluate(() => window.streamCanvas.toggleLock());
  assert.equal(await tile('video:cat').locator('.canvas-handle:visible').count(), 0);
  assert.match(await page.locator('#canvasHint').textContent(), /./);
  assert.deepEqual(errors, []);
  console.log(
    'PASS relay layout handles: 8 handles, keep shape / Shift, snapping, frame limits, menu, undo.'
  );
} finally {
  await browser.close();
}
