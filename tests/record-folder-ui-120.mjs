// Recordings folder (1.2.0), window side: Settings → OBS shows where recordings and clips are saved, with Choose
// folder…, a typed folder, Open folder and the free space; Tools → Recordings folder opens it.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.fakeRecordDir = 'C:\\Users\\me\\Videos';
    window.fakeDisk = {
      folder: 'C:\\Users\\me\\Videos',
      drive: 'C:\\',
      freeBytes: 120 * 2 ** 30,
      totalBytes: 500 * 2 ** 30
    };
    const bridge = window.relayDesktop,
      real = bridge.obs;
    bridge.obs = async (op, input = {}) => {
      if (op === 'record-dir-browse') {
        calls.push({ obs: op });
        if (window.browseCancel) return { canceled: true };
        window.fakeRecordDir = 'E:\\Stream recordings';
        return { directory: 'E:\\Stream recordings' };
      }
      if (op === 'record-directory') {
        calls.push({ obs: op, input });
        if (!/^[A-Z]:\\/.test(input.directory))
          throw Error('Use a full folder path, for example D:\\Recordings.');
        return { directory: input.directory };
      }
      if (op === 'record-dir-open') {
        calls.push({ obs: op });
        return { directory: window.fakeRecordDir };
      }
      return real(op, input);
    };
  });
  // OBS connected by itself at start (not through the OBS window), as in the installed app.
  await page.waitForFunction(() => window.obsConnected === true);
  // Settings → OBS shows the OBS settings without pressing Refresh.
  await page.waitForFunction(() => !document.getElementById('obsVideoFields').hidden);
  assert.match(await page.locator('#obsSettingsState').textContent(), /Connected to OBS/);
  // Tools → Recordings folder.
  await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Tools'
    );
    menu.open = true;
  });
  await page.locator('.app-menu[open] .menu-popup').getByText('Recordings folder').click();
  const input = page.locator('#obsRecordDirectory');
  await page.waitForFunction(
    () => document.getElementById('obsRecordDirectory').value === 'C:\\Users\\me\\Videos'
  );
  await input.waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    /120\.0 GB free on C:\\/.test(document.getElementById('obsRecordFolderInfo').textContent)
  );
  assert.equal(await page.locator('#obsRecordDirectoryBrowse').isEnabled(), true);
  // Choose folder…
  await page.locator('#obsRecordDirectoryBrowse').click();
  await page.waitForFunction(
    () => document.getElementById('obsRecordDirectory').value === 'E:\\Stream recordings'
  );
  assert.match(await page.locator('#notice').textContent(), /Recordings folder: E:\\Stream recordings/);
  // Cancelled: nothing changes.
  await page.evaluate(() => (window.browseCancel = true));
  await page.locator('#obsRecordDirectoryBrowse').click();
  await page.waitForTimeout(300);
  assert.equal(await input.inputValue(), 'E:\\Stream recordings');
  // A typed folder is checked; a bad one is refused with the reason.
  await input.fill('Recordings');
  await page.locator('#obsRecordDirectorySave').click();
  await page.waitForFunction(() => /full folder path/.test(document.body.innerText));
  await input.fill('D:\\Recordings');
  await page.locator('#obsRecordDirectorySave').click();
  await page.waitForFunction(() =>
    /Recordings folder: D:\\Recordings/.test(document.getElementById('notice').textContent)
  );
  // Open folder.
  await page.locator('#obsRecordDirectoryOpen').click();
  await page.waitForFunction(() => calls.some(c => c.obs === 'record-dir-open'));
  assert.deepEqual(errors, []);
  console.log('PASS recordings folder window: Tools menu, choose, cancel, typed check, open, free space.');
} finally {
  await browser.close();
}
