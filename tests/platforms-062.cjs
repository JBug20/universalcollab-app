'use strict';
const assert = require('node:assert/strict'),
  http = require('node:http');
const { PlatformService, TW_SCOPES } = require('../DesktopSource/platforms/service.cjs');
const wait = async fn => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw Error('Timed out');
};
class Socket {
  static all = [];
  constructor(url) {
    this.url = url;
    this.handlers = {};
    Socket.all.push(this);
  }
  addEventListener(k, fn) {
    (this.handlers[k] ??= []).push(fn);
  }
  event(k, v) {
    for (const fn of this.handlers[k] || []) fn(v);
  }
  message(data) {
    this.event('message', { data: JSON.stringify(data) });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.event('close', {});
  }
}
const expiresAt = Date.now() + 3600000;
let db = {
  version: 1,
  clients: {
    twitch: { clientId: 'client' },
    youtube: { clientId: 'google.apps.googleusercontent.com', clientSecret: 'secret' }
  },
  accounts: {
    twitch: { id: '123', name: 'alice', accessToken: 'TW_TOKEN', refreshToken: 'TW_REFRESH', expiresAt },
    youtube: { id: 'UC1', name: 'AliceYT', accessToken: 'YT_TOKEN', refreshToken: 'YT_REFRESH', expiresAt }
  }
};
let calls = [],
  saved,
  opened = [],
  messages = [],
  quota = false;
function response(data = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
}
async function mock(url, opt = {}) {
  calls.push({ url, opt });
  const u = new URL(url);
  if (u.pathname === '/oauth2/device')
    return response({
      device_code: 'PRIVATE_DEVICE_CODE',
      verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCD',
      interval: 5,
      expires_in: 60
    });
  if (u.pathname === '/oauth2/validate')
    return response({ client_id: 'client', user_id: '123', login: 'alice', scopes: TW_SCOPES });
  if (u.pathname === '/oauth2/token' || u.pathname === '/token')
    return response({ access_token: 'NEW_TOKEN', refresh_token: 'ROTATED_REFRESH', expires_in: 3600 });
  if (u.pathname === '/oauth2/revoke' || u.pathname === '/revoke') return response();
  if (u.pathname === '/helix/channels')
    return response({
      data: [{ title: 'Stream', game_id: '42', game_name: 'Game', broadcaster_language: 'en' }]
    });
  if (u.pathname === '/helix/search/categories') return response({ data: [{ id: '7', name: 'Example' }] });
  if (u.pathname === '/youtube/v3/videos')
    return response({
      items: [
        {
          id: u.searchParams.get('id') || 'video',
          snippet: {
            channelId: 'UC1',
            title: 'Before',
            description: 'Old',
            categoryId: '20',
            tags: ['keep'],
            defaultLanguage: 'en'
          },
          liveStreamingDetails: { activeLiveChatId: 'chatYT' }
        }
      ]
    });
  if (u.pathname === '/youtube/v3/channels')
    return response({ items: [{ id: 'UC1', snippet: { title: 'AliceYT' } }] });
  if (u.pathname === '/youtube/v3/liveChat/messages' && (!opt.method || opt.method === 'GET')) {
    if (quota) return response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
    return response({ items: messages, nextPageToken: 'next', pollingIntervalMillis: 9000 });
  }
  if (u.pathname === '/helix/chat/messages')
    return response({ data: [{ is_sent: true, message_id: 'sent' }] });
  return response({ data: [] });
}
(async () => {
  const service = new PlatformService({
    vault: { load: () => structuredClone(db), save: v => (saved = structuredClone(v)) },
    fetchImpl: mock,
    openExternal: async u => opened.push(u),
    WebSocketImpl: Socket
  });
  try {
    await service.twitchInfo();
    await service.updateTwitch({ title: 'Hello', gameId: '42', language: 'en' });
    let c = calls.find(c => c.opt.method === 'PATCH');
    assert.equal(JSON.parse(c.opt.body).title, 'Hello');
    await service.updateYoutube({ id: 'video', title: 'New title', description: 'New description' });
    c = calls.find(c => c.opt.method === 'PUT');
    assert.deepEqual(JSON.parse(c.opt.body).snippet.tags, ['keep']);
    assert.equal(JSON.parse(c.opt.body).snippet.categoryId, '20');
    // Refresh requests are coalesced; rotating refresh token saved before reuse.
    service.db.accounts.twitch.expiresAt = 0;
    const before = calls.filter(c => c.url.includes('/oauth2/token')).length;
    await Promise.all([service.twitchInfo(), service.twitchInfo()]);
    assert.equal(calls.filter(c => c.url.includes('/oauth2/token')).length - before, 1);
    assert.equal(saved.accounts.twitch.refreshToken, 'ROTATED_REFRESH');
    await service.startChat('twitch');
    let ws = Socket.all.at(-1);
    ws.message({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session', keepalive_timeout_seconds: 60 } }
    });
    await wait(() => service.chats.twitch.status === 'Connected');
    assert.equal(calls.filter(c => c.url.endsWith('/eventsub/subscriptions')).length, 4);
    const event = {
      metadata: {
        message_type: 'notification',
        message_id: 'event1',
        message_timestamp: new Date().toISOString()
      },
      payload: {
        subscription: { type: 'channel.chat.message' },
        event: {
          broadcaster_user_id: '123',
          message_id: 'm1',
          chatter_user_id: 'other',
          chatter_user_name: 'Viewer',
          message: { text: '<img src=x onerror=evil()>' }
        }
      }
    };
    ws.message(event);
    ws.message(event);
    assert.equal(service.messages.length, 1);
    await service.send('twitch', 'Hello');
    c = calls.find(c => c.url.endsWith('/helix/chat/messages'));
    assert(!('for_source_only' in JSON.parse(c.opt.body)));
    const tw = service.messages[0];
    await service.moderate(tw.key, 'timeout');
    c = calls.find(c => c.url.includes('/moderation/banned'));
    assert.equal(JSON.parse(c.opt.body).data.duration, 600);
    assert(c.url.includes('broadcaster_id=123'));
    assert.equal(service.messages.length, 0);
    messages = [
      {
        id: 'yt1',
        authorDetails: { channelId: 'viewerYT', displayName: 'Viewer YT' },
        snippet: {
          type: 'textMessageEvent',
          hasDisplayContent: true,
          displayMessage: 'hello YouTube',
          publishedAt: new Date().toISOString()
        }
      }
    ];
    await service.startChat('youtube', { id: 'video' });
    await wait(() => service.messages.some(m => m.platform === 'youtube'));
    const yt = service.messages.find(m => m.platform === 'youtube');
    await service.moderate(yt.key, 'delete');
    c = calls.find(c => c.opt.method === 'DELETE' && c.url.includes('liveChat/messages'));
    assert(c.url.includes('id=yt1'));
    assert(!c.url.includes('twitch'));
    assert(!JSON.stringify(service.snapshot()).includes('YT_TOKEN'));
    assert(!JSON.stringify(service.snapshot()).includes('ROTATED_REFRESH'));
    assert(!JSON.stringify(service.snapshot()).includes('clientSecret'));
    // Reconnect moves the session and does not duplicate subscriptions.
    ws.message({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=1' } }
    });
    const ws2 = Socket.all.at(-1);
    ws2.message({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'replacement' } }
    });
    await wait(() => service.chats.twitch.current === ws2);
    assert(ws.closed);
    assert.equal(calls.filter(c => c.url.endsWith('/eventsub/subscriptions')).length, 4);
    service.stopChat('youtube');
    quota = true;
    await service.startChat('youtube', { id: 'video' });
    await wait(() => !service.chats.youtube);
    assert(service.lastError.youtube.includes('quota'));
    // Google loopback rejects wrong state, then exchanges a matching code with PKCE.
    await service.disconnect('youtube');
    await service.connect('youtube');
    const auth = new URL(opened.at(-1)),
      redirect = auth.searchParams.get('redirect_uri');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal((await fetch(redirect + '?state=bad&code=bad')).status, 400);
    assert(!service.db.accounts.youtube);
    await fetch(
      redirect + '?' + new URLSearchParams({ state: auth.searchParams.get('state'), code: 'testcode' })
    );
    await wait(() => !!service.db.accounts.youtube);
    c = calls.findLast(c => new URL(c.url).pathname === '/token');
    const tokenForm = new URLSearchParams(c.opt.body);
    assert(tokenForm.get('code_verifier').length >= 43);
    assert.equal(tokenForm.get('redirect_uri'), redirect);
    // Cancellation closes listener and late auth cannot restore a removed account.
    await service.disconnect('youtube');
    await service.connect('youtube');
    const job = service.pending.youtube;
    service.cancelAuth('youtube');
    await service.storeTokens('youtube', { access_token: 'late', refresh_token: 'late' }, job);
    assert(!service.db.accounts.youtube);
    await service.disconnect('twitch');
    await service.connect('twitch');
    assert.equal(new URL(opened.at(-1)).hostname, 'www.twitch.tv');
    assert(!JSON.stringify(service.snapshot()).includes('PRIVATE_DEVICE_CODE'));
    await wait(() => !!service.db.accounts.twitch);
    assert.equal(service.db.accounts.twitch.id, '123');
    await assert.rejects(() => service.raw('https://attacker.example/token'));
    console.log(
      'PASS Twitch/YouTube endpoints, token refresh rotation, stream metadata preservation, EventSub dedup/reconnect, platform-specific moderation, quota stop, PKCE/state, cancellation and secret-free renderer snapshots.'
    );
  } finally {
    service.dispose();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
