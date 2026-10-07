// Stream Deck control (1.2.0): local WebSocket security, pairing token, command forwarding and state push.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  WebSocket = require('../DesktopSource/vendor/ws'),
  remote = require('../DesktopSource/remote-control.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-remote-'));
  const handlers = {},
    listeners = {},
    sent = [];
  let clip = '';
  const ipcMain = {
    handle: (n, f) => (handlers[n] = f),
    on: (n, f) => (listeners[n] = f)
  };
  const fromWindow = { sender: 'window' };
  const guard = e => {
    if (e !== fromWindow) throw Error('Request rejected.');
  };
  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel, data) => sent.push({ channel, data }) }
  };
  const port = 18000 + Math.floor(Math.random() * 1000);
  const control = remote.start({
    app: { getPath: () => dir, getVersion: () => '1.2.0-test', on: () => {} },
    ipcMain,
    guard,
    getWindow: () => window,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: s => Buffer.from('enc:' + s),
      decryptString: b => String(b).slice(4)
    },
    clipboard: { writeText: t => (clip = t) },
    port
  });
  const ask = op => handlers['remote-control'](fromWindow, { op });
  try {
    // Off until enabled; the page can never read the token, only copy it.
    assert.equal((await ask('status')).enabled, false);
    assert.throws(
      () => handlers['remote-control']({ sender: 'web page' }, { op: 'enable' }),
      /Request rejected/
    );
    let s = await ask('enable');
    assert.equal(s.enabled, true);
    assert.equal(s.token, undefined, 'the token is never returned to the page');
    await ask('copy-token');
    const token = clip;
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert(
      !fs.readFileSync(path.join(dir, 'stream-deck.json'), 'utf8').includes(token),
      'token is stored encrypted'
    );

    const connect = headers =>
      new Promise(resolve => {
        const ws = new WebSocket('ws://127.0.0.1:' + port, { headers });
        const messages = [];
        ws.on('message', m => messages.push(JSON.parse(String(m))));
        ws.on('open', () => resolve({ ws, messages, open: true }));
        ws.on('unexpected-response', (_req, res) => resolve({ open: false, status: res.statusCode }));
        ws.on('error', () => resolve({ open: false }));
      });
    const closed = ws => new Promise(r => ws.on('close', code => r(code)));
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // Web pages (Origin header) and other host names are refused before any token check.
    assert.equal((await connect({ Origin: 'https://evil.example' })).open, false);
    assert.equal((await connect({ Host: 'evil.example:' + port })).open, false);

    // Wrong token: closed with 4401.
    let c = await connect();
    c.ws.send(JSON.stringify({ type: 'hello', token: 'nope' }));
    assert.equal(await closed(c.ws), 4401);

    // Right token: hello, then commands reach the window and results come back.
    c = await connect();
    c.ws.send(JSON.stringify({ type: 'hello', token }));
    await wait(100);
    assert.equal(c.messages[0].type, 'hello');
    c.ws.send(
      JSON.stringify({ type: 'command', id: 'k1', action: 'obs-scene', args: { name: 'Just Chatting' } })
    );
    await wait(100);
    const forwarded = sent.find(x => x.channel === 'remote-command');
    assert.deepEqual(forwarded.data.args, { name: 'Just Chatting' });
    assert.equal(forwarded.data.action, 'obs-scene');
    listeners['remote-result'](fromWindow, { id: forwarded.data.id, ok: true, message: 'Switched.' });
    // A result from anywhere but the window is ignored.
    listeners['remote-result']({ sender: 'web page' }, { id: forwarded.data.id, ok: false, error: 'spoof' });
    await wait(100);
    const result = c.messages.find(m => m.type === 'result');
    assert.deepEqual([result.id, result.ok, result.message], ['k1', true, 'Switched.']);

    // Invalid commands never reach the window.
    const before = sent.length;
    for (const bad of [
      { type: 'command', id: 'k2', action: 'format-disk' },
      { type: 'command', id: 'k3', action: 'assist', args: { action: 'shutdown' } },
      { type: 'command', id: 'k4', action: 'mute', args: { name: '' } }
    ])
      c.ws.send(JSON.stringify(bad));
    await wait(150);
    assert.equal(sent.length, before);
    assert.equal(c.messages.filter(m => m.type === 'result' && !m.ok).length, 3);

    // State from the window is pushed to paired keys, once per change.
    listeners['remote-state'](fromWindow, { obs: { live: true } });
    listeners['remote-state'](fromWindow, { obs: { live: true } });
    await wait(100);
    assert.equal(c.messages.filter(m => m.type === 'state').length, 1);
    assert.equal(c.messages.find(m => m.type === 'state').state.obs.live, true);

    // Resetting the token disconnects existing pairings; turning off closes the port.
    const gone = closed(c.ws);
    await ask('reset-token');
    assert.equal(await gone, 4401);
    await ask('disable');
    assert.equal((await connect()).open, false);
    console.log(
      'PASS Stream Deck control: local only, token, web pages refused, commands, state, reset, off.'
    );
  } finally {
    control.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
