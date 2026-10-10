// App updates (1.2.0), window side: Help → Check for updates, the "Update ready" notice in the menu bar and
// Restart to update.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.openAppUpdates && window.appUpdatePush);
  const notice = page.locator('#appUpdateNotice');
  assert.equal(await notice.isVisible(), false, 'no notice without an update');
  // Help menu entry opens the window.
  await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Help'
    );
    menu.open = true;
  });
  await page.locator('.app-menu[open] .menu-popup').getByText('Check for updates').click();
  const win = page.locator('#appUpdateWindow');
  await win.waitFor({ state: 'visible' });
  assert.match(await win.textContent(), /This version: 1\.2\.0-preview\.2/);
  await win.getByRole('button', { name: 'Check now' }).click();
  assert.ok(await page.evaluate(() => calls.some(c => c.appUpdate === 'check')));
  await win.locator('#appUpdateAuto').uncheck();
  assert.equal(await page.evaluate(() => calls.findLast(c => c.appUpdate === 'set-auto').input.auto), false);
  assert.equal(await win.getByRole('button', { name: 'Restart to update' }).isVisible(), false);

  // An update is downloaded: notice in the menu bar, release notes and Restart to update.
  await page.evaluate(() => {
    window.appUpdateState = {
      ...window.appUpdateState,
      state: 'ready',
      latest: { version: '1.2.0-preview.3', notes: 'Faster <b>clips</b>', page: 'https://github.com/x' }
    };
    window.appUpdatePush(window.appUpdateState);
  });
  assert.equal(await notice.isVisible(), true);
  assert.match(await win.textContent(), /Version 1\.2\.0-preview\.3 is downloaded/);
  assert.equal(
    await win.locator('.app-update-notes').textContent(),
    'Faster <b>clips</b>',
    'notes shown as text'
  );
  page.once('dialog', d => d.accept());
  await win.getByRole('button', { name: 'Restart to update' }).click();
  await page.waitForFunction(() => calls.some(c => c.appUpdate === 'restart'));
  await win.getByRole('button', { name: 'Close' }).click();
  // The notice sits in the menu bar beside the settings gear and opens the window.
  const [n, gear] = await Promise.all([notice.boundingBox(), page.locator('#settingsGear').boundingBox()]);
  assert.ok(
    n.x + n.width <= gear.x + 1 && Math.abs(n.y + n.height / 2 - (gear.y + gear.height / 2)) < 8,
    JSON.stringify([n, gear])
  );
  await notice.click();
  await win.waitFor({ state: 'visible' });
  // Needs the full installer: the release page button.
  await page.evaluate(() => {
    window.appUpdateState = {
      ...window.appUpdateState,
      state: 'installer',
      message: 'This version needs the full installer.'
    };
    window.appUpdatePush(window.appUpdateState);
  });
  assert.equal(await notice.isVisible(), false);
  await win.getByRole('button', { name: 'Open release page' }).click();
  await page.waitForFunction(() => calls.some(c => c.appUpdate === 'open-page'));
  assert.deepEqual(errors, []);
  console.log(
    'PASS app updates window: check, automatic setting, update ready notice, restart, release page.'
  );
} finally {
  await browser.close();
}
