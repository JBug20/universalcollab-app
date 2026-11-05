// Corner placement and 2×2 split (#6, 1.2.0): right-click a layout item → a quarter of the frame, Centre, Reset;
// Make 2×2 split arranges up to four visible, unlocked items; locked items are not moved; nothing else moves.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && window.streamCanvas);
  await page.evaluate(() =>
    window.streamCanvas.restore({
      items: [
        { id: 'main', kind: 'main', x: 0, y: 0, width: 1, height: 1 },
        { id: 'video:bob', kind: 'video', publisher: 'bob', x: 0.5, y: 0.5, width: 0.25, height: 0.25, z: 1 },
        { id: 'video:cat', kind: 'video', publisher: 'cat', x: 0.2, y: 0.8, width: 0.3, height: 0.3, z: 2 },
        { id: 'video:dan', kind: 'video', publisher: 'dan', x: 0.7, y: 0.1, width: 0.2, height: 0.2, z: 3 }
      ]
    })
  );
  const item = id => page.evaluate(id => window.streamCanvas.snapshot().items.find(i => i.id === id), id);
  const menu = async (id, label) => {
    await page
      .locator(`#layoutPreview .canvas-item[data-item="${id}"]`)
      .dispatchEvent('contextmenu', { clientX: 300, clientY: 200 });
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  // A quarter of the frame.
  await menu('video:bob', 'Top left quarter');
  assert.deepEqual((({ x, y, width, height }) => ({ x, y, width, height }))(await item('video:bob')), {
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5
  });
  await menu('video:bob', 'Bottom right quarter');
  assert.deepEqual((({ x, y }) => ({ x, y }))(await item('video:bob')), { x: 1, y: 1 });
  // Other items did not move.
  assert.deepEqual((({ x, y, width }) => ({ x, y, width }))(await item('video:cat')), {
    x: 0.2,
    y: 0.8,
    width: 0.3
  });
  // Centre keeps the size; Reset puts it back to a new item's size, centred.
  await menu('video:bob', 'Centre');
  assert.deepEqual((({ x, y, width }) => ({ x, y, width }))(await item('video:bob')), {
    x: 0.5,
    y: 0.5,
    width: 0.5
  });
  await menu('video:bob', 'Reset position & size');
  assert.deepEqual((({ x, y, width, height }) => ({ x, y, width, height }))(await item('video:bob')), {
    x: 0.5,
    y: 0.5,
    width: 0.25,
    height: 0.25
  });
  // The main feed resets to fill the frame.
  await menu('main', 'Top right quarter');
  await menu('main', 'Reset position & size');
  assert.deepEqual((({ x, y, width, height }) => ({ x, y, width, height }))(await item('main')), {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  });
  // A locked item is not moved, by a corner or the split.
  await menu('video:dan', 'Lock / unlock');
  await page
    .locator('#layoutPreview .canvas-item[data-item="video:dan"]')
    .dispatchEvent('contextmenu', { clientX: 300, clientY: 200 });
  assert.equal(
    await page.getByRole('menuitem', { name: 'Top left quarter', exact: true }).isDisabled(),
    true
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const m = document.querySelector('[role=menuitem]')?.parentElement;
    if (m) m.hidden = true;
  });
  // 2×2 split: main, bob and cat fill quarters; dan (locked) stays.
  await menu('video:bob', 'Make 2×2 split');
  const quads = await page.evaluate(() =>
    window.streamCanvas
      .snapshot()
      .items.filter(i => i.width === 0.5 && i.height === 0.5)
      .map(i => i.id + '@' + i.x + ',' + i.y)
      .sort()
  );
  // The main feed takes the top-left quarter; the others fill different quarters.
  assert.equal(quads[0], 'main@0,0');
  assert.deepEqual(quads.map(q => q.split('@')[0]).sort(), ['main', 'video:bob', 'video:cat']);
  assert.equal(new Set(quads.map(q => q.split('@')[1])).size, 3, 'three different quarters');
  assert.deepEqual((({ x, y, width }) => ({ x, y, width }))(await item('video:dan')), {
    x: 0.7,
    y: 0.1,
    width: 0.2
  });
  assert.match(await page.locator('#notice').textContent(), /Split 3 items into quadrants/);
  assert.deepEqual(errors, []);
  console.log(
    'PASS corners and 2×2 split: quarters, centre, reset, locked items untouched, nothing else moves.'
  );
} finally {
  await browser.close();
}
