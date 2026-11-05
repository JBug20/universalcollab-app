// Dragging a docked panel: it lands before or after the panel under the pointer depending on which half the
// pointer is in, so it can go first, in the middle or last, in the side sections (top to bottom) and in the bottom
// row (left to right). A bar shows where it will land.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio({ viewport: { width: 1500, height: 1000 } });
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => window.workspaceUI && document.body.dataset.ready === 'true');
  await page.waitForTimeout(1000);
  const order = col =>
    page.evaluate(
      c =>
        [...document.getElementById(c).children]
          .filter(n => n.dataset?.dock && !n.hidden)
          .map(n => n.dataset.dock),
      col
    );
  const box = id => page.locator(`[data-dock="${id}"]`).boundingBox();
  // Drag `id` by its header to (x, y); returns whether the landing bar was visible just before letting go.
  async function drag(id, x, y) {
    const h = await page.locator(`[data-dock="${id}"] > .dock-handle`).boundingBox();
    await page.mouse.move(h.x + 20, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    const bar = await page
      .locator('.drop-line')
      .evaluate(n => !n.hidden && n.getBoundingClientRect().width > 0);
    await page.mouse.up();
    await page.waitForTimeout(250);
    return bar;
  }

  // The bottom row, left to right.
  assert.deepEqual(await order('dockBottom'), ['obsScenes', 'scenes', 'sources', 'obsMixer']);
  let r = await box('obsMixer');
  assert.equal(
    await drag('obsScenes', r.x + r.width * 0.8, r.y + 80),
    true,
    'a bar shows where it will land'
  );
  assert.deepEqual(await order('dockBottom'), ['scenes', 'sources', 'obsMixer', 'obsScenes'], 'last');
  r = await box('scenes');
  await drag('obsScenes', r.x + r.width * 0.2, r.y + 80);
  assert.deepEqual(await order('dockBottom'), ['obsScenes', 'scenes', 'sources', 'obsMixer'], 'first');
  r = await box('sources');
  await drag('obsMixer', r.x + r.width * 0.2, r.y + 80);
  assert.deepEqual(
    await order('dockBottom'),
    ['obsScenes', 'scenes', 'obsMixer', 'sources'],
    'in the middle'
  );
  r = await box('sources');
  await drag('obsMixer', r.x + r.width * 0.8, r.y + 80);
  assert.deepEqual(
    await order('dockBottom'),
    ['obsScenes', 'scenes', 'sources', 'obsMixer'],
    'after the one before'
  );

  // A side section, top to bottom.
  assert.deepEqual(await order('dockRight'), ['stream']);
  r = await box('stream');
  await drag('scenes', r.x + r.width / 2, r.y + r.height * 0.85);
  assert.deepEqual(await order('dockRight'), ['stream', 'scenes'], 'last: lower half of the last panel');
  r = await box('stream');
  await drag('scenes', r.x + r.width / 2, r.y + r.height * 0.15);
  assert.deepEqual(await order('dockRight'), ['scenes', 'stream'], 'first: upper half of the first panel');
  // Dropping on empty room below the last panel also goes last; an empty section takes the panel.
  r = await box('stream');
  const column = await page.locator('#dockRight').boundingBox();
  await drag('scenes', column.x + column.width / 2, column.y + column.height - 6);
  assert.deepEqual(await order('dockRight'), ['stream', 'scenes']);
  r = await box('chat');
  await drag('scenes', r.x + r.width / 2, r.y + r.height * 0.9);
  assert.deepEqual(await order('dockLeft'), ['chat', 'scenes']);

  // The bar is gone afterwards, and the order is remembered.
  assert.equal(await page.locator('.drop-line').evaluate(n => n.hidden), true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('uc-ui8-workspace')).order);
  assert.deepEqual(saved.dockLeft, ['chat', 'scenes']);
  assert.deepEqual(errors, []);
  console.log(
    'PASS panel order: first, middle and last in side sections and the bottom row, with a landing bar.'
  );
} finally {
  await browser.close();
}
