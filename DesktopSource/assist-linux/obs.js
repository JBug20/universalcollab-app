'use strict';
const effects = location.pathname === '/effects',
  overlay = location.pathname === '/overlay' || effects,
  token = location.hash.slice(1).split('.')[0],
  feed = document.getElementById('messages'),
  statusNode = document.getElementById('status');
document.body.classList.toggle('overlay', overlay);
let paused = false,
  state = null,
  etag = '',
  styleKey = '';
const nodes = new Map();
document.getElementById('pause').onclick = () => {
  paused = !paused;
  document.getElementById('pause').textContent = paused ? 'Resume' : 'Pause';
  if (!paused) render();
};
function imageAllowed(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        'cdn.7tv.app',
        'static-cdn.jtvnw.net',
        'files.kick.com',
        'cdn.betterttv.net',
        'cdn.frankerfacez.com',
        'd3aqoihi2n8ty8.cloudfront.net'
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
function element(tag, text, cls) {
  const n = document.createElement(tag);
  n.textContent = text || '';
  if (cls) n.className = cls;
  return n;
}
const pulseNode = element('div', '', 'pulse-effect');
document.body.append(pulseNode);
let pulseId = '';
function renderPulse() {
  const p = state?.pulse;
  const live = p && p.until > Date.now();
  pulseNode.hidden = !effects || !live;
  if (effects) {
    feed.hidden = true;
    document.body.classList.add('transparent');
  }
  if (live && pulseId !== p.id) {
    pulseId = p.id;
    pulseNode.replaceChildren(
      element('div', '♥', 'pulse-heart'),
      element('strong', p.text),
      element('span', p.bpm + ' BPM')
    );
  }
}
function render() {
  renderPulse();
  if (!state || paused || effects) return;
  const p = state.style || {},
    key = JSON.stringify(p);
  if (key !== styleKey) {
    styleKey = key;
    const s = document.documentElement.style;
    s.setProperty('--font', p.font || 'Arial');
    s.setProperty('--size', (p.size || 20) + 'px');
    s.setProperty('--text', p.text || '#f7f0ff');
    s.setProperty('--name', p.name || '#c8a3ff');
    s.setProperty('--background', p.background || '#251937');
    s.setProperty('--emote', (p.emote || 30) + 'px');
    document.body.classList.toggle('transparent', !!p.transparent);
    document.body.classList.toggle('no-time', !p.timestamps);
    document.body.classList.toggle('no-platform', !p.platforms);
  }
  const visible = (state.messages || [])
    .filter(a => !overlay || !p.duration || Date.now() - a.received < p.duration * 1000)
    .slice(-(overlay ? p.limit || 30 : 200));
  const wanted = new Set(visible.map(a => a.id));
  for (const [id, n] of nodes)
    if (!wanted.has(id)) {
      n.remove();
      nodes.delete(id);
    }
  let changed = false;
  for (const a of visible) {
    if (nodes.has(a.id)) continue;
    changed = true;
    const row = element('article', '', 'message'),
      meta = element('span', '', 'meta');
    row.append(element('span', a.name, 'name'));
    meta.append(
      element('span', a.platform + ' ', 'platform'),
      element('span', new Date(a.received).toLocaleTimeString(), 'timestamp')
    );
    row.append(meta);
    const text = element('div', '', 'text');
    for (const run of a.runs || []) {
      if (run.url && imageAllowed(run.url)) {
        const img = document.createElement('img');
        img.className = 'emote';
        img.alt = run.text;
        img.src = run.url;
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.replaceWith(document.createTextNode(run.text));
        text.append(img);
      } else text.append(document.createTextNode(run.text || ''));
    }
    row.append(text);
    feed.append(row);
    nodes.set(a.id, row);
  }
  if (changed) feed.scrollTop = feed.scrollHeight;
}
async function poll() {
  try {
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Copy a fresh OBS link from the app.');
    const r = await fetch('/state', {
      headers: { Authorization: 'Bearer ' + token, ...(etag ? { 'If-None-Match': etag } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000)
    });
    if (r.status !== 304) {
      if (!r.ok) throw Error('Link expired. Copy the OBS link again from the app.');
      state = await r.json();
      etag = r.headers.get('ETag') || '';
    }
    statusNode.textContent = 'Connected';
    render();
  } catch (e) {
    statusNode.textContent = e.message || 'Open UniversalStream Assist to reconnect.';
    state = null;
    pulseNode.hidden = true;
    etag = '';
    feed.replaceChildren();
    nodes.clear();
  } finally {
    setTimeout(poll, 750);
  }
}
poll();
setInterval(() => {
  if (overlay) render();
}, 1000);

// Sending is enabled only by the separate "chat + send" dock link.
const sendKey = location.hash.slice(1).split('.')[1];
if (!overlay && /^[a-f0-9]{64}$/.test(sendKey || '')) {
  const form = element('div'),
    target = element('select'),
    message = element('input'),
    send = element('button', 'Send'),
    result = element('p');
  for (const [value, label] of [
    ['all', 'All platforms'],
    ['Twitch', 'Twitch'],
    ['YouTube', 'YouTube'],
    ['Kick', 'Kick']
  ]) {
    const option = element('option', label);
    option.value = value;
    target.append(option);
  }
  target.setAttribute('aria-label', 'Send to');
  message.setAttribute('aria-label', 'Chat message');
  message.placeholder = 'Message your connected channels';
  message.maxLength = 200;
  send.type = 'button';
  result.setAttribute('role', 'status');
  form.style.cssText =
    'padding:10px;display:flex;gap:8px;flex-wrap:wrap;font:14px Arial;background:#160f25;flex-shrink:0';
  message.style.cssText = 'flex:1;min-width:100px';
  form.append(target, message, send, result);
  document.body.append(form);
  let sending = false;
  const sendMessage = async () => {
    if (sending || !message.value.trim()) return;
    sending = true;
    send.disabled = true;
    target.disabled = true;
    result.textContent = 'Sending…';
    try {
      const response = await fetch('/chat-send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target.value, text: message.value }),
        signal: AbortSignal.timeout(50000)
      });
      if (!response.ok)
        throw Error('Sending unavailable. Copy the chat + send dock link again in OBS setup.');
      const body = await response.json();
      if (body.error) throw Error(body.error);
      result.textContent = (body.results || []).map(r => r.platform + ': ' + r.message).join(' · ');
      if (body.results?.length && body.results.every(r => r.sent)) message.value = '';
      else result.textContent += ' Select only failed destinations before retrying.';
    } catch (e) {
      result.textContent =
        e.name === 'TimeoutError' ? 'Delivery unknown. Check chat before retrying.' : e.message;
    } finally {
      sending = false;
      send.disabled = false;
      target.disabled = false;
    }
  };
  send.onclick = sendMessage;
  message.onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void sendMessage();
    }
  };
}
