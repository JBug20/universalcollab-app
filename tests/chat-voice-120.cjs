// Chat voice, main process: the speech command per system (text never in the command line), the speech files and
// their order, errors, and the OBS browser source link serving them (token, host and file checks).
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const tts = require('../DesktopSource/tts.cjs');
const overlays = require('../DesktopSource/overlays.cjs');

(async () => {
  // Text for speaking.
  assert.equal(tts.speakable('hi  https://x.test/a?b=1\n there'), 'hi link there');
  assert.equal(tts.speakable('x'.repeat(1000)).length, tts.MAX_TEXT);
  assert.equal(tts.speakable('   \u0007  '), '');

  // The command for each system keeps the text out of the arguments.
  const secret = 'rm -rf / ; $(whoami) "quote"';
  const win = tts.plan('win32', secret, 'C:\\o.wav');
  assert.equal(win.command, 'powershell.exe');
  assert(!win.args.join(' ').includes('whoami'));
  assert.equal(win.env.UC_TTS_TEXT, secret);
  const mac = tts.plan('darwin', secret, '/o.wav');
  assert.equal(mac.command, 'say');
  assert(!mac.args.join(' ').includes('whoami'));
  assert.equal(mac.input, secret);
  const lin = tts.plan('linux', secret, '/o.wav');
  assert.deepEqual(lin.commands, ['espeak-ng', 'espeak']);
  assert(!lin.args.join(' ').includes('whoami'));
  assert.equal(lin.input, secret);

  // Speech files, in order, with the volume, kept to a limit.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-voice-'));
  const ran = [];
  const make = (platform, behave = () => {}) =>
    tts.create({
      dir,
      platform,
      exec: async (command, args, p) => {
        ran.push({ command, text: p.input ?? p.env?.UC_TTS_TEXT });
        await behave(command);
        const flag = ['-w', '-o'].find(f => args.includes(f)),
          out = flag ? args[args.indexOf(flag) + 1] : p.env?.UC_TTS_OUT;
        fs.writeFileSync(out, 'RIFFfake');
      }
    });
  const voice = make('linux');
  assert.deepEqual(await voice.speak('   '), { queued: false });
  const slow = voice.speak('first', 0.5),
    quick = voice.speak('second', 7);
  await Promise.all([slow, quick]);
  assert.deepEqual(
    ran.map(r => r.text),
    ['first', 'second']
  );
  const q = voice.queue();
  assert.deepEqual(
    q.map(i => [i.seq, i.volume]),
    [
      [1, 0.5],
      [2, 1]
    ],
    'volume is limited to 0..1'
  );
  assert.equal(voice.audio(q[0].id).toString(), 'RIFFfake');
  assert.equal(voice.audio('../../etc/passwd'), null);
  assert.equal(voice.audio('nope-nope'), null);
  for (let i = 0; i < 40; i++) await voice.speak('m' + i, 1);
  assert.equal(voice.queue().length, 30, 'only the newest thirty files are kept');
  assert.equal(voice.audio(q[0].id), null, 'old files are gone');

  // espeak-ng missing: espeak is tried; neither: a clear message.
  const tried = [];
  const fallback = tts.create({
    dir,
    platform: 'linux',
    exec: async (command, args) => {
      tried.push(command);
      if (command === 'espeak-ng') throw Object.assign(Error('not found'), { code: 'ENOENT' });
      fs.writeFileSync(args[args.indexOf('-w') + 1], 'RIFFx');
    }
  });
  await fallback.speak('hello');
  assert.deepEqual(tried, ['espeak-ng', 'espeak']);
  const none = tts.create({
    dir,
    platform: 'linux',
    exec: async () => {
      throw Object.assign(Error('not found'), { code: 'ENOENT' });
    }
  });
  await assert.rejects(none.speak('hello'), /install espeak-ng/);
  // The voice program fails: a short message, and the next message still works.
  let fail = true;
  const flaky = make('darwin', () => {
    if (fail) throw Error('say: boom');
  });
  await assert.rejects(flaky.speak('x'), /could not make that speech/);
  fail = false;
  assert.deepEqual(await flaky.speak('y'), { queued: true });

  // The OBS browser source link.
  const handlers = new Map(),
    events = {};
  const started = overlays.start({
    app: { getPath: () => dir, on: (n, f) => (events[n] = f) },
    ipcMain: { handle: (n, f) => handlers.set(n, f) },
    guard() {},
    clipboard: { writeText: t => (copied = t) },
    voice,
    port: 18900
  });
  let copied = '';
  await new Promise(r => started.server.once('listening', r).listening && r());
  const url = new URL(started.urls().voice),
    base = `http://127.0.0.1:${url.port}`;
  assert(/\/o\/[A-Za-z0-9_-]{22,}\/voice$/.test(url.pathname));
  const get = (p, headers = {}) =>
    new Promise((resolve, reject) =>
      http
        .get({ host: '127.0.0.1', port: url.port, path: p, headers }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              type: res.headers['content-type'],
              body: Buffer.concat(chunks),
              csp: res.headers['content-security-policy']
            })
          );
        })
        .on('error', reject)
    );
  const token = url.pathname.split('/')[2];
  const page = await get(`/o/${token}/voice`);
  assert.equal(page.status, 200);
  assert.match(page.csp, /media-src 'self'/);
  assert.equal((await get(`/o/${token}/voice.js`)).status, 200);
  const list = JSON.parse((await get(`/o/${token}/voice.json`)).body);
  assert.equal(list.items.length, 30);
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['id', 'seq', 'volume'], 'no file paths or text');
  const wav = await get(`/o/${token}/voice-${list.items[0].id}.wav`);
  assert.equal(wav.status, 200);
  assert.equal(wav.type, 'audio/wav');
  assert.equal(wav.body.toString(), 'RIFFfake');
  assert.equal((await get(`/o/${token}/voice-doesnotexist.wav`)).status, 404);
  assert.equal((await get(`/o/${token}/voice-..%2f..%2fx.wav`)).status, 404);
  assert.equal(
    (await get(`/o/WRONGTOKENWRONGTOKENWRONG/voice.json`)).status,
    404,
    'a wrong token gets nothing'
  );
  assert.equal((await get(`/o/${token}/voice.json`, { host: 'evil.test' })).status, 403, 'only this PC');
  // The window can ask for the link, and a link is only given for known overlays.
  const copy = await handlers.get('overlays')({}, { op: 'copy', which: 'voice' });
  assert.equal(copy.ok, true);
  assert.equal(copied, started.urls().voice);
  assert.equal((await handlers.get('overlays')({}, { op: 'copy', which: 'nothing' })).ok, false);
  started.server.close();
  assert.equal(typeof base, 'string');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    'PASS chat voice: system commands without text in them, speech files and order, errors, OBS link.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
