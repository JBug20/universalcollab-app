// Recording scene (1.2.0), Settings → OBS: choose what Start Recording records and which scene; the choice is sent
// with every OBS call, says whether Source Record is installed (with Get Source Record when it is not), is locked
// while recording, and Start Recording reports the scene it records.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
const obsCalls = op => page.evaluate(op => window.calls.filter(c => c.obs === op), op);
try {
  await page.evaluate(() => {
    window.fakeScenes = ['Main', 'Recording'];
    window.fakeRecordDir = 'D:\\Rec';
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && window.obsConnected && window.streamControls);
  await page.waitForFunction(() => !document.getElementById('obsVideoFields').hidden);
  await page.evaluate(() => window.workspaceUI.openSettings('obs'));
  await page.locator('#obsRecordWhat').waitFor({ state: 'visible' });
  const info = () => page.locator('#obsRecordSceneInfo').textContent();
  const sc = (fn, ...a) => page.evaluate(([fn, a]) => window.streamControls[fn](...a), [fn, a]);

  // Default: the normal recording.
  assert.equal(await page.locator('#obsRecordWhat').inputValue(), 'program');
  await page.waitForFunction(() => /Source Record is installed/.test(obsRecordSceneInfo.textContent));
  assert.match(await info(), /records what is on stream, as usual/);
  assert.equal(await page.locator('#obsSourceRecordGet').isHidden(), true);
  await page.waitForFunction(() => document.querySelectorAll('#obsRecordSceneName option').length === 3);
  const options = await page.locator('#obsRecordSceneName option').allTextContents();
  assert.deepEqual(options, ['Choose a scene…', 'Main', 'Recording']);

  // Recording scene only: asks for a scene, then explains.
  await page.locator('#obsRecordWhat').selectOption('scene');
  await page.waitForFunction(() => /Choose the scene to record/.test(obsRecordSceneInfo.textContent));
  assert.equal(await page.locator('#obsRecordSceneInfo').evaluate(n => n.classList.contains('bad')), true);
  await page.locator('#obsRecordSceneName').selectOption('Recording');
  await page.waitForFunction(() => /records "Recording" on its own/.test(obsRecordSceneInfo.textContent));
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('uc-record-scene'))), {
    scene: 'Recording',
    what: 'scene'
  });

  // Start Recording sends the choice and says what it records; the settings are locked meanwhile.
  assert.equal(await sc('record'), 'Recording "Recording" started.');
  const start = (await obsCalls('record-start')).at(-1);
  assert.equal(start.input.recordScene, 'Recording');
  assert.equal(start.input.recordWhat, 'scene');
  assert.equal((await obsCalls('snapshot')).at(-1).input.recordScene, 'Recording');
  await page.waitForFunction(() => document.getElementById('obsRecordSceneName').disabled);
  assert.equal(await page.locator('#obsRecordWhat').isDisabled(), true);
  assert.equal(await sc('record'), 'Recording stopped.');
  await page.waitForFunction(() => !document.getElementById('obsRecordSceneName').disabled);

  // Both.
  await page.locator('#obsRecordWhat').selectOption('both');
  await page.waitForFunction(() =>
    /and what is on stream, as two files/.test(obsRecordSceneInfo.textContent)
  );
  assert.equal(await sc('record'), 'Recording started (also recording "Recording").');
  await sc('record');

  // Source Record missing: says how to install it and offers Get Source Record.
  await page.evaluate(() => (window.fakeSourceRecord = { installed: false }));
  await page.locator('#obsRecordSceneCheck').click();
  await page.waitForFunction(() => /not installed in OBS/.test(obsRecordSceneInfo.textContent));
  assert.equal(await page.locator('#obsSourceRecordGet').isVisible(), true);
  await page.locator('#obsSourceRecordGet').click();
  await page.waitForFunction(() => window.calls.some(c => c.obs === 'source-record-page'));

  // Readiness gets the choice too.
  await page.evaluate(() =>
    window.relayDesktop.obs('readiness', { recordScene: 'Recording', recordWhat: 'both' })
  );
  assert.deepEqual(errors, []);
  console.log('PASS recording scene settings: choice saved and sent, plugin status, locked while recording.');
} finally {
  await browser.close();
}
