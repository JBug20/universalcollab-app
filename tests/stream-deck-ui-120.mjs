// Stream Deck control (1.2.0), window side: commands run through the same code as the buttons, errors come back
// to the key, state is published, and Tools → Stream Deck turns control on and copies the token.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.live = true;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => window.remoteCommand && window.streamControls?.state().online);
  const press = (action, args = {}) =>
    page.evaluate(
      async ([action, args]) => {
        const id = 'k' + Math.random();
        await window.remoteCommand({ id, action, args });
        return window.remoteReplies.find(r => r.id === id);
      },
      [action, args]
    );
  const obsCalls = op => page.evaluate(op => calls.filter(c => c.obs === op).map(c => c.input), op);

  // OBS scene and mute go through the same OBS commands as the buttons.
  let r = await press('obs-scene', { name: 'Main' });
  assert.equal(r.ok, true, r.error);
  assert.equal((await obsCalls('scene-switch')).at(-1).sceneName, 'Main');
  r = await press('obs-scene', { name: 'Nope' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no scene called "Nope"/);
  const mic = await page.evaluate(() => window.streamControls.state().inputs[0].name);
  r = await press('mute', { name: mic });
  assert.equal(r.ok, true, r.error);
  assert.equal((await obsCalls('mute')).at(-1).inputName, mic);

  // Record and Clip.
  r = await press('record');
  assert.equal(r.ok, true, r.error);
  assert((await obsCalls('record-start')).length >= 1);
  r = await press('clip');
  assert.equal(r.ok, true, r.error);
  assert((await obsCalls('clip')).length >= 1);

  // Studio Mode toggles; Transition needs Studio Mode.
  await page.evaluate(async () => window.studioMode.enabled && (await window.studioMode.toggle()));
  r = await press('transition');
  assert.equal(r.ok, false);
  assert.match(r.error, /Studio Mode first/);
  r = await press('studio-mode');
  assert.equal(r.ok, true, r.error);
  assert.equal(await page.evaluate(() => window.studioMode.enabled), true);
  await press('studio-mode');

  // Relay scene by name.
  const scene = await page.evaluate(() => window.relayScenes.list()[0]?.name);
  assert(scene, 'a relay scene exists');
  r = await press('relay-scene', { name: scene });
  assert.equal(r.ok, true, r.error);
  r = await press('relay-scene', { name: 'Missing scene' });
  assert.match(r.error, /no relay scene/);

  // State published for the keys.
  await page.waitForFunction(() => window.remoteStateLast?.obs?.online);
  const state = await page.evaluate(() => window.remoteStateLast);
  assert.deepEqual(state.obs.scenes, ['Main']);
  assert.equal(typeof state.studioMode, 'boolean');
  assert(Array.isArray(state.relayScenes));

  // Tools → Stream Deck window.
  await page.evaluate(() => window.openStreamDeckSettings());
  const dialog = page.locator('#streamDeckWindow');
  await dialog.getByRole('button', { name: 'Enable Stream Deck control' }).click();
  await page.waitForFunction(() => calls.some(c => c.remote === 'enable'));
  await dialog.getByRole('button', { name: 'Copy pairing token' }).click();
  await page.waitForFunction(() => calls.some(c => c.remote === 'copy-token'));
  assert.match(await dialog.innerText(), /Pairing token copied/);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Stream Deck UI: scene, mute, record, clip, Studio Mode, transition, relay scene, state, pairing window.'
  );
} finally {
  await browser.close();
}
