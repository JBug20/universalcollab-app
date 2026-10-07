// Stream Deck plugin (1.2.0) end to end: the real plugin against a simulated Stream Deck app and the real
// UniversalCollab control module (remote-control.cjs) with a fake window.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  WebSocket = require('../DesktopSource/vendor/ws'),
  remote = require('../DesktopSource/remote-control.cjs');
const pluginDir = path.join(__dirname, '../streamdeck/stream.universalcollab.app.sdPlugin');
const { commandFor, keyState } = require(path.join(pluginDir, 'bin/plugin.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(25)) if (fn()) return;
  throw Error('Timed out waiting for ' + what);
};

(async () => {
  // Pure rules first.
  assert.equal(commandFor('stream', {}, { obs: { live: false } }).action, 'stream-start');
  assert.deepEqual(commandFor('stream', {}, { obs: { live: true } }), {
    action: 'stream-stop',
    confirm: true
  });
  assert(commandFor('obsscene', {}, null).missing);
  assert.equal(commandFor('assist', { assistAction: 'shutdown' }, null).missing.length > 0, true);
  assert.equal(
    keyState('obsscene', { scene: 'B' }, { studioMode: true, obs: { current: 'A', preview: 'B' } }),
    1
  );
  assert.equal(keyState('mute', { input: 'Mic' }, { obs: { inputs: [{ name: 'Mic', muted: true }] } }), 1);
  assert.equal(keyState('clip', {}, { obs: {} }), null);

  // UniversalCollab side: the real control module, a fake window answering commands.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-deck-'));
  const handlers = {},
    listeners = {},
    commands = [];
  const fromWindow = {};
  let clip = '';
  const appPort = 19000 + Math.floor(Math.random() * 500);
  const control = remote.start({
    app: { getPath: () => dir, getVersion: () => 'test', on: () => {} },
    ipcMain: { handle: (n, f) => (handlers[n] = f), on: (n, f) => (listeners[n] = f) },
    guard: e => {
      if (e !== fromWindow) throw Error('rejected');
    },
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (_c, cmd) => {
          commands.push(cmd);
          setTimeout(
            () => listeners['remote-result'](fromWindow, { id: cmd.id, ok: true, message: 'ok' }),
            10
          );
        }
      }
    }),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: s => Buffer.from(s),
      decryptString: b => String(b)
    },
    clipboard: { writeText: t => (clip = t) },
    port: appPort
  });
  handlers['remote-control'](fromWindow, { op: 'enable' });
  handlers['remote-control'](fromWindow, { op: 'copy-token' });

  // Simulated Stream Deck app.
  const deckPort = appPort + 600;
  const deck = new WebSocket.Server({ host: '127.0.0.1', port: deckPort });
  const fromPlugin = [];
  let plugin;
  deck.on('connection', ws => {
    plugin = ws;
    ws.on('message', m => fromPlugin.push(JSON.parse(String(m))));
  });
  const child = spawn(process.execPath, [
    path.join(pluginDir, 'bin/plugin.js'),
    '-port',
    String(deckPort),
    '-pluginUUID',
    'PLUGIN',
    '-registerEvent',
    'registerPlugin',
    '-info',
    '{}'
  ]);
  const toPlugin = m => plugin.send(JSON.stringify(m));
  const A = 'stream.universalcollab.app.';
  try {
    await until(
      () => fromPlugin.some(m => m.event === 'registerPlugin' && m.uuid === 'PLUGIN'),
      'registration'
    );
    await until(() => fromPlugin.some(m => m.event === 'getGlobalSettings'), 'global settings request');

    // A key before pairing: alert, and the settings panel explains how to pair.
    toPlugin({ event: 'keyDown', action: A + 'record', context: 'rec', payload: { settings: {} } });
    await until(
      () => fromPlugin.some(m => m.event === 'showAlert' && m.context === 'rec'),
      'alert before pairing'
    );
    toPlugin({ event: 'propertyInspectorDidAppear', action: A + 'record', context: 'rec' });
    await until(() => fromPlugin.some(m => m.event === 'sendToPropertyInspector'), 'settings info');
    assert.match(fromPlugin.find(m => m.event === 'sendToPropertyInspector').payload.status, /pairing token/);

    // Wrong token: the panel says so.
    toPlugin({ event: 'didReceiveGlobalSettings', payload: { settings: { token: 'wrong', port: appPort } } });
    await wait(300);
    fromPlugin.length = 0;
    toPlugin({ event: 'sendToPlugin', action: A + 'record', context: 'rec', payload: { type: 'getInfo' } });
    await until(() => fromPlugin.some(m => m.event === 'sendToPropertyInspector'), 'wrong token info');
    assert.match(
      fromPlugin.find(m => m.event === 'sendToPropertyInspector').payload.status,
      /Wrong pairing token/
    );

    // Right token: keys appear and light up from the app's state.
    toPlugin({ event: 'didReceiveGlobalSettings', payload: { settings: { token: clip, port: appPort } } });
    for (const [action, context, settings] of [
      ['record', 'rec', {}],
      ['stream', 'live', {}],
      ['obsscene', 'main', { scene: 'Main' }],
      ['mute', 'mic', { input: 'Mic' }],
      ['obsscene', 'empty', {}]
    ])
      toPlugin({ event: 'willAppear', action: A + action, context, payload: { settings } });
    await wait(300);
    listeners['remote-state'](fromWindow, {
      obs: {
        online: true,
        live: true,
        recording: false,
        current: 'Main',
        scenes: ['Main'],
        inputs: [{ name: 'Mic', muted: true }]
      },
      studioMode: false,
      relay: { live: true },
      relayScenes: []
    });
    const stateOf = context =>
      fromPlugin.filter(m => m.event === 'setState' && m.context === context).at(-1)?.payload.state;
    await until(
      () => stateOf('live') === 1 && stateOf('main') === 1 && stateOf('mic') === 1,
      'keys lit from state'
    );
    assert.equal(stateOf('rec'), 0);

    // Record: one press runs the command and shows OK.
    toPlugin({ event: 'keyDown', action: A + 'record', context: 'rec', payload: { settings: {} } });
    await until(() => fromPlugin.some(m => m.event === 'showOk' && m.context === 'rec'), 'record OK');
    assert.equal(commands.at(-1).action, 'record');

    // Stop Stream (live): the first press only asks; the second within 3 s stops.
    const before = commands.length;
    toPlugin({ event: 'keyDown', action: A + 'stream', context: 'live', payload: { settings: {} } });
    await until(
      () =>
        fromPlugin.some(m => m.event === 'setTitle' && m.context === 'live' && /again/.test(m.payload.title)),
      'confirm title'
    );
    await wait(200);
    assert.equal(commands.length, before, 'first press does not stop the stream');
    toPlugin({ event: 'keyDown', action: A + 'stream', context: 'live', payload: { settings: {} } });
    await until(() => commands.length === before + 1, 'stop after second press');
    assert.equal(commands.at(-1).action, 'stream-stop');

    // Scene key with a name; a scene key with nothing chosen alerts without sending anything.
    toPlugin({
      event: 'keyDown',
      action: A + 'obsscene',
      context: 'main',
      payload: { settings: { scene: 'Main' } }
    });
    await until(() => commands.at(-1).action === 'obs-scene', 'scene command');
    assert.deepEqual(commands.at(-1).args, { name: 'Main' });
    const count = commands.length;
    toPlugin({ event: 'keyDown', action: A + 'obsscene', context: 'empty', payload: { settings: {} } });
    await until(
      () => fromPlugin.some(m => m.event === 'showAlert' && m.context === 'empty'),
      'alert for empty scene key'
    );
    assert.equal(commands.length, count);

    // The settings panel gets the lists to choose from.
    toPlugin({ event: 'sendToPlugin', action: A + 'mute', context: 'mic', payload: { type: 'getInfo' } });
    await until(
      () => fromPlugin.filter(m => m.event === 'sendToPropertyInspector').at(-1)?.payload.connected,
      'connected info'
    );
    const info = fromPlugin.filter(m => m.event === 'sendToPropertyInspector').at(-1).payload;
    assert.deepEqual([info.scenes, info.inputs], [['Main'], ['Mic']]);
    console.log(
      'PASS Stream Deck plugin: pairing, wrong token, key states, record, confirm-to-stop, scenes, settings lists.'
    );
  } finally {
    child.kill();
    deck.close();
    control.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
