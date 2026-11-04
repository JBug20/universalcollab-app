// Panels: right-click a header for Pop out / Remove; Panels menu has no checkboxes; Add panel floats the panel
// first; dragging a floating panel's header onto a column docks it.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => window.workspaceUI && document.body.dataset.ready === 'true');
  const where = id => page.evaluate(i => document.querySelector(`[data-dock="${i}"]`)?.parentElement?.id || 'BODY', id);
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
  assert.deepEqual(await menu.locator('button').allTextContents(), ['Pop out', 'Remove']);
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

  // Floating panels offer Dock back; dragging the header onto a column docks it.
  await handle('chat').click({ button: 'right' });
  assert.deepEqual(await menu.locator('button').allTextContents(), ['Dock back', 'Remove']);
  await page.keyboard.press('Escape');
  const h = await handle('chat').boundingBox();
  const col = await page.locator('#dockCenter').boundingBox();
  await page.mouse.move(h.x + 30, h.y + 8);
  await page.mouse.down();
  await page.mouse.move(col.x + col.width / 2, col.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    () => !document.querySelector('[data-dock="chat"]').classList.contains('panel-floating')
  );
  assert.equal(await where('chat'), 'dockCenter');

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
