'use strict';
const crypto = require('node:crypto');
const defaultRule = () => ({
  enabled: true,
  name: 'Heart rate high',
  direction: 'Above',
  threshold: 120,
  reset: 110,
  hold: 5,
  cooldown: 60,
  sound: true,
  animation: true,
  scene: '',
  soundFile: ''
});
function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 20) throw Error('Use up to 20 rules.');
  return rules.map(v => {
    const r = { ...defaultRule() };
    for (const k of ['enabled', 'sound', 'animation']) r[k] = !!v[k];
    for (const k of ['name', 'direction', 'scene', 'soundFile']) r[k] = String(v[k] ?? '');
    for (const k of ['threshold', 'reset', 'hold', 'cooldown']) r[k] = Number(v[k]);
    if (
      !r.name.trim() ||
      r.name.length > 100 ||
      !['Above', 'Below'].includes(r.direction) ||
      r.scene.length > 200
    )
      throw Error('Check rule name, direction and scene name.');
    if (
      ![r.threshold, r.reset, r.hold, r.cooldown].every(Number.isInteger) ||
      r.threshold < 30 ||
      r.threshold > 240 ||
      r.reset < 30 ||
      r.reset > 240 ||
      (r.direction === 'Above' ? r.reset >= r.threshold : r.reset <= r.threshold)
    )
      throw Error('Use 30–240 BPM. Reset is lower for Above and higher for Below.');
    if (r.hold < 0 || r.hold > 120 || r.cooldown < 5 || r.cooldown > 3600)
      throw Error('Hold: 0–120 seconds. Cooldown: 5–3600 seconds.');
    return r;
  });
}
class Engine {
  constructor() {
    this.states = new Map();
    this.reset();
  }
  reset() {
    for (const s of this.states.values()) {
      s.armed = false;
      s.since = null;
    }
    this.measured = -1;
    this.received = -1;
  }
  feed(rules, bpm, stamp, now) {
    const fired = [];
    if (
      !Number.isInteger(bpm) ||
      bpm < 30 ||
      bpm > 240 ||
      !Number.isFinite(stamp) ||
      stamp <= this.measured ||
      now - stamp > 30000 ||
      stamp - now > 10000
    )
      return fired;
    if (this.received >= 0 && now - this.received > 15000) this.reset();
    this.measured = stamp;
    this.received = now;
    for (const r of rules) {
      if (!r.enabled) continue;
      let s = this.states.get(r);
      if (!s) {
        s = { armed: false, since: null, last: -3600000 };
        this.states.set(r, s);
      }
      const safe = r.direction === 'Above' ? bpm <= r.reset : bpm >= r.reset,
        hit = r.direction === 'Above' ? bpm >= r.threshold : bpm <= r.threshold;
      if (safe) {
        s.armed = true;
        s.since = null;
      }
      if (!hit) {
        s.since = null;
        continue;
      }
      if (!s.armed) continue;
      s.since ??= now;
      if (now - s.since >= r.hold * 1000 && now - s.last >= r.cooldown * 1000) {
        s.last = now;
        s.since = null;
        s.armed = false;
        fired.push(r);
      }
    }
    return fired;
  }
}
function auth(password, salt, challenge) {
  const hash = s => crypto.createHash('sha256').update(s).digest('base64');
  return hash(hash(password + salt) + challenge);
}
async function scene(port, password, name, signal) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid OBS port');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    let done = false,
      identified = false;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(Error('OBS timed out')), 8000);
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      ws.close();
      error ? reject(error) : resolve();
    }
    const abort = () => finish(Error('Stopped'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    ws.onclose = () => finish(Error('OBS disconnected. Check WebSocket/password.'));
    ws.onerror = () => finish(Error('Could not connect to OBS WebSocket.'));
    ws.onmessage = e => {
      try {
        if (typeof e.data !== 'string' || e.data.length > 65536) throw Error('Invalid OBS message');
        const m = JSON.parse(e.data);
        if (m.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (m.d.authentication)
            d.authentication = auth(password, m.d.authentication.salt, m.d.authentication.challenge);
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2 && !identified) {
          identified = true;
          ws.send(
            JSON.stringify({
              op: 6,
              d: {
                requestType: name === null ? 'GetSceneList' : 'SetCurrentProgramScene',
                requestId: id,
                requestData: name === null ? {} : { sceneName: name }
              }
            })
          );
        } else if (m.op === 7 && m.d.requestId === id)
          finish(m.d.requestStatus?.result ? null : Error('OBS rejected the scene. Check its exact name.'));
      } catch {
        finish(Error('Invalid OBS response'));
      }
    };
  });
}
class Pulsoid {
  constructor(status, reading) {
    this.status = status;
    this.reading = reading;
    this.generation = 0;
  }
  stop() {
    this.generation++;
    clearTimeout(this.retry);
    clearInterval(this.watch);
    this.ws?.close();
    this.ws = null;
    this.status('Stopped');
  }
  start(token) {
    this.stop();
    const generation = this.generation;
    let failures = 0;
    const connect = () => {
      if (generation !== this.generation) return;
      this.status('Connecting to Pulsoid…');
      let last = Date.now(),
        opened = false;
      const ws = (this.ws = new WebSocket(
        'wss://dev.pulsoid.net/api/v1/data/real_time?access_token=' + encodeURIComponent(token)
      ));
      this.watch = setInterval(() => {
        if (Date.now() - last > 20000) {
          this.status('No fresh readings · Reconnecting');
          ws.close();
        }
      }, 1000);
      ws.onopen = () => {
        opened = true;
        failures = 0;
        last = Date.now();
        this.status('Connected · Waiting for fresh readings');
      };
      ws.onmessage = e => {
        if (generation !== this.generation) return;
        try {
          if (typeof e.data !== 'string' || e.data.length > 65536) return;
          const d = JSON.parse(e.data),
            bpm = d.data?.heart_rate,
            stamp = d.measured_at,
            now = Date.now();
          if (
            !Number.isInteger(bpm) ||
            bpm < 30 ||
            bpm > 240 ||
            !Number.isFinite(stamp) ||
            now - stamp > 30000 ||
            stamp - now > 10000
          )
            return;
          last = now;
          this.reading(bpm, stamp, now);
        } catch {}
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (generation !== this.generation) return;
        clearInterval(this.watch);
        this.status('Pulsoid unavailable · Check token/monitor. Retrying…');
        this.retry = setTimeout(connect, Math.min(60000, 2000 * 2 ** Math.min(failures++, 5)));
      };
    };
    connect();
  }
}
module.exports = { Engine, Pulsoid, scene, auth, defaultRule, validateRules };
