'use strict';
const http = require('node:http'),
  crypto = require('node:crypto');
const TW_SCOPES = [
  'channel:read:stream_key',
  'channel:manage:broadcast',
  'user:read:chat',
  'user:write:chat',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users'
];
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const origins = new Set([
  'https://ingest.twitch.tv',
  'https://id.twitch.tv',
  'https://api.twitch.tv',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com'
]);
class PlatformError extends Error {
  constructor(message, status = 0, reason = '') {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}
const str = (v, max = 500) => {
  if (typeof v !== 'string' || v.length > max) throw new PlatformError('Invalid field value.');
  return v;
};
const provider = p => {
  if (!['twitch', 'youtube'].includes(p)) throw new PlatformError('Unknown platform.');
  return p;
};
const qs = v =>
  new URLSearchParams(Object.entries(v).filter(([, x]) => x !== undefined && x !== null)).toString();
const clone = x => structuredClone(x);
class PlatformService {
  constructor({
    vault,
    fetchImpl = fetch,
    openExternal,
    WebSocketImpl = globalThis.WebSocket,
    notify = () => {},
    now = Date.now
  }) {
    Object.assign(this, { vault, fetch: fetchImpl, openExternal, WebSocketImpl, notify, now });
    this.db = vault.load();
    this.pending = {};
    this.refreshing = {};
    this.chats = {};
    this.messages = [];
    this.lastError = {};
    this.cooldown = {};
    this.disposed = false;
    this.mutations = Promise.resolve();
    this.validationTimer = setInterval(
      () => {
        if (this.db.accounts.twitch)
          this.validateTwitch().catch(() => {
            this.stopChat('twitch');
            this.lastError.twitch = 'Twitch session needs attention. Reconnect your account.';
            this.emit();
          });
      },
      55 * 60 * 1000
    );
    this.validationTimer.unref?.();
    if (this.db.accounts.twitch)
      queueMicrotask(() =>
        this.validateTwitch().catch(() => {
          this.lastError.twitch = 'Twitch session needs attention. Reconnect your account.';
          this.emit();
        })
      );
  }
  emit() {
    if (!this.disposed) this.notify(this.snapshot());
  }
  save() {
    if (!this.disposed) this.vault.save(this.db);
  }
  snapshot() {
    return {
      accounts: Object.fromEntries(
        ['twitch', 'youtube'].map(p => [
          p,
          this.db.accounts[p] ? { id: this.db.accounts[p].id, name: this.db.accounts[p].name } : null
        ])
      ),
      configured: Object.fromEntries(['twitch', 'youtube'].map(p => [p, !!this.db.clients[p]?.clientId])),
      auth: Object.fromEntries(
        Object.entries(this.pending).map(([p, x]) => [
          p,
          { status: x.status || 'waiting', error: x.error || '' }
        ])
      ),
      chats: Object.fromEntries(
        ['twitch', 'youtube'].map(p => [
          p,
          {
            running: !!this.chats[p],
            status: this.chats[p]?.status || 'Stopped',
            error: this.lastError[p] || ''
          }
        ])
      ),
      messages: this.messages.map(({ ...m }) => m)
    };
  }
  async raw(url, { method = 'GET', headers = {}, body } = {}) {
    if (!origins.has(new URL(url).origin)) throw new PlatformError('Platform endpoint rejected.');
    let r;
    try {
      r = await this.fetch(url, {
        method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new PlatformError('Platform connection failed. Check your connection and retry.');
    }
    if (r.status === 204) return {};
    let data;
    try {
      const text = await r.text();
      if (text.length > 2_000_000) throw Error();
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new PlatformError('Platform returned an unreadable response.');
    }
    if (!r.ok) {
      const reason =
        typeof data.error === 'string'
          ? data.error
          : typeof data.message === 'string'
            ? data.message
            : data.error?.errors?.[0]?.reason || '';
      const msg =
        r.status === 401
          ? 'Sign-in expired or was revoked. Reconnect your account.'
          : r.status === 403
            ? 'Platform permission denied, API not enabled, or quota exhausted. Check your account and developer project.'
            : r.status === 429
              ? 'Platform rate limit reached. Wait before retrying.'
              : 'Platform request failed. Check your input and account permissions.';
      throw new PlatformError(msg, r.status, reason);
    }
    return data;
  }
  form(url, body) {
    return this.raw(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs(body)
    });
  }
  configure(p, input) {
    provider(p);
    if (this.pending[p]?.status === 'waiting' || this.db.accounts[p])
      throw new PlatformError('Disconnect this platform before changing its application settings.');
    const clientId = str(input.clientId, 256).trim(),
      clientSecret = str(input.clientSecret || '', 256).trim();
    if (!clientId || !/^[A-Za-z0-9_.-]+$/.test(clientId))
      throw new PlatformError('Enter a valid OAuth Client ID.');
    if (p === 'twitch' && clientSecret)
      throw new PlatformError('Use a Twitch public client; it does not need a secret.');
    const old = this.db.clients[p];
    this.db.clients[p] = { clientId, ...(clientSecret ? { clientSecret } : {}) };
    try {
      this.save();
    } catch (e) {
      this.db.clients[p] = old;
      throw e;
    }
    return this.snapshot();
  }
  account(p) {
    provider(p);
    const a = this.db.accounts[p];
    if (!a) throw new PlatformError('Connect your ' + p + ' account first.');
    return a;
  }
  async refreshed(p) {
    if (this.refreshing[p]) return this.refreshing[p];
    const a = this.account(p),
      c = this.db.clients[p];
    if (!a.refreshToken) throw new PlatformError('Reconnect your account to renew access.');
    this.refreshing[p] = (async () => {
      const t = await this.form(
        p === 'twitch' ? 'https://id.twitch.tv/oauth2/token' : 'https://oauth2.googleapis.com/token',
        {
          client_id: c.clientId,
          client_secret: c.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: a.refreshToken
        }
      );
      if (this.db.accounts[p] !== a) throw new PlatformError('Account changed. Retry the action.');
      a.accessToken = t.access_token;
      a.refreshToken = t.refresh_token || a.refreshToken;
      a.expiresAt = this.now() + Number(t.expires_in || 3600) * 1000;
      this.save();
      return a;
    })().finally(() => delete this.refreshing[p]);
    return this.refreshing[p];
  }
  async api(p, route, { method = 'GET', body } = {}, retry = true) {
    let a = this.account(p);
    if (a.expiresAt < this.now() + 60000) a = await this.refreshed(p);
    if ((this.cooldown[p] || 0) > this.now())
      throw new PlatformError('Platform rate limit reached. Wait before retrying.');
    const base = p === 'twitch' ? 'https://api.twitch.tv/helix/' : 'https://www.googleapis.com/youtube/v3/';
    try {
      return await this.raw(base + route, {
        method,
        headers: {
          Authorization: 'Bearer ' + a.accessToken,
          ...(p === 'twitch' ? { 'Client-Id': this.db.clients[p].clientId } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (e.status === 429) this.cooldown[p] = this.now() + 60000;
      if (e.status === 401 && retry) {
        await this.refreshed(p);
        return this.api(p, route, { method, body }, false);
      }
      throw e;
    }
  }
  async validateTwitch() {
    let a = this.account('twitch');
    if (a.expiresAt < this.now() + 60000) a = await this.refreshed('twitch');
    let v;
    try {
      v = await this.raw('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + a.accessToken }
      });
    } catch (e) {
      if (e.status !== 401) throw e;
      a = await this.refreshed('twitch');
      v = await this.raw('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + a.accessToken }
      });
    }
    if (v.client_id !== this.db.clients.twitch.clientId || v.user_id !== a.id)
      throw new PlatformError('Twitch account validation failed.');
    return v;
  }
  async connect(p) {
    provider(p);
    if (!this.db.clients[p])
      throw new PlatformError(
        (p === 'twitch' ? 'Twitch' : 'YouTube') +
          ' sign-in is not configured in this build. Ask the app owner for a version with platform sign-in enabled.'
      );
    if (this.db.accounts[p]) throw new PlatformError('Account is already connected.');
    if (this.pending[p]?.status === 'waiting') throw new PlatformError('A sign-in is already in progress.');
    const job = { status: 'waiting' };
    this.pending[p] = job;
    this.emit();
    try {
      if (p === 'twitch') await this.twitchAuth(job);
      else await this.youtubeAuth(job);
    } catch (e) {
      this.cancelAuth(p);
      this.pending[p] = {
        status: 'error',
        error: e instanceof PlatformError ? e.message : 'Could not start browser sign-in.'
      };
      this.emit();
      throw new PlatformError(this.pending[p].error);
    }
    return this.snapshot();
  }
  cancelAuth(p) {
    const j = this.pending[p];
    if (j) {
      clearTimeout(j.timer);
      j.server?.close();
      j.cancelled = true;
    }
    delete this.pending[p];
    this.emit();
  }
  authFailed(p, job, message) {
    if (this.pending[p] !== job) return;
    clearTimeout(job.timer);
    job.server?.close();
    job.status = 'error';
    job.error = message;
    this.emit();
  }
  async storeTokens(p, t, job) {
    if (this.pending[p] !== job || job.cancelled) return;
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string')
      throw new PlatformError('Platform did not grant renewable access. Reconnect and approve access.');
    const a = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: this.now() + Number(t.expires_in || 3600) * 1000
    };
    const c = this.db.clients[p];
    let user;
    if (p === 'twitch') {
      const v = await this.raw('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + a.accessToken }
      });
      if (v.client_id !== c.clientId || !v.user_id || TW_SCOPES.some(s => !v.scopes?.includes(s)))
        throw new PlatformError('Approve the requested Twitch permissions to finish linking.');
      user = { id: v.user_id, name: v.login };
    } else {
      const v = await this.raw('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: 'Bearer ' + a.accessToken }
      });
      const ch = v.items?.[0];
      if (!ch) throw new PlatformError('This Google account has no accessible YouTube channel.');
      user = { id: ch.id, name: ch.snippet.title };
    }
    if (this.pending[p] !== job || job.cancelled) return;
    this.db.accounts[p] = { ...a, ...user };
    try {
      this.save();
    } catch (e) {
      delete this.db.accounts[p];
      throw e;
    }
    clearTimeout(job.timer);
    job.server?.close();
    delete this.pending[p];
    this.lastError[p] = '';
    this.emit();
  }
  async twitchAuth(job) {
    const c = this.db.clients.twitch,
      d = await this.form('https://id.twitch.tv/oauth2/device', {
        client_id: c.clientId,
        scopes: TW_SCOPES.join(' ')
      });
    if (this.pending.twitch !== job) return;
    const u = new URL(d.verification_uri);
    if (u.protocol !== 'https:' || u.hostname !== 'www.twitch.tv' || u.pathname !== '/activate')
      throw new PlatformError('Unexpected Twitch sign-in address.');
    job.deadline = this.now() + Math.min(Number(d.expires_in) || 1800, 1800) * 1000;
    job.interval = Math.max(5, Number(d.interval) || 5) * 1000;
    await this.openExternal(u.href); // Activation code is shown only in the user's browser, never in the app.
    const poll = async () => {
      if (this.pending.twitch !== job || job.cancelled) return;
      if (this.now() > job.deadline) return this.authFailed('twitch', job, 'Sign-in expired. Try again.');
      try {
        const t = await this.form('https://id.twitch.tv/oauth2/token', {
          client_id: c.clientId,
          scopes: TW_SCOPES.join(' '),
          device_code: d.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });
        await this.storeTokens('twitch', t, job);
      } catch (e) {
        if (['authorization_pending', 'slow_down'].includes(e.reason)) {
          if (e.reason === 'slow_down') job.interval += 5000;
          job.timer = setTimeout(poll, job.interval);
          job.timer.unref?.();
        } else this.authFailed('twitch', job, 'Twitch sign-in failed or was declined. Try again.');
      }
    };
    job.timer = setTimeout(poll, job.interval);
    job.timer.unref?.();
  }
  async youtubeAuth(job) {
    const c = this.db.clients.youtube,
      state = crypto.randomBytes(32).toString('base64url'),
      verifier = crypto.randomBytes(48).toString('base64url');
    let redirect;
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const u = new URL(req.url, 'http://127.0.0.1');
      if (
        req.method !== 'GET' ||
        u.pathname !== '/oauth/callback' ||
        u.searchParams.get('state') !== state ||
        job.handled ||
        this.pending.youtube !== job
      ) {
        res.writeHead(400).end('Invalid or expired sign-in response.');
        return;
      }
      job.handled = true;
      if (u.searchParams.has('error')) {
        res.end('Sign-in was declined. Return to UniversalCollab.');
        this.authFailed('youtube', job, 'YouTube sign-in was declined.');
        return;
      }
      const code = u.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('Missing authorization code.');
        this.authFailed('youtube', job, 'YouTube sign-in failed.');
        return;
      }
      res.end('You can return to UniversalCollab. This window can be closed.');
      try {
        const t = await this.form('https://oauth2.googleapis.com/token', {
          client_id: c.clientId,
          client_secret: c.clientSecret,
          code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirect
        });
        await this.storeTokens('youtube', t, job);
      } catch {
        this.authFailed(
          'youtube',
          job,
          'YouTube sign-in failed. Check the Desktop OAuth client, enabled API and test-user access.'
        );
      }
    });
    job.server = server;
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    redirect = 'http://127.0.0.1:' + server.address().port + '/oauth/callback';
    job.timer = setTimeout(() => this.authFailed('youtube', job, 'Sign-in expired. Try again.'), 300000);
    job.timer.unref?.();
    await this.openExternal(
      'https://accounts.google.com/o/oauth2/v2/auth?' +
        qs({
          client_id: c.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          scope: YT_SCOPE,
          state,
          code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'select_account consent'
        })
    );
  }
  async disconnect(p) {
    provider(p);
    this.cancelAuth(p);
    this.stopChat(p);
    const a = this.db.accounts[p];
    if (!a) return this.snapshot();
    delete this.db.accounts[p];
    try {
      this.save();
    } catch (e) {
      this.db.accounts[p] = a;
      throw e;
    }
    this.messages = this.messages.filter(m => m.platform !== p);
    this.emit();
    try {
      if (p === 'twitch')
        await this.form('https://id.twitch.tv/oauth2/revoke', {
          client_id: this.db.clients[p].clientId,
          token: a.accessToken
        });
      else
        await this.form('https://oauth2.googleapis.com/revoke', { token: a.refreshToken || a.accessToken });
    } catch {
      this.lastError[p] =
        'Removed locally. Remote revocation could not be confirmed; you can remove access in your platform account settings.';
    }
    this.emit();
    return this.snapshot();
  }
  async twitchInfo() {
    const a = this.account('twitch');
    const r = await this.api('twitch', 'channels?' + qs({ broadcaster_id: a.id }));
    const c = r.data?.[0];
    if (!c) throw new PlatformError('Channel info is unavailable.');
    return { title: c.title, gameId: c.game_id, gameName: c.game_name, language: c.broadcaster_language };
  }
  async categories(query) {
    const r = await this.api('twitch', 'search/categories?' + qs({ query: str(query, 100), first: 20 }));
    return (r.data || []).map(x => ({ id: x.id, name: x.name }));
  }
  async updateTwitch(input) {
    const a = this.account('twitch'),
      title = str(input.title, 140).trim(),
      gameId = str(input.gameId || '', 32),
      language = str(input.language || 'en', 12);
    if (!title || !/^\d*$/.test(gameId) || !/^[a-z-]{2,12}$/.test(language))
      throw new PlatformError('Check title, category and language.');
    await this.api('twitch', 'channels?' + qs({ broadcaster_id: a.id }), {
      method: 'PATCH',
      body: { title, game_id: gameId || '0', broadcaster_language: language }
    });
    return this.twitchInfo();
  }
  async broadcasts() {
    const r = await this.api(
      'youtube',
      'liveBroadcasts?' + qs({ part: 'snippet,status', mine: true, maxResults: 50, broadcastType: 'all' })
    );
    return (r.items || []).map(b => ({
      id: b.id,
      title: b.snippet.title,
      description: b.snippet.description || '',
      chatId: b.snippet.liveChatId || '',
      state: b.status.lifeCycleStatus
    }));
  }
  async youtubeInfo(id) {
    str(id, 128);
    const r = await this.api('youtube', 'videos?' + qs({ part: 'snippet,liveStreamingDetails', id }));
    const v = r.items?.[0];
    if (!v || v.snippet.channelId !== this.account('youtube').id)
      throw new PlatformError('Choose a broadcast owned by this YouTube channel.');
    return v;
  }
  async updateYoutube(input) {
    const v = await this.youtubeInfo(input.id),
      title = str(input.title, 100).trim(),
      description = str(input.description || '', 5000);
    if (!title || /[<>]/.test(title)) throw new PlatformError('Enter a valid title.');
    const snippet = { title, description, categoryId: input.categoryId || v.snippet.categoryId };
    for (const k of ['tags', 'defaultLanguage', 'defaultAudioLanguage'])
      if (v.snippet[k] !== undefined) snippet[k] = v.snippet[k];
    await this.api('youtube', 'videos?part=snippet', { method: 'PUT', body: { id: v.id, snippet } });
    return { id: v.id, title, description, categoryId: snippet.categoryId };
  }
  addMessage(m) {
    if (
      !m.id ||
      this.messages.some(x => x.platform === m.platform && x.channel === m.channel && x.id === m.id)
    )
      return;
    this.messages.push({
      ...m,
      key: crypto.randomUUID(),
      time: m.time || new Date(this.now()).toISOString()
    });
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
    this.emit();
  }
  removeMessages(p, predicate) {
    this.messages = this.messages.filter(m => m.platform !== p || !predicate(m));
    this.emit();
  }
  stopChat(p) {
    provider(p);
    const c = this.chats[p];
    delete this.chats[p];
    if (c) {
      clearTimeout(c.timer);
      clearTimeout(c.watchdog);
      for (const ws of c.sockets || []) ws.close();
    }
    this.emit();
    return this.snapshot();
  }
  async startChat(p, input = {}) {
    provider(p);
    this.account(p);
    this.stopChat(p);
    this.lastError[p] = '';
    if (p === 'twitch') {
      await this.validateTwitch();
      this.startTwitch();
    } else await this.startYoutube(input.id);
    return this.snapshot();
  }
  startTwitch() {
    const c = { status: 'Connecting', sockets: new Set(), seen: new Set(), retry: 1000 };
    this.chats.twitch = c;
    const connect = (url = 'wss://eventsub.wss.twitch.tv/ws', transferring = false, old = null) => {
      if (this.chats.twitch !== c) return;
      const u = new URL(url);
      if (u.protocol !== 'wss:' || u.hostname !== 'eventsub.wss.twitch.tv') {
        this.lastError.twitch = 'Unexpected chat reconnect address.';
        this.stopChat('twitch');
        return;
      }
      const ws = new this.WebSocketImpl(url);
      c.sockets.add(ws);
      if (!transferring) c.current = ws;
      let watchdog;
      const reset = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ws.close(), (c.keepalive || 15) * 1000 + 5000);
        watchdog.unref?.();
      };
      ws.addEventListener('message', async ev => {
        if (this.chats.twitch !== c) return;
        let data;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        reset();
        const meta = data.metadata || {},
          payload = data.payload || {};
        try {
          if (meta.message_type === 'session_welcome') {
            c.keepalive = payload.session.keepalive_timeout_seconds || 15;
            reset();
            if (!transferring) {
              const a = this.account('twitch');
              for (const type of [
                'channel.chat.message',
                'channel.chat.message_delete',
                'channel.chat.clear',
                'channel.chat.clear_user_messages'
              ])
                await this.api('twitch', 'eventsub/subscriptions', {
                  method: 'POST',
                  body: {
                    type,
                    version: '1',
                    condition: { broadcaster_user_id: a.id, user_id: a.id },
                    transport: { method: 'websocket', session_id: payload.session.id }
                  }
                });
            }
            if (this.chats.twitch !== c) {
              ws.close();
              return;
            }
            c.current = ws;
            c.retry = 1000;
            c.status = 'Connected';
            if (old) {
              c.sockets.delete(old);
              old.close();
            }
            this.emit();
          } else if (meta.message_type === 'session_reconnect') {
            c.current = ws;
            connect(payload.session.reconnect_url, true, ws);
          } else if (meta.message_type === 'revocation') {
            this.lastError.twitch = 'Chat authorization was revoked. Reconnect Twitch.';
            this.stopChat('twitch');
          } else if (meta.message_type === 'notification') {
            if (c.seen.has(meta.message_id)) return;
            c.seen.add(meta.message_id);
            if (c.seen.size > 1000) c.seen.delete(c.seen.values().next().value);
            const e = payload.event || {},
              type = payload.subscription?.type;
            if (type === 'channel.chat.message')
              this.addMessage({
                platform: 'twitch',
                channel: e.broadcaster_user_id,
                id: e.message_id,
                authorId: e.chatter_user_id,
                author: e.chatter_user_name,
                text: e.message?.text || '',
                time: meta.message_timestamp
              });
            else if (type === 'channel.chat.message_delete')
              this.removeMessages('twitch', m => m.id === e.message_id);
            else if (type === 'channel.chat.clear_user_messages')
              this.removeMessages('twitch', m => m.authorId === e.target_user_id);
            else if (type === 'channel.chat.clear') this.removeMessages('twitch', () => true);
          }
        } catch (e) {
          this.lastError.twitch = e.message;
          this.stopChat('twitch');
        }
      });
      ws.addEventListener('error', () => {});
      ws.addEventListener('close', () => {
        clearTimeout(watchdog);
        c.sockets.delete(ws);
        if (this.chats.twitch !== c || (c.current && c.current !== ws)) return;
        c.current = null;
        c.status = 'Reconnecting';
        this.emit();
        clearTimeout(c.timer);
        c.timer = setTimeout(() => connect(), c.retry);
        c.retry = Math.min(30000, c.retry * 2);
        c.timer.unref?.();
      });
      reset();
    };
    connect();
    this.emit();
  }
  async startYoutube(id) {
    const v = await this.youtubeInfo(id),
      chatId = v.liveStreamingDetails?.activeLiveChatId;
    if (!chatId)
      throw new PlatformError('This broadcast has no active live chat. Start or select a live broadcast.');
    this.removeMessages('youtube', () => true);
    const c = { id, chatId, status: 'Connecting', token: null, errors: 0 };
    this.chats.youtube = c;
    const poll = async () => {
      if (this.chats.youtube !== c) return;
      try {
        const r = await this.api(
          'youtube',
          'liveChat/messages?' +
            qs({ liveChatId: chatId, part: 'id,snippet,authorDetails', maxResults: 200, pageToken: c.token })
        );
        if (this.chats.youtube !== c) return;
        c.token = r.nextPageToken;
        c.errors = 0;
        c.status = 'Connected';
        for (const m of r.items || []) {
          const s = m.snippet || {};
          if (s.type === 'messageDeletedEvent') {
            this.removeMessages('youtube', x => x.id === s.messageDeletedDetails?.deletedMessageId);
            continue;
          }
          if (s.type === 'userBannedEvent') {
            this.removeMessages(
              'youtube',
              x => x.authorId === s.userBannedDetails?.bannedUserDetails?.channelId
            );
            continue;
          }
          if (s.hasDisplayContent)
            this.addMessage({
              platform: 'youtube',
              channel: chatId,
              id: m.id,
              authorId: m.authorDetails?.channelId,
              author: m.authorDetails?.displayName || 'YouTube',
              text: s.displayMessage || '',
              time: s.publishedAt
            });
        }
        this.emit();
        if (r.offlineAt) {
          c.status = 'Chat ended';
          this.lastError.youtube = 'This live chat has ended.';
          this.stopChat('youtube');
          return;
        }
        c.timer = setTimeout(poll, Math.max(5000, Number(r.pollingIntervalMillis) || 5000));
        c.timer.unref?.();
      } catch (e) {
        if (this.chats.youtube !== c) return;
        this.lastError.youtube = e.message;
        if ([401, 403, 404].includes(e.status) || ++c.errors >= 5) {
          this.stopChat('youtube');
          return;
        }
        c.status = 'Retrying';
        this.emit();
        c.timer = setTimeout(poll, e.status === 429 ? 60000 : Math.min(60000, 5000 * 2 ** c.errors));
        c.timer.unref?.();
      }
    };
    poll();
    this.emit();
  }
  async send(p, text) {
    provider(p);
    const c = this.chats[p];
    if (!c || c.status !== 'Connected') throw new PlatformError('Start this platform chat before sending.');
    text = str(text, p === 'twitch' ? 500 : 200).trim();
    if (!text) throw new PlatformError('Enter a message.');
    if (p === 'twitch') {
      const a = this.account(p),
        r = await this.api(p, 'chat/messages', {
          method: 'POST',
          body: { broadcaster_id: a.id, sender_id: a.id, message: text }
        });
      if (!r.data?.[0]?.is_sent)
        throw new PlatformError('Twitch did not send this message. Check chat restrictions.');
    } else
      await this.api(p, 'liveChat/messages?part=snippet', {
        method: 'POST',
        body: {
          snippet: {
            liveChatId: c.chatId,
            type: 'textMessageEvent',
            textMessageDetails: { messageText: text }
          }
        }
      });
    return { sent: true };
  }
  async moderate(key, action) {
    if (!['delete', 'timeout', 'ban'].includes(action)) throw new PlatformError('Unknown moderation action.');
    const m = this.messages.find(x => x.key === key);
    if (!m || !m.authorId) throw new PlatformError('This message is no longer available.');
    const p = m.platform,
      a = this.account(p);
    if (m.authorId === a.id && action !== 'delete')
      throw new PlatformError('You cannot ban your own account.');
    if (p === 'twitch') {
      if (m.channel !== a.id) throw new PlatformError('Message is not from your linked channel.');
      const q = qs({ broadcaster_id: a.id, moderator_id: a.id });
      if (action === 'delete')
        await this.api(p, 'moderation/chat?' + q + '&' + qs({ message_id: m.id }), { method: 'DELETE' });
      else
        await this.api(p, 'moderation/banned?' + q, {
          method: 'POST',
          body: {
            data: {
              user_id: m.authorId,
              ...(action === 'timeout' ? { duration: 600 } : {}),
              reason: 'Moderated in UniversalCollab'
            }
          }
        });
    } else {
      const c = this.chats.youtube;
      if (!c || c.chatId !== m.channel)
        throw new PlatformError('Select and start the original YouTube chat before moderating.');
      if (action === 'delete')
        await this.api(p, 'liveChat/messages?' + qs({ id: m.id }), { method: 'DELETE' });
      else
        await this.api(p, 'liveChat/bans?part=snippet', {
          method: 'POST',
          body: {
            snippet: {
              liveChatId: m.channel,
              type: action === 'timeout' ? 'temporary' : 'permanent',
              ...(action === 'timeout' ? { banDurationSeconds: 600 } : {}),
              bannedUserDetails: { channelId: m.authorId }
            }
          }
        });
    }
    this.removeMessages(p, x =>
      action === 'delete' ? x.key === key : x.authorId === m.authorId && x.channel === m.channel
    );
    return { done: true };
  }
  handle(op, input = {}) {
    if (op === 'state' || op === 'cancel') return this.dispatch(op, input);
    const next = this.mutations.then(() => this.dispatch(op, input));
    this.mutations = next.catch(() => {});
    return next;
  }
  async dispatch(op, input = {}) {
    switch (op) {
      case 'state':
        return this.snapshot();
      case 'configure':
        return this.configure(input.platform, input);
      case 'connect':
        return this.connect(input.platform);
      case 'cancel':
        this.cancelAuth(provider(input.platform));
        return this.snapshot();
      case 'disconnect':
        return this.disconnect(input.platform);
      case 'twitch-info':
        return this.twitchInfo();
      case 'categories':
        return this.categories(input.query);
      case 'twitch-save':
        return this.updateTwitch(input);
      case 'broadcasts':
        return this.broadcasts();
      case 'youtube-video-info': {
        const v = await this.youtubeInfo(input.id);
        return {
          id: v.id,
          title: v.snippet.title,
          description: v.snippet.description || '',
          categoryId: v.snippet.categoryId
        };
      }
      case 'youtube-categories':
        return (await this.api('youtube', 'videoCategories?part=snippet&regionCode=US')).items
          .filter(x => x.snippet.assignable)
          .map(x => ({ id: x.id, name: x.snippet.title }));
      case 'youtube-save':
        return this.updateYoutube(input);
      case 'chat-start':
        return this.startChat(input.platform, input);
      case 'chat-stop':
        return this.stopChat(input.platform);
      case 'send':
        return this.send(input.platform, input.text);
      case 'moderate':
        return this.moderate(input.key, input.action);
      case 'clear-local':
        this.messages = [];
        this.emit();
        return this.snapshot();
      default:
        throw new PlatformError('Unknown platform command.');
    }
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.validationTimer);
    for (const p of ['twitch', 'youtube']) {
      this.cancelAuth(p);
      this.stopChat(p);
    }
  }
}
module.exports = { PlatformService, PlatformError, TW_SCOPES, YT_SCOPE };
