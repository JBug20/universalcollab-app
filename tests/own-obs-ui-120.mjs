// Own OBS start-up setting (1.2.0) on the real page: asked to start at launch, shown in Connect OBS, saved on change.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => calls.some(c => c.obs === 'own-obs-autostart'));
  await page.evaluate(() => {
    const original = window.relayDesktop.obs;
    let enabled = false,
      closeOnQuit = false;
    window.relayDesktop.obs = async (op, input = {}) => {
      if (op === 'own-obs-info' || op === 'own-obs-set') {
        calls.push({ obs: op, input });
        if (op === 'own-obs-set' && 'enabled' in input) enabled = input.enabled;
        if (op === 'own-obs-set' && 'closeOnQuit' in input) closeOnQuit = input.closeOnQuit;
        return {
          enabled,
          closeOnQuit,
          found: true,
          chosen: false,
          path: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'
        };
      }
      return original(op, input);
    };
    document.getElementById('obsPairWindow').showModal();
    document.getElementById('automaticOBS').hidden = false;
  });
  const box = page.locator('#ownOBSBox');
  await box.waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    /found automatically/.test(document.getElementById('ownOBSPath').textContent)
  );
  await page.locator('#ownOBSAutostart').check();
  await page.waitForFunction(() => calls.some(c => c.obs === 'own-obs-set' && c.input.enabled === true));
  assert.match(await box.innerText(), /Start my OBS with UniversalCollab, minimized to the tray/);
  await page.locator('#ownOBSCloseOnQuit').check();
  await page.waitForFunction(() => calls.some(c => c.obs === 'own-obs-set' && c.input.closeOnQuit === true));
  assert.match(await box.innerText(), /Close my OBS when UniversalCollab closes/);
  assert.deepEqual(errors, []);
  console.log('PASS own OBS UI: start-up launch requested, setting shown in Connect OBS and saved.');
} finally {
  await browser.close();
}
