// A panel in its own window (for a second monitor): "Open in a new window" moves the panel into a separate
// window that keeps working and keeps being found by the rest of the app; closing that window, or its
// "Return to main window" button, puts the panel back where it was.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio({ viewport: { width: 1500, height: 1000 } });
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => window.workspaceUI && document.body.dataset.ready === 'true');
  await page.waitForTimeout(1000);
  const where = id =>
    page.evaluate(i => document.querySelector(`[data-dock="${i}"]`)?.parentElement?.id || 'BODY', id);
  const order = col =>
    page.evaluate(
      c =>
        [...document.getElementById(c).children]
          .filter(n => n.dataset?.dock && !n.hidden)
          .map(n => n.dataset.dock),
      col
    );
  assert.deepEqual(await order('dockBottom'), ['obsScenes', 'scenes', 'sources', 'obsMixer']);

  // Right-click offers it (not for the layout editor).
  await page.locator('[data-dock="scenes"] > .dock-handle').click({ button: 'right' });
  assert((await page.locator('#panelContext button').allTextContents()).includes('Open in a new window'));
  await page.keyboard.press('Escape');
  await page.locator('[data-dock="layout"] > .dock-handle').click({ button: 'right' });
  assert(!(await page.locator('#panelContext button').allTextContents()).includes('Open in a new window'));
  await page.keyboard.press('Escape');

  // Open the Relay scenes panel in its own window.
  const popup = page.waitForEvent('popup');
  await page.locator('[data-dock="scenes"] > .dock-handle').click({ button: 'right' });
  await page.locator('#panelContext button', { hasText: 'Open in a new window' }).click();
  const win = await popup;
  await win.waitForSelector('[data-dock="scenes"]');
  assert.equal(await win.title(), 'Relay scenes · UniversalCollab');
  assert.deepEqual(
    await order('dockBottom'),
    ['obsScenes', 'sources', 'obsMixer'],
    'it left the main window'
  );
  assert.equal(await page.evaluate(() => window.workspaceUI.detached('scenes')), true);
  // It fills the window and has the app's look.
  const size = await win.evaluate(() => {
    const p = document.querySelector('[data-dock="scenes"]').getBoundingClientRect();
    return {
      w: p.width,
      h: p.height,
      iw: innerWidth,
      ih: innerHeight,
      bg: getComputedStyle(document.body).backgroundColor
    };
  });
  assert(size.w >= size.iw - 4 && size.h > size.ih * 0.7, JSON.stringify(size));
  assert.equal(size.bg, 'rgb(16, 16, 23)');
  // The rest of the app still finds its parts, and its buttons keep working from the new window.
  assert.equal(await page.evaluate(() => !!document.getElementById('sceneList')), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sceneList button').length > 0), true);
  await win.evaluate(() => {
    document.getElementById('sceneName').value = 'Second';
    document.getElementById('sceneNew').click();
  });
  await win.waitForFunction(() => document.querySelectorAll('#sceneList button').length === 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sceneList button').length), 2);
  // Repainting the workspace does not pull it back.
  await page.evaluate(() => window.workspaceUI.workspacePaint());
  assert.equal(await page.evaluate(() => window.workspaceUI.detached('scenes')), true);
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-dock="scenes"]').ownerDocument === document),
    false
  );

  // Closing the window puts the panel back in its place (between OBS scenes and Sources).
  await win.close();
  await page.waitForFunction(() => !window.workspaceUI.detached('scenes'));
  assert.deepEqual(await order('dockBottom'), ['obsScenes', 'scenes', 'sources', 'obsMixer']);
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('#sceneList button').length),
    2,
    'its content is intact'
  );

  // The Return button does the same, and a floating panel returns floating.
  await page.evaluate(() => window.workspaceUI.popOut('obsMixer'));
  await page.waitForFunction(() =>
    document.querySelector('[data-dock="obsMixer"]').classList.contains('panel-floating')
  );
  const popup2 = page.waitForEvent('popup');
  await page.evaluate(() => window.workspaceUI.detach('obsMixer'));
  const win2 = await popup2;
  await win2.waitForSelector('[data-dock="obsMixer"]');
  await win2.locator('.detached-bar button').click();
  await page.waitForFunction(() => !window.workspaceUI.detached('obsMixer'));
  assert.equal(await where('obsMixer'), 'BODY');
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('[data-dock="obsMixer"]').classList.contains('panel-floating')
    ),
    true
  );
  // The chosen theme follows the panel into its window.
  await page.evaluate(() => window.appTheme.set('blue'));
  const popup3 = page.waitForEvent('popup');
  await page.evaluate(() => window.workspaceUI.detach('obsScenes'));
  const win3 = await popup3;
  await win3.waitForSelector('[data-dock="obsScenes"]');
  assert.deepEqual(
    await win3.evaluate(() => [document.documentElement.dataset.theme, document.adoptedStyleSheets.length]),
    ['blue', 3]
  );
  await win3.close();
  await page.waitForFunction(() => !window.workspaceUI.detached('obsScenes'));
  assert.deepEqual(errors, []);
  console.log(
    'PASS panels in their own window: opens, works from there, is found, returns on close or Return.'
  );
} finally {
  await browser.close();
}
