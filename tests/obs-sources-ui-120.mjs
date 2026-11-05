// Add OBS source → Create a new source (1.2.0): the kinds this OBS has, type-specific fields, create into the scene
// being edited, then pick the camera from OBS's list; a file for image sources from the file picker.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    const original = window.relayDesktop.obs;
    window.relayDesktop.obs = async (op, input = {}) => {
      if (op === 'source-types')
        return [
          { type: 'webcam', label: 'Webcam or capture card' },
          { type: 'display', label: 'Screen (display capture)' },
          { type: 'image', label: 'Image' },
          { type: 'browser', label: 'Browser source (web page)' }
        ];
      if (op === 'source-create') {
        calls.push({ obs: op, input });
        return input.type === 'webcam'
          ? {
              inputName: input.name,
              property: 'video_device_id',
              current: 'cam1',
              items: [
                { name: 'Logitech C920', value: 'cam1' },
                { name: 'Elgato Cam Link', value: 'cam2' }
              ]
            }
          : { inputName: input.name, property: null, items: [] };
      }
      if (op === 'source-choose' || op === 'source-pick-file') {
        calls.push({ obs: op, input });
        return op === 'source-pick-file' ? { file: 'C:\\Pictures\\Logo.png' } : {};
      }
      return original(op, input);
    };
  });
  await page.waitForFunction(() => window.obsConnected === true);
  await page.evaluate(() => window.connectOBSAutomatically());
  // The OBS sources panel's + button (the panel is hidden in the default layout: Panels → OBS sources).
  await page.evaluate(() =>
    document.querySelector('button[title="Add OBS source (existing or new)"]').click()
  );
  await page.waitForFunction(() => document.getElementById('obsNewSourceType').options.length === 4);
  const win = page.locator('#obsSourceAddWindow');
  await win.waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#obsNewSourceName').inputValue(),
    'Webcam or capture card',
    'a name to start with'
  );
  await page.locator('#obsNewSourceName').fill('Facecam');
  await page.locator('#obsNewSourceCreate').click();
  await page.waitForFunction(() => calls.some(c => c.obs === 'source-create'));
  const created = await page.evaluate(() => calls.find(c => c.obs === 'source-create').input);
  assert.equal(created.type, 'webcam');
  assert.equal(created.name, 'Facecam');
  assert.equal(created.sceneName, 'Main', 'into the OBS scene being edited');
  // Pick the camera from OBS's own list.
  await page.locator('#obsNewSourceChoice').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#obsNewSourceChoice').inputValue(), 'cam1');
  await page.locator('#obsNewSourceChoice').selectOption('cam2');
  await page.waitForFunction(() => calls.some(c => c.obs === 'source-choose'));
  assert.deepEqual(await page.evaluate(() => calls.find(c => c.obs === 'source-choose').input), {
    inputName: 'Facecam',
    property: 'video_device_id',
    value: 'cam2',
    serverKey: 'one'
  });
  // Browser source: its fields.
  await page.locator('#obsNewSourceType').selectOption('browser');
  assert.equal(await page.locator('#obsNewSourceUrl').isVisible(), true);
  assert.equal(await page.locator('#obsNewSourceChoice').isVisible(), false);
  // Image: Choose file… fills the name from the file.
  await page.locator('#obsNewSourceType').selectOption('image');
  await page.locator('#obsNewSourceFile').click();
  await page.waitForFunction(() => document.getElementById('obsNewSourceName').value === 'Logo');
  await page.locator('#obsNewSourceCreate').click();
  await page.waitForFunction(() => calls.filter(c => c.obs === 'source-create').length === 2);
  assert.equal(
    await page.evaluate(() => calls.filter(c => c.obs === 'source-create')[1].input.file),
    'C:\\Pictures\\Logo.png'
  );
  assert.deepEqual(errors, []);
  console.log('PASS add OBS source window: kinds, fields, create into the scene, choose camera, image file.');
} finally {
  await browser.close();
}
