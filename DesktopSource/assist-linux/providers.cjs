'use strict';

const {
  ORIGIN,
  TWITCH,
  SCOPES,
  REQUIRED_SCOPES,
  random,
  challenge,
  sleep,
  request,
  kick,
  twitch,
  youtube,
  safeBrowser
} = require('./core.cjs');
// Same Google Desktop client as the Windows public beta, so YouTube works without importing a JSON file.
// An imported client (Connections > advanced) still takes priority.
const builtInGoogle = (() => {
  try {
    const c = JSON.parse(
      require('node:fs').readFileSync(require('node:path').join(__dirname, 'release-google.json'), 'utf8')
    );
    return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(c.client_id || '') &&
      typeof c.client_secret === 'string' &&
      c.client_secret
      ? { client_id: c.client_id, client_secret: c.client_secret }
      : null;
  } catch {
    return null;
  }
})();

class Providers {
  constructor({ emit, status, open, load, save, device, catalog, remember = () => true }) {
    Object.assign(this, { emit, status, open, load, save, device, catalog, remember });
    this.identities = {};
    this.jobs = new Map();
    this.session = '';
    this.seen = new Set();
  }

  // One renewal at a time per platform, shared by chat listeners and chat sending: Twitch
  // refresh tokens are single-use, so concurrent renewals could sign the streamer out.
  async token(name, { force = false, previous } = {}, signal) {
    this.renewing ??= {};
    while (this.renewing[name]) await this.renewing[name].catch(() => {});
    const t = this.load(name);
    if (!t) throw Error((name === 'twitch' ? 'Twitch' : 'YouTube') + ': connect first.');
    if (t.expires > Date.now() + 120000 && (!force || t.access !== previous)) return t;
    const job = (async () => {
      const c = name === 'youtube' ? this.load('google-client') || builtInGoogle : null;
      if (name === 'youtube' && !c) throw Error('YouTube sign-in is not configured.');
      const d = await request(
        name === 'twitch' ? 'https://id.twitch.tv/oauth2/token' : 'https://oauth2.googleapis.com/token',
        {
          form:
            name === 'twitch'
              ? { client_id: TWITCH, grant_type: 'refresh_token', refresh_token: t.refresh }
              : {
                  client_id: c.client_id,
                  client_secret: c.client_secret,
                  refresh_token: t.refresh,
                  grant_type: 'refresh_token'
                },
          signal
        }
      );
      if (typeof d.access_token !== 'string') throw Error('Sign-in renewal was incomplete. Reconnect.');
      const next = {
        access: d.access_token,
        refresh: d.refresh_token || t.refresh,
        expires: Date.now() + (Number(d.expires_in) || 3600) * 1000
      };
      this.save(name, next);
      return next;
    })();
    this.renewing[name] = job;
    try {
      return await job;
    } finally {
      if (this.renewing[name] === job) delete this.renewing[name];
    }
  }

  // Send to one or all platforms. Never retried automatically, so a message is never posted twice.
  async sendChat(target, text) {
    text = String(text || '').trim();
    if (!text || [...text].length > 200 || !['all', 'Twitch', 'YouTube', 'Kick'].includes(target))
      throw Error('Choose a destination and enter 1–200 characters.');
    const results = [];
    for (const platform of target === 'all' ? ['Twitch', 'YouTube', 'Kick'] : [target]) {
      try {
        if (platform === 'Twitch') {
          let t = await this.token('twitch');
          const user = await request('https://id.twitch.tv/oauth2/validate', {
            headers: { authorization: 'OAuth ' + t.access }
          });
          if (!user.scopes?.includes('user:write:chat')) throw Object.assign(Error('scope'), { status: 401 });
          const r = await request('https://api.twitch.tv/helix/chat/messages', {
            token: t.access,
            headers: { 'client-id': TWITCH },
            json: { broadcaster_id: user.user_id, sender_id: user.user_id, message: text }
          });
          const first = r.data?.[0];
          if (!first?.is_sent)
            throw Error(
              'Twitch did not accept the message' +
                (first?.drop_reason?.message ? ': ' + first.drop_reason.message : '.')
            );
        } else if (platform === 'YouTube') {
          const t = await this.token('youtube');
          const live = await request(
            'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&maxResults=50',
            { token: t.access }
          );
          const chats = [...new Set((live.items || []).map(x => x.snippet?.liveChatId).filter(Boolean))];
          if (chats.length !== 1)
            throw Error(
              chats.length
                ? 'Several live broadcasts are active. Send from YouTube to choose the right chat.'
                : 'No active live chat.'
            );
          await request('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
            token: t.access,
            json: {
              snippet: {
                liveChatId: chats[0],
                type: 'textMessageEvent',
                textMessageDetails: { messageText: text }
              }
            }
          });
        } else {
          if (!this.session) throw Error('Sign in first.');
          await this.backend('/v1/chat/send', { json: { text } });
        }
        results.push({ platform, sent: true, message: 'Sent' });
      } catch (e) {
        results.push({ platform, sent: false, message: explainSend(platform, e) });
      }
    }
    return results;
  }

  async backend(path, options = {}) {
    return request(ORIGIN + path, { ...options, token: this.session });
  }

  stop(name) {
    this.jobs.get(name)?.abort();
    this.jobs.delete(name);
    this.status(name, 'Disconnected');
  }

  stopAll() {
    this.identities = {};
    for (const name of [...this.jobs.keys()]) this.stop(name);
    this.session = '';
  }

  run(name, fn) {
    if (this.jobs.has(name)) return;
    const c = new AbortController();
    this.jobs.set(name, c);
    this.status(name, 'Connecting…');
    Promise.resolve()
      .then(() => fn(c.signal))
      .catch(e => {
        if (!c.signal.aborted)
          this.status(
            name,
            e.status === 401
              ? 'Sign-in expired. Reconnect.'
              : e.code === 'quotaExceeded'
                ? 'API quota reached. Try after quota resets.'
                : e.message
          );
      })
      .finally(() => {
        if (this.jobs.get(name) === c) this.jobs.delete(name);
      });
  }

  async login(signal) {
    const verifier = random();
    const d = await this.backend('/v1/device/start', {
      json: { challenge: challenge(verifier), application: 'assist' },
      signal
    });
    const url = new URL(d.verification_uri);
    if (url.origin !== ORIGIN || url.pathname !== '/activate')
      throw Error('Invalid account approval address.');
    this.device('Account', d.device_code);
    await this.open(url.href);
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      await sleep(5000, signal);
      try {
        const r = await this.backend('/v1/device/token', {
          json: { device_code: d.device_code, verifier },
          signal
        });
        if (signal.aborted) return;
        this.session = r.access_token;
        const me = await this.backend('/v1/me', { signal });
        if (signal.aborted) return;
        this.identities.Account = 'Account ID: ' + me.account_id;
        await this.saveSession(signal);
        this.device('Account', '');
        this.status('Account', 'Signed in');
        this.run('Renewal', s => this.renew(s));
        return;
      } catch (e) {
        if (e.status !== 428) throw e;
      }
    }
    throw Error('Account sign-in timed out. Try again.');
  }

  async saveSession(signal) {
    if (!this.remember()) return;
    let r;
    try {
      r = await this.backend('/v1/session/remember', { json: {}, signal });
    } catch (e) {
      if (e.status !== 404) throw e;
      r = await this.backend('/v1/session/renew', { json: {}, signal });
    }
    if (signal.aborted) return;
    this.save('beta-session', { token: this.session, expires: r.expires_at });
  }
  async restore(signal) {
    const saved = this.load('beta-session');
    if (!saved?.token || !this.remember()) return;
    try {
      const me = await request(ORIGIN + '/v1/me', { token: saved.token, signal });
      if (signal.aborted) return;
      this.session = saved.token;
      await this.saveSession(signal);
      if (signal.aborted) return;
      this.identities.Account = 'Account ID: ' + me.account_id;
      this.status('Account', 'Signed in · Remembered device');
      this.run('Renewal', s => this.renew(s));
    } catch (e) {
      this.session = '';
      if (e.status === 401 || e.status === 403) this.save('beta-session', null);
      throw e;
    }
  }
  async renew(signal) {
    while (!signal.aborted) {
      let delay = 60000;
      try {
        await this.backend('/v1/session/renew', { json: {}, signal });
        delay = 900000;
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          this.status('Account', 'Session expired. Sign out and reconnect.');
          throw e;
        }
      }
      await sleep(delay, signal);
    }
  }

  requireAccount() {
    if (!this.session) throw Error('Sign in with your UniversalCollab account first.');
  }

  connect(name) {
    this.requireAccount();
    this.run(name, s => this[name.toLowerCase()](s));
  }

  async kick(signal) {
    let me = await this.backend('/v1/me', { signal });
    if (!me.kick?.connected || !me.kick?.chat_ready) {
      const d = await this.backend('/v1/kick/connect', { json: {}, signal });
      await this.open(safeBrowser(d.url, 'id.kick.com'));
    }
    let cursor = (await this.backend('/v1/events?after=latest', { signal })).cursor;
    while (!signal.aborted) {
      try {
        const r = await this.backend('/v1/events?after=' + encodeURIComponent(cursor), { signal });
        for (const e of r.events || []) {
          const a = kick(e);
          if (a) this.emit(a);
        }
        cursor = r.cursor;
        me = await this.backend('/v1/me', { signal });
        if (signal.aborted) return;
        this.identities.Kick = me.kick?.connected ? me.kick.name : '';
        this.status(
          'Kick',
          me.kick?.connected ? 'Listening · ' + me.kick.name : 'Waiting for browser approval'
        );
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        this.status('Kick', 'Reconnecting…');
      }
      await sleep(5000, signal);
    }
  }

  async twitch(signal) {
    if (!TWITCH)
      throw Error(
        'Twitch is not configured in this build. Add the Twitch client ID to release-oauth.json for local builds.'
      );
    let t = this.load('twitch');
    const store = d => {
      if (signal.aborted) throw Error('Cancelled');
      t = {
        access: d.access_token,
        refresh: d.refresh_token || t?.refresh,
        expires: Date.now() + d.expires_in * 1000
      };
      this.save('twitch', t);
    };
    if (!t) {
      const d = await request('https://id.twitch.tv/oauth2/device', {
        form: { client_id: TWITCH, scopes: SCOPES },
        signal
      });
      this.device('Twitch', d.user_code);
      await this.open(safeBrowser(d.verification_uri, 'www.twitch.tv'));
      let interval = Math.max(5, d.interval || 5);
      const end = Date.now() + d.expires_in * 1000;
      while (Date.now() < end) {
        await sleep(interval * 1000, signal);
        try {
          store(
            await request('https://id.twitch.tv/oauth2/token', {
              form: {
                client_id: TWITCH,
                device_code: d.device_code,
                scopes: SCOPES,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
              },
              signal
            })
          );
          break;
        } catch (e) {
          if (String(e.code).includes('authorization_pending')) continue;
          if (String(e.code).includes('slow_down')) {
            interval += 5;
            continue;
          }
          throw e;
        }
      }
      if (!t) throw Error('Twitch sign-in timed out.');
      this.device('Twitch', '');
    }

    while (!signal.aborted) {
      try {
        if (t.expires < Date.now() + 120000)
          t = await this.token('twitch', { force: true, previous: t.access }, signal);
        const user = await request('https://id.twitch.tv/oauth2/validate', {
          headers: { authorization: 'OAuth ' + t.access },
          signal
        });
        if (
          user.client_id !== TWITCH ||
          !user.user_id ||
          REQUIRED_SCOPES.split(' ').some(s => !user.scopes.includes(s))
        )
          throw Error('Twitch permissions missing. Forget Twitch and reconnect.');
        if (this.catalog) await this.catalog(user.user_id, t.access, signal);
        if (signal.aborted) return;
        this.identities.Twitch = user.login;
        await this.twitchSocket(t, user, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        if (e.status === 401) {
          t.expires = 0;
        } else if (e.status === 400 || e.status === 403 || /permissions|revoked/.test(e.message)) throw e;
        this.status('Twitch', 'Reconnecting…');
        await sleep(5000, signal);
      }
    }
  }

  async twitchSocket(t, user, signal) {
    return new Promise((resolve, reject) => {
      let ws, watch, refresh;
      let done = false;
      const sockets = new Set();
      const finish = e => {
        if (done) return;
        done = true;
        clearTimeout(watch);
        clearTimeout(refresh);
        signal.removeEventListener('abort', abort);
        for (const sock of sockets) sock.close();
        e ? reject(e) : resolve();
      };
      const abort = () => finish(Error('Cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      refresh = setTimeout(() => finish(), 45 * 60000);
      const attach = (url, transfer) => {
        const sock = new WebSocket(url);
        sockets.add(sock);
        let welcome = false;
        const welcomeTimer = setTimeout(() => finish(Error('Twitch timed out')), 15000);
        sock.onmessage = async event => {
          try {
            const m = JSON.parse(String(event.data));
            const type = m.metadata?.message_type;
            if (type === 'session_welcome') {
              clearTimeout(welcomeTimer);
              welcome = true;
              const old = ws;
              ws = sock;
              if (transfer && old) {
                old.close();
                sockets.delete(old);
              }
              const reset = () => {
                clearTimeout(watch);
                watch = setTimeout(
                  () => finish(Error('Twitch keepalive expired')),
                  (m.payload.session.keepalive_timeout_seconds || 10) * 1000 + 10000
                );
              };
              sock.resetWatch = reset;
              reset();
              if (!transfer) {
                let unavailable = [];
                for (const name of [
                  'channel.follow',
                  'channel.subscribe',
                  'channel.subscription.gift',
                  'channel.subscription.message',
                  'channel.cheer',
                  'channel.raid',
                  'channel.chat.message'
                ]) {
                  const condition =
                    name === 'channel.chat.message'
                      ? { broadcaster_user_id: user.user_id, user_id: user.user_id }
                      : name === 'channel.raid'
                        ? { to_broadcaster_user_id: user.user_id }
                        : name === 'channel.follow'
                          ? { broadcaster_user_id: user.user_id, moderator_user_id: user.user_id }
                          : { broadcaster_user_id: user.user_id };
                  try {
                    await request('https://api.twitch.tv/helix/eventsub/subscriptions', {
                      signal,
                      token: t.access,
                      headers: { 'Client-Id': TWITCH },
                      json: {
                        type: name,
                        version: name === 'channel.follow' ? '2' : '1',
                        condition,
                        transport: { method: 'websocket', session_id: m.payload.session.id }
                      }
                    });
                  } catch (e) {
                    if (e.status === 403) unavailable.push(name);
                    else throw e;
                  }
                }
                this.status(
                  'Twitch',
                  unavailable.length
                    ? 'Listening; unavailable: ' + unavailable.join(', ')
                    : 'Listening · ' + user.login
                );
              }
              return;
            }
            if (!welcome) return;
            sock.resetWatch?.();
            if (type === 'session_reconnect') {
              const u = new URL(m.payload.session.reconnect_url);
              if (u.protocol !== 'wss:' || u.hostname !== 'eventsub.wss.twitch.tv')
                throw Error('Invalid Twitch reconnect URL');
              attach(u.href, true);
            }
            if (type === 'revocation') throw Error('Twitch permission revoked. Forget Twitch and reconnect.');
            if (type === 'notification') {
              const id = m.metadata.message_id;
              if (this.seen.has(id)) return;
              this.seen.add(id);
              if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value);
              const a = twitch(m);
              if (a) this.emit(a);
            }
          } catch (e) {
            finish(e);
          }
        };
        sock.onerror = () => finish(Error('Twitch connection interrupted'));
        sock.onclose = () => {
          clearTimeout(welcomeTimer);
          if (sock === ws || !ws) finish(Error('Twitch disconnected'));
        };
      };
      attach('wss://eventsub.wss.twitch.tv/ws', false);
    });
  }

  async youtube(signal) {
    const c = this.load('google-client') || builtInGoogle;
    if (!c)
      throw Error(
        'YouTube sign-in is not configured in this build. Import Google Desktop credentials in Connections.'
      );
    let t = this.load('youtube');
    const store = d => {
      if (signal.aborted) throw Error('Cancelled');
      t = {
        access: d.access_token,
        refresh: d.refresh_token || t?.refresh,
        expires: Date.now() + d.expires_in * 1000
      };
      this.save('youtube', t);
    };
    if (!t) {
      const { code, redirect, verifier } = await this.googleLogin(c, signal);
      store(
        await request('https://oauth2.googleapis.com/token', {
          form: {
            client_id: c.client_id,
            client_secret: c.client_secret,
            code,
            redirect_uri: redirect,
            code_verifier: verifier,
            grant_type: 'authorization_code'
          },
          signal
        })
      );
    }
    if (t.expires < Date.now() + 120000)
      t = await this.token('youtube', { force: true, previous: t.access }, signal);
    const channel = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      token: t.access,
      signal
    });
    if (signal.aborted) return;
    this.identities.YouTube = channel.items?.length
      ? channel.items.map(x => x.snippet.title + ' · ' + x.id).join(', ')
      : 'No YouTube channel on this Google account';
    let chat = '',
      page = '',
      delay = 0;
    const since = Date.now(),
      seen = new Set();
    while (!signal.aborted) {
      await sleep(delay, signal);
      delay = 20000;
      try {
        if (t.expires < Date.now() + 120000)
          t = await this.token('youtube', { force: true, previous: t.access }, signal);
        if (!chat) {
          const r = await request(
            'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&maxResults=50',
            { signal, token: t.access }
          );
          chat = r.items?.find(x => x.snippet?.liveChatId)?.snippet.liveChatId;
          if (!chat) {
            this.status('YouTube', 'Connected · Waiting for a live broadcast');
            delay = 60000;
            continue;
          }
        }
        const r = await request(
          'https://www.googleapis.com/youtube/v3/liveChat/messages?part=id,snippet,authorDetails&maxResults=2000&liveChatId=' +
            encodeURIComponent(chat) +
            (page ? '&pageToken=' + encodeURIComponent(page) : ''),
          { signal, token: t.access }
        );
        for (const item of r.items || []) {
          if (seen.has(item.id) || Date.parse(item.snippet?.publishedAt) < since) continue;
          seen.add(item.id);
          if (seen.size > 10000) seen.delete(seen.values().next().value);
          const a = youtube(item);
          if (a) this.emit(a);
        }
        page = r.nextPageToken || '';
        delay = Math.max(20000, r.pollingIntervalMillis || 0);
        this.status('YouTube', 'Listening · Live chat');
        if (r.offlineAt) {
          chat = '';
          page = '';
        }
      } catch (e) {
        if (e.status === 401) {
          t.expires = 0;
          this.status('YouTube', 'Reconnecting…');
        } else if (
          ['liveChatEnded', 'liveChatNotFound', 'liveChatDisabled', 'pageTokenInvalid'].includes(e.code)
        ) {
          chat = '';
          page = '';
        } else if (e.status === 403 || e.status === 400) throw e;
        else this.status('YouTube', 'Connection interrupted · Retrying');
        delay = 60000;
      }
    }
  }

  async googleLogin(c, signal) {
    const http = require('node:http');
    const verifier = random(),
      state = random();
    return new Promise((resolve, reject) => {
      let timeout;
      const server = http.createServer(async (req, res) => {
        let url;
        try {
          url = new URL(req.url, 'http://127.0.0.1');
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (req.method !== 'GET' || url.pathname !== '/' || url.searchParams.get('state') !== state) {
          res.writeHead(400).end('Invalid sign-in request');
          return;
        }
        const code = url.searchParams.get('code');
        res
          .writeHead(code ? 200 : 400, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store'
          })
          .end(
            code
              ? 'YouTube authorization received. Return to UniversalStream Assist. The app will confirm when your connection is ready.'
              : 'YouTube sign-in was declined. Return to UniversalStream Assist to try again.'
          );
        finish(code ? null : Error('Google sign-in declined'), code);
      });
      const abort = () => finish(Error('Google sign-in cancelled'));
      const finish = (e, code) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        const address = server.address();
        server.close();
        e ? reject(e) : resolve({ code, redirect: 'http://127.0.0.1:' + address.port + '/', verifier });
      };
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const redirect = 'http://127.0.0.1:' + server.address().port + '/';
        const q = new URLSearchParams({
          client_id: c.client_id,
          redirect_uri: redirect,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
          access_type: 'offline',
          prompt: 'select_account consent',
          state,
          code_challenge: challenge(verifier),
          code_challenge_method: 'S256'
        });
        this.open('https://accounts.google.com/o/oauth2/v2/auth?' + q).catch(e => finish(e));
      });
      signal.addEventListener('abort', abort, { once: true });
      timeout = setTimeout(() => finish(Error('Google sign-in timed out')), 300000);
    });
  }

  async streamlabs(signal) {
    const token = this.load('streamlabs');
    if (!token) throw Error('Set your Streamlabs Socket API token first.');
    while (!signal.aborted) {
      try {
        await new Promise((resolve, reject) => {
          const ws = new WebSocket(
            'wss://sockets.streamlabs.com/socket.io/?EIO=3&transport=websocket&token=' +
              encodeURIComponent(token)
          );
          let heartbeat, pong;
          const abort = () => ws.close();
          signal.addEventListener('abort', abort, { once: true });
          ws.onmessage = e => {
            try {
              const s = String(e.data);
              if (s.startsWith('0')) {
                const h = JSON.parse(s.slice(1));
                heartbeat = setInterval(
                  () => {
                    if (ws.readyState === 1) {
                      ws.send('2');
                      clearTimeout(pong);
                      pong = setTimeout(() => ws.close(), h.pingTimeout || 20000);
                    }
                  },
                  Math.max(1000, h.pingInterval || 25000)
                );
              } else if (s === '3') clearTimeout(pong);
              else if (s === '2') ws.send('3');
              else if (s.startsWith('42')) {
                const [name, data] = JSON.parse(s.slice(2));
                if (name === 'event' && data.type === 'donation')
                  for (const tip of data.message || [])
                    this.emit(
                      require('./core.cjs').make(
                        'Streamlabs',
                        'Tip',
                        tip.name,
                        [tip.formatted_amount || tip.amount, tip.message].join(' ')
                      )
                    );
              }
              this.status('Streamlabs', 'Listening for tips');
            } catch {}
          };
          ws.onerror = () => ws.close();
          ws.onclose = () => {
            clearInterval(heartbeat);
            clearTimeout(pong);
            signal.removeEventListener('abort', abort);
            resolve();
          };
        });
      } finally {
        if (!signal.aborted) {
          this.status('Streamlabs', 'Reconnecting…');
          await sleep(5000, signal);
        }
      }
    }
  }
}

function explainSend(platform, e) {
  const code = String(e.code || ''),
    status = e.status;
  if (platform === 'Kick') {
    if (code.includes('reconnect_kick_to_send'))
      return 'Sending permission is missing. Sign out of Kick, connect again and approve chat sending.';
    if (code.includes('connect_kick_first')) return 'Connect Kick first.';
    if (code.includes('kick_send_not_enabled') || status === 404)
      return 'Kick sending is not enabled on the beta service yet.';
    if (code.includes('send_rate_limited')) return 'Too many messages. Wait a minute.';
    if (code.includes('kick_rejected_message')) return 'Kick rejected this message.';
  }
  if (platform === 'Twitch' && status === 401)
    return 'Sending permission is missing or expired. Forget Twitch and connect again to approve chat sending.';
  if (platform === 'Twitch' && status === 403)
    return 'Twitch does not allow this account to send in this chat right now.';
  if (platform === 'YouTube' && (code === 'insufficientPermissions' || code.includes('SCOPE')))
    return 'Sending permission is missing. Forget YouTube and connect again to approve chat sending.';
  if (platform === 'YouTube' && status === 401) return 'YouTube sign-in was not accepted. Reconnect YouTube.';
  if (platform === 'YouTube' && code === 'liveChatEnded') return 'This live chat has ended.';
  if (status) return 'Rejected (HTTP ' + status + '). Not retried.';
  if (e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError)
    return 'Delivery unknown. Check chat before trying again.';
  return e.message;
}
Providers.builtInGoogle = builtInGoogle;
module.exports = { Providers };
