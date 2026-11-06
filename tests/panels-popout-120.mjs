// Panels: right-click a header for Pop out / Remove; Panels menu has no checkboxes; Add panel floats the panel
// first; dragging a floating panel's header onto a column docks it.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => window.workspaceUI && document.body.dataset.ready === 'true');
  const where = id =>
    page.evaluate(i => document.querySelector(`[data-dock="${i}"]`)?.parentElement?.id || 'BODY', id);
  const handle = id => page.locator(`[data-dock="${id}"] > .dock-handle`);
  const menu = page.locator('#panelContext');

  // Panels menu: no checkboxes, only Add panel and Reset panels.
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('.app-menu')].find(
      n => n.querySelector('summary').textContent === 'Panels'
    );
    d.open = true;
  });
  await page.waitForFunction(() => document.querySelector('.app-menu[open] .menu-popup button'));
  assert.equal(await page.locator('.app-menu[open] .menu-popup input[type=checkbox]').count(), 0);
  assert.deepEqual(await page.locator('.app-menu[open] .menu-popup button').allTextContents(), [
    '+ Add panel',
    'Reset panels'
  ]);
  await page.evaluate(() => (document.querySelector('.app-menu[open]').open = false));

  // Right-click a header: Pop out.
  assert.equal(await where('chat'), 'dockLeft');
  await handle('chat').click({ button: 'right' });
  assert.deepEqual(await menu.locator('button').allTextContents(), [
    'Pop out',
    'Open in a new window',
    'Remove'
  ]);
  await menu.locator('button', { hasText: 'Pop out' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  assert.equal(await where('chat'), 'BODY');
  const box = await page.locator('[data-dock="chat"]').boundingBox();
  assert(box.width >= 240 && box.height >= 160, JSON.stringify(box));
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('[data-dock="chat"]')).position),
    'fixed'
  );
  // It survives a repaint and is remembered.
  assert(await page.evaluate(() => !!JSON.parse(localStorage.getItem('uc-ui8-workspace')).floating.chat));

  // Floating panels offer Dock back and a choice of section.
  await handle('chat').click({ button: 'right' });
  assert.deepEqual(await menu.locator('button').allTextContents(), [
    'Dock back',
    'Open in a new window',
    'Dock left',
    'Dock center',
    'Dock right',
    'Dock bottom',
    'Remove'
  ]);
  await page.keyboard.press('Escape');

  // Dragging moves it and it stays where it is let go, even over the section it came from or any other.
  const at = () => page.locator('[data-dock="chat"]').boundingBox();
  const grab = async () => {
    const h = await handle('chat').boundingBox();
    await page.mouse.move(h.x + 30, h.y + 8);
    await page.mouse.down();
  };
  const start = await at();
  const grabAt = await handle('chat').boundingBox();
  await grab();
  await page.mouse.move(grabAt.x + 30 + 150, grabAt.y + 8 + 90, { steps: 8 });
  await page.mouse.up();
  const moved = await at();
  assert(
    Math.abs(moved.x - start.x - 150) <= 2 && Math.abs(moved.y - start.y - 90) <= 2,
    JSON.stringify([start, moved])
  );
  assert.equal(await where('chat'), 'BODY', 'a quick drag over a section does not dock it');
  // Passing across the sections without stopping never docks it either.
  const col = await page.locator('#dockCenter').boundingBox();
  await grab();
  await page.mouse.move(col.x + col.width / 2, col.y + 80, { steps: 4 });
  await page.mouse.move(col.x + col.width / 2 + 200, col.y + 200, { steps: 4 });
  await page.mouse.up();
  assert.equal(await where('chat'), 'BODY');
  // Held still over a section it lights up, and letting go docks it there.
  await grab();
  await page.mouse.move(col.x + col.width / 2, col.y + 80, { steps: 6 });
  await page.waitForFunction(() => document.getElementById('dockCenter').classList.contains('dock-ready'));
  await page.mouse.up();
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  assert.equal(await where('chat'), 'dockCenter');
  assert.equal(await page.locator('.studio-column.dock-ready').count(), 0, 'the highlight is gone');
  // A docked panel is moved with the same pointer drag (no browser drag-and-drop): header onto another section.
  assert.equal(await where('scenes'), 'dockBottom');
  assert.equal(await handle('scenes').evaluate(n => n.draggable), false, 'no HTML5 drag-and-drop is needed');
  const sh = await handle('scenes').boundingBox(),
    right = await page.locator('#dockRight').boundingBox();
  await page.mouse.move(sh.x + 30, sh.y + 8);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width / 2, right.y + 120, { steps: 10 });
  assert.equal(await page.locator('.panel-ghost').count(), 1, 'a label follows the pointer');
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-dock="scenes"]').parentElement.id === 'dockRight'
  );
  assert.equal(await page.locator('.panel-ghost').count(), 0);
  // A click on a header without moving does nothing.
  const sh2 = await handle('scenes').boundingBox();
  await page.mouse.click(sh2.x + 30, sh2.y + 8);
  assert.equal(await where('scenes'), 'dockRight');

  // Keyboard: arrow keys move a floating panel.
  await handle('scenes').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Pop out' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-dock="scenes"]').classList.contains('panel-floating')
  );
  const k0 = await page.locator('[data-dock="scenes"]').boundingBox();
  await handle('scenes').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const k1 = await page.locator('[data-dock="scenes"]').boundingBox();
  assert(Math.abs(k1.x - k0.x - 10) <= 1 && Math.abs(k1.y - k0.y - 50) <= 1, JSON.stringify([k0, k1]));
  await handle('scenes').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Dock bottom' }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="scenes"]').classList.contains('panel-floating')
  );

  // Right-click a floating panel: Dock right.
  await handle('chat').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Pop out' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  await handle('chat').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Dock right' }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  assert.equal(await where('chat'), 'dockRight');
  await handle('chat').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Pop out' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  await handle('chat').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Dock back' }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );

  // Remove hides it; Add panel brings it back as a floating panel.
  await handle('chat').click({ button: 'right' });
  await menu.locator('button', { hasText: 'Remove' }).click();
  await page.waitForFunction(() => document.querySelector('[data-dock="chat"]').hidden);
  await page.evaluate(() => {
    [...document.querySelectorAll('.app-menu')].find(
      n => n.querySelector('summary').textContent === 'Panels'
    ).open = true;
  });
  await page.locator('.app-menu[open] .menu-popup button', { hasText: 'Add panel' }).click();
  await page.locator('#addPanelWindow button', { hasText: 'Chat' }).click();
  await page.waitForFunction(() => {
    const p = document.querySelector('[data-dock="chat"]');
    return p.classList.contains('panel-floating') && !p.hidden;
  });
  assert.equal(await where('chat'), 'BODY', 'a newly added panel floats first');

  // Reset puts everything back.
  await page.evaluate(() => document.getElementById('workspaceReset').click());
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  assert.equal(await where('chat'), 'dockLeft');
  assert.deepEqual(errors, []);
  console.log(
    'PASS panels: right-click Pop out / Remove / Dock back, no checkboxes, Add panel floats, drag to dock.'
  );
} finally {
  await browser.close();
}
