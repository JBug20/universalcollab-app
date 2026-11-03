// Go-live announcements (1.2.0): Discord webhook links are checked, pings only go where chosen, Discord's answers
// become clear messages, the webhook is stored encrypted and never handed to the window, and the window's message
// template, links and once-per-broadcast rule.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { discordWebhook, discordBody, postDiscord, start } = require('../DesktopSource/announce.cjs');
const { fill, destinations, step, DEFAULTS } = require('../DesktopSource/announce.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-abcdefghij';
(async () => {
  // Webhook links.
  const hook = discordWebhook(' https://discord.com/api/webhooks/123456789012/' + TOKEN + ' ');
  assert.equal(hook.url, 'https://discord.com/api/webhooks/123456789012/' + TOKEN);
  assert.equal(hook.id, '123456789012');
  assert.equal(discordWebhook('https://discordapp.com/api/webhooks/123456789012/' + TOKEN).url, hook.url);
  assert.equal(
    discordWebhook('https://ptb.discord.com/api/v10/webhooks/123456789012/' + TOKEN).url,
    hook.url
  );
  assert.equal(discordWebhook(hook.url + '?thread_id=555555555').thread, '555555555');
  for (const bad of [
    '',
    'not a link',
    'http://discord.com/api/webhooks/123456789012/' + TOKEN,
    'https://discord.com.evil.example/api/webhooks/123456789012/' + TOKEN,
    'https://evil.example/api/webhooks/123456789012/' + TOKEN,
    'https://user:pw@discord.com/api/webhooks/123456789012/' + TOKEN,
    'https://discord.com/api/webhooks/123456789012',
    'https://discord.com/channels/1/2',
    hook.url + '?thread_id=abc'
  ])
    assert.throws(() => discordWebhook(bad), Error, bad);

  // Pings: none by default; names in the text never ping.
  assert.deepEqual(discordBody('Live @everyone'), {
    content: 'Live @everyone',
    allowed_mentions: { parse: [] }
  });
  assert.deepEqual(discordBody('Live', { kind: 'here' }), {
    content: '@here Live',
    allowed_mentions: { parse: ['everyone'] }
  });
  assert.deepEqual(discordBody('Live', { kind: 'role', roleId: '987654321' }), {
    content: '<@&987654321> Live',
    allowed_mentions: { parse: [], roles: ['987654321'] }
  });
  assert.throws(() => discordBody('Live', { kind: 'role', roleId: 'x' }), /role ID/);
  assert.throws(() => discordBody('   '), /empty/);
  assert.equal(discordBody('x'.repeat(3000)).content.length, 2000);

  // Posting: what is sent, and Discord's answers.
  const sent = [];
  const fetchWith = status => async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body), method: opts.method });
    return { ok: status < 300, status, json: async () => ({ message: 'Invalid Form Body' }) };
  };
  assert.deepEqual(await postDiscord(fetchWith(200), hook, 'Hello', {}), { posted: true });
  assert.equal(sent[0].url, hook.url + '?wait=true');
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].body.content, 'Hello');
  await postDiscord(fetchWith(200), { ...hook, thread: '555555555' }, 'Hi', {});
  assert.equal(sent[1].url, hook.url + '?wait=true&thread_id=555555555');
  await assert.rejects(postDiscord(fetchWith(404), hook, 'Hi'), /no longer exists/);
  await assert.rejects(postDiscord(fetchWith(401), hook, 'Hi'), /no longer exists/);
  await assert.rejects(postDiscord(fetchWith(429), hook, 'Hi'), /slow down/);
  await assert.rejects(postDiscord(fetchWith(400), hook, 'Hi'), /Invalid Form Body/);
  await assert.rejects(postDiscord(fetchWith(500), hook, 'Hi'), /error 500/);
  await assert.rejects(
    postDiscord(
      async () => {
        throw Error('offline');
      },
      hook,
      'Hi'
    ),
    /Could not reach Discord/
  );

  // Main side: stored encrypted, the window only learns whether it is set up.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-announce-'));
  try {
    const handlers = {};
    const safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: s => Buffer.from('ENC:' + Buffer.from(s).toString('base64')),
      decryptString: b => Buffer.from(String(b).slice(4), 'base64').toString()
    };
    const posts = [];
    start({
      app: { getPath: () => dir },
      ipcMain: { handle: (name, fn) => (handlers[name] = fn) },
      guard: () => {},
      safeStorage,
      platform: 'win32',
      fetch: async (url, opts) => {
        posts.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200 };
      }
    });
    const call = input => handlers.announce({}, input);
    assert.deepEqual((await call({ op: 'status' })).data, { discord: null });
    assert.match((await call({ op: 'post', app: 'discord', text: 'x' })).error, /Set up Discord/);
    assert.match(
      (await call({ op: 'save-discord', webhook: 'https://example.com/x' })).error,
      /not a Discord/
    );
    const saved = await call({ op: 'save-discord', webhook: hook.url });
    assert.deepEqual(saved.data, { discord: { configured: true, id: '123456789012', thread: false } });
    assert(!JSON.stringify(saved).includes(TOKEN), 'the webhook token never goes to the window');
    const raw = fs.readFileSync(path.join(dir, 'announcements.bin'), 'utf8');
    assert(raw.startsWith('ENC:') && !raw.includes(TOKEN), 'stored encrypted');
    const r = await call({ op: 'post', app: 'discord', text: 'Live!', ping: { kind: 'here' } });
    assert.deepEqual(r, { ok: true, data: { posted: true } });
    assert.equal(posts[0].url, hook.url + '?wait=true');
    assert.equal(posts[0].body.content, '@here Live!');
    assert.match((await call({ op: 'post', app: 'x', text: 'Live!' })).error, /Unknown app/);
    await call({ op: 'remove-discord' });
    assert.equal(fs.existsSync(path.join(dir, 'announcements.bin')), false);
    assert.deepEqual((await call({ op: 'status' })).data, { discord: null });
    // No secure storage (Linux without a keychain): not saved.
    const handlers2 = {};
    start({
      app: { getPath: () => dir },
      ipcMain: { handle: (name, fn) => (handlers2[name] = fn) },
      guard: () => {},
      safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' },
      platform: 'linux'
    });
    assert.match((await handlers2.announce({}, { op: 'save-discord', webhook: hook.url })).error, /securely/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Window side: the message.
  const d = destinations(
    [
      { id: 'twitch', name: 'Twitch' },
      { id: 'yt-1', name: 'YouTube' },
      { id: 'kick', name: 'Kick' },
      { id: 'twitch-2', name: 'Twitch' }
    ],
    { twitch: 'https://twitch.tv/me', kick: 'https://kick.com/me' }
  );
  assert.deepEqual(d, {
    platforms: ['Twitch', 'YouTube', 'Kick'],
    links: ['https://twitch.tv/me', 'YouTube', 'https://kick.com/me']
  });
  assert.equal(
    fill(DEFAULTS.live, { title: 'Chill', game: 'Minecraft', collaborators: ['Bob', 'Cat'], ...d }),
    '🔴 Live now: Chill (Minecraft) with Bob and Cat! Watch on https://twitch.tv/me · YouTube · https://kick.com/me'
  );
  assert.equal(fill(DEFAULTS.live, {}), '🔴 Live now: the stream! Watch on my channels');
  assert.equal(fill('{platforms} {unknown}', d), 'Twitch, YouTube, Kick {unknown}');
  // Once per broadcast; nothing for a broadcast already running when the app started.
  assert.equal(step(null, true), null);
  assert.equal(step(false, true), 'live');
  assert.equal(step(true, true), null);
  assert.equal(step(true, false), 'end');
  assert.equal(step(false, false), null);
  console.log(
    'PASS go-live announcements: webhook checks, pings, Discord answers, encrypted storage, message.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
