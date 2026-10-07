// The layout editor against the real rc.8 relay code (universalcollab-relay checked out next to this repo).
// A user with text, picture and browser sources must still be able to save their layout, End Relay timer and
// fallback to a relay that predates those sources: the sources stay on this computer and are never sent,
// because rc.8 rejects the whole settings save if it receives an item it does not know.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PortalStore } from '../../universalcollab-relay/src/portal-store.mjs';
import { hostFeatures } from '../../universalcollab-relay/src/host-features.mjs';
import { createPortalServer } from '../../universalcollab-relay/src/portal-server.mjs';
import { openStudio } from './helpers/studio-page.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-compat-')),
  store = new PortalStore({ directory: dir + '/server', features: () => hostFeatures({}) }),
  alice = store.register('Alice', store.joinPassword);
store.register('Bob', store.joinPassword);
const server = await createPortalServer({
  config: { port: 0, bind: '127.0.0.1', publicOrigin: '' },
  store,
  status: id => ({ id, state: 'ready' }),
  action: async () => {},
  changed: () => {},
  busy: () => false,
  validateDestination: async () => {},
  rtmpPort: 1935
});
const origin = 'http://127.0.0.1:' + server.server.address().port,
  token = alice.id + ':' + alice.controlToken,
  rejected = [];
// Forwards what the page asks of "the relay" to the real rc.8 relay, as the app's main process would.
const relayProxy = async q => {
  const response = await fetch(origin + q.route, {
    method: q.body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      Authorization: 'Bearer ' + token,
      ...(q.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: q.body === undefined ? undefined : JSON.stringify(q.body)
  });
  const data = await response.json();
  if (!response.ok) {
    rejected.push(q.route + ': ' + (data.error || response.status));
    throw new Error(data.error || 'The relay rejected the request.');
  }
  return data;
};

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const { browser, page, errors } = await openStudio({
  expose: { relayProxy },
  initScript: () => (window.relayHook = q => window.relayProxy(q))
});
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() =>
    document.getElementById('serverStatus')?.textContent.startsWith('Connected')
  );
  const caps = await page.evaluate(() => view.capabilities);
  assert.equal(caps.mediaSourcesApi, undefined, 'the rc.8 relay has no media sources API');
  const noteText = () => page.locator('#notice').innerText();

  // A plain save (no media sources) works.
  assert(
    await page.evaluate(() => window.streamCanvas.save()),
    'a plain save is accepted by rc.8: ' + rejected
  );

  // Add one source of each kind through the editor's own source settings window.
  const add = async kind => {
    await page.evaluate(k => {
      document.getElementById('canvasSource').value = k + ':new';
      document.getElementById('canvasAdd').click();
    }, kind);
    await page.waitForSelector('#sourcePropertiesWindow[open]');
  };
  await add('text');
  await page.locator('#sourcePropertiesWindow textarea').fill('Hello chat');
  await page.locator('#sourcePropertiesWindow input[type=submit]').click();
  await add('image');
  await page
    .locator('#sourcePropertiesWindow input[type=file]')
    .setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() =>
    /Picture ready/.test(document.querySelector('#sourcePropertiesWindow').innerText)
  );
  await page.locator('#sourcePropertiesWindow input[type=submit]').click();
  await add('browser');
  await page.locator('#sourcePropertiesWindow input[type=url]').fill('https://example.com/');
  await page.locator('#sourcePropertiesWindow input[type=submit]').click();
  for (const kind of ['text', 'image', 'browser'])
    assert.equal(
      await page.locator('#layoutPreview .canvas-item.' + kind).count(),
      1,
      kind + ' source added'
    );

  // Saving with all three present must succeed against rc.8, and nothing media-related is sent to it.
  assert(await page.evaluate(() => window.streamCanvas.save()), 'rc.8 rejected the save: ' + rejected);
  assert.deepEqual(rejected, [], 'the relay rejected nothing');
  const sent = await page.evaluate(() => calls.filter(c => c.route?.endsWith('/settings')).map(c => c.body));
  assert(sent.length >= 2);
  for (const body of sent) assert.equal(body.mediaOverlays, undefined, 'no media items are sent to rc.8');
  assert.deepEqual(store.get(alice.id).settings.mediaOverlays, [], 'the relay holds no media sources');
  for (const kind of ['text', 'image', 'browser'])
    assert.equal(
      await page.locator('#layoutPreview .canvas-item.' + kind).count(),
      1,
      kind + ' stays in the editor'
    );
  assert(/stay on this device|stay on this computer|stay local/i.test(await noteText()), await noteText());

  // The End Relay settings (auto-end timer, fallback) save with the sources present.
  await page.locator('#endRelaySettings').click();
  await page.locator('#fallbackTimeout').fill('5');
  await page.locator('#endRelaySave').click();
  await page.waitForFunction(() => !document.getElementById('endRelayWindow').open);
  assert.equal(store.get(alice.id).settings.fallbackTimeoutMinutes, 5, 'the timer reached the relay');
  assert.deepEqual(rejected, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS layout editor with the rc.8 relay: text, picture and browser sources stay local, saves and the End Relay timer are accepted.'
  );
} finally {
  await browser.close();
  server.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
