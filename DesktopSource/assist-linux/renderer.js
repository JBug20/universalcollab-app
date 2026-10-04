'use strict';

const $ = id => document.getElementById(id);
let state;
const detached = new URLSearchParams(location.search).has('pop');
if (detached) document.body.classList.add('pop');
$('dock').hidden = !detached;
$('showmain').hidden = !detached;
$('pop').hidden = detached;

const kinds = [
  'Follow',
  'Subscription',
  'Resubscription',
  'GiftSubscription',
  'Cheer',
  'Raid',
  'SuperChat',
  'SuperSticker',
  'NewSponsor',
  'MemberMileStone',
  'MembershipGift',
  'KicksGifted',
  'Tip'
];
for (const k of kinds) {
  const o = document.createElement('option');
  o.textContent = k;
  $('kind').append(o);
}

async function action(n, d) {
  try {
    return await window.assist.action(n, d);
  } catch (e) {
    $('message').textContent = e.message.replace(/^Error invoking remote method 'action': Error: /, '');
  }
}

function el(tag, value, cls) {
  const e = document.createElement(tag);
  e.textContent = value;
  if (cls) e.className = cls;
  return e;
}
function button(label, fn) {
  const b = el('button', label);
  b.onclick = fn;
  return b;
}

function emoteText(e, catalog) {
  const value = e.textContent;
  e.replaceChildren();
  for (const part of value.split(/(\s+)/)) {
    const url = catalog?.[part];
    if (
      url &&
      /^https:\/\/(cdn\.7tv\.app|static-cdn\.jtvnw\.net|files\.kick\.com|cdn\.betterttv\.net|cdn\.frankerfacez\.com)\//.test(
        url
      )
    ) {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'emote';
      img.alt = part;
      img.onerror = () => img.replaceWith(document.createTextNode(part));
      e.append(img);
    } else e.append(document.createTextNode(part));
  }
}

let cardsKey = '';
let feedKey = '';
function render(s) {
  state = s;
  $('connection-notice').textContent = s.connectionNotice || '';
  $('connection-notice').hidden = !s.connectionNotice;
  $('remember').checked = !!s.prefs.remember;
  $('controls-status').textContent = s.controls ? 'Local controls enabled' : 'Local controls stopped';
  renderCollab();
  renderTools();
  renderPulseSettings();
  applyChatStyle();
  renderChat();
  document.body.classList.toggle('compact', s.prefs.compact);
  $('message').textContent = s.warning || '';
  $('device').textContent = Object.entries(s.codes)
    .filter(([, v]) => v)
    .map(([k, v]) => k + ' approval code / request identifier:\n' + v)
    .join('\n');
  $('account-identity').textContent = s.identities?.Account || 'UniversalCollab · Signed out';
  $('login').hidden = s.signedIn;
  $('signout').hidden = !s.signedIn;
  for (const k of ['sound', 'popup', 'compact', 'top', 'updates']) $(k).checked = !!s.prefs[k];
  $('pintop').checked = detached ? !!s.prefs.popTop : !!s.prefs.top;
  $('retention').value = s.prefs.retention;
  $('filter').value = s.prefs.filter;
  if (document.activeElement !== $('search')) $('search').value = s.prefs.search;

  const items = s.alerts.filter(
    a =>
      (s.prefs.filter === 'All' || a.platform === s.prefs.filter) &&
      (a.name + ' ' + a.kind + ' ' + a.detail).toLowerCase().includes(s.prefs.search.toLowerCase())
  );
  const key = JSON.stringify([items.map(a => a.id), s.emotes, s.prefs.compact]);
  if (key !== feedKey) {
    feedKey = key;
    const feed = $('feed');
    feed.replaceChildren();
    if (!items.length)
      feed.append(
        el('div', 'Your next great moment starts here. Connect a platform or try sample alerts.', 'empty')
      );
    for (const a of items) {
      const row = el('div', '', 'alert');
      row.append(
        el('span', new Date(a.time).toLocaleTimeString(), 'time'),
        el('span', a.platform, 'platform'),
        el('span', a.kind, 'kind'),
        el('strong', a.name)
      );
      const msg = el('span', (a.demo ? 'Sample · ' : '') + a.detail, 'detail');
      emoteText(msg, s.emotes);
      row.append(
        msg,
        button('Replay', () => action('replay', a.id))
      );
      row.title = a.platform + ' · ' + a.kind + ' · ' + a.time;
      feed.append(row);
    }
  }
  $('count').textContent =
    items.length + ' alerts · Newest first' + (s.paused > Date.now() ? ' · Sounds paused' : '');

  const nextCardsKey = JSON.stringify([s.status, s.last, s.identities]);
  if (nextCardsKey !== cardsKey) {
    cardsKey = nextCardsKey;
    $('cards').replaceChildren();
    $('health-list').replaceChildren();
    for (const name of ['Twitch', 'YouTube', 'Kick', 'Streamlabs']) {
      const card = el('div', '', 'card');
      card.append(
        el('h2', name),
        el(
          'p',
          s.identities?.[name] ||
            (name === 'Streamlabs'
              ? 'Socket token connection · Account name unavailable'
              : 'No account identified')
        ),
        el('p', s.status[name]),
        button('Connect', () => action('connect', name)),
        button('Pause connection', () => action('disconnect', name))
      );
      card.append(button('Sign out', () => action('forget', name)));
      $('cards').append(card);
      $('health-list').append(
        el('h3', name),
        el('p', s.status[name]),
        el('p', 'Last event: ' + (s.last[name] ? new Date(s.last[name]).toLocaleString() : 'None yet'))
      );
    }
  }
  loadRule();
}

function loadRule() {
  if (!state) return;
  const r = state.prefs.rules[$('kind').value] || { sound: true, popup: true, volume: 80, file: '' };
  $('event-sound').checked = r.sound;
  $('event-popup').checked = r.popup;
  $('volume').value = r.volume;
  $('volume-value').textContent = r.volume + '%';
  $('sound-file').textContent = r.file ? 'Sound: ' + r.file.split(/[\\/]/).pop() : 'Default chime';
}

for (const b of document.querySelectorAll('[data-view]'))
  b.onclick = () => {
    for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== b.dataset.view;
  };
for (const [id, n] of Object.entries({
  login: 'login',
  signout: 'signout',
  samples: 'samples',
  pop: 'pop',
  dock: 'dock',
  showmain: 'main',
  minimise: 'minimise',
  google: 'google',
  'google-default': 'googleDefault',
  export: 'export',
  clear: 'clear'
}))
  $(id).onclick = () => action(n);
for (const k of ['sound', 'popup', 'compact', 'top', 'updates'])
  $(k).onchange = () => action('settings', { [k]: $(k).checked });
$('pintop').onchange = () => action('settings', { [detached ? 'popTop' : 'top']: $('pintop').checked });
$('retention').onchange = () => action('settings', { retention: Number($('retention').value) });
$('filter').onchange = () => action('settings', { filter: $('filter').value });
$('search').oninput = () => action('settings', { search: $('search').value });
$('pause').onclick = () => action('pause', true);
$('resume').onclick = () => action('pause', false);
$('kind').onchange = loadRule;
for (const k of ['event-sound', 'event-popup', 'volume'])
  $(k).onchange = () =>
    action('rule', {
      kind: $('kind').value,
      sound: $('event-sound').checked,
      popup: $('event-popup').checked,
      volume: Number($('volume').value)
    });
$('choose-sound').onclick = () => action('sound', $('kind').value);
$('default-sound').onclick = () => action('defaultSound', $('kind').value);
$('check-updates').onclick = async () => {
  $('message').textContent = (await action('updates')) || 'Could not check updates.';
};
$('token-save').onclick = async () => {
  await action('streamlabs', $('token').value);
  $('token').value = '';
};
let audio;
window.assist.sound(s => {
  audio?.pause();
  audio = new Audio(s.data);
  audio.volume = s.volume;
  audio.play().catch(() => {
    $('message').textContent = 'Audio could not play. Check your sound output.';
  });
});
window.assist.state(render);
action('state').then(s => {
  if (s) render(s);
});

let chatIds = '',
  chatQuery = '';

function renderChat() {
  if (!state || $('chat-pause').checked) return;
  const query = $('chat-search').value.toLowerCase();
  const items = (state.chats || []).filter(a => (a.name + ' ' + a.detail).toLowerCase().includes(query));
  const ids = items.map(a => a.id).join(',');
  if (ids === chatIds && query === chatQuery) return;
  chatIds = ids;
  chatQuery = query;
  const feed = $('chat-feed');
  const existing = new Map([...feed.children].map(n => [n.dataset.id, n]));
  const wanted = new Set(items.map(a => a.id));
  for (const n of [...feed.children]) if (!wanted.has(n.dataset.id)) n.remove();
  let position = 0;
  for (const a of items) {
    if (existing.has(a.id)) {
      const node = existing.get(a.id);
      if (feed.children[position] !== node) feed.insertBefore(node, feed.children[position] || null);
      position++;
      continue;
    }
    const row = el('article', '', 'chat-row');
    row.dataset.id = a.id;
    const meta = el('small', '');
    meta.append(
      el('span', a.platform + ' | ', 'chat-platform'),
      el('span', new Date(a.time).toLocaleTimeString(), 'chat-time')
    );
    row.append(meta, el('strong', a.name));
    const msg = el('div', a.detail);
    emoteText(msg, { ...(a.platform === 'Twitch' ? state.emotes : {}), ...a.emotes });
    row.append(msg);
    feed.insertBefore(row, feed.children[position] || null);
    position++;
  }
  feed.scrollTop = feed.scrollHeight;
}

$('chat-pause').onchange = () => renderChat();
$('chat-search').oninput = () => renderChat();
$('chat-clear').onclick = () => action('clearChat');
$('chat-sample').onclick = () => action('sampleChat');

let appearanceKey = '';

function applyChatStyle() {
  const p = {
    font: 'Arial',
    size: 20,
    emote: 30,
    text: '#f7f0ff',
    name: '#c8a3ff',
    background: '#251937',
    transparent: true,
    timestamps: true,
    platforms: true,
    limit: 30,
    duration: 0,
    ...state.prefs.chatStyle
  };
  const key = JSON.stringify(p);
  if (key !== appearanceKey) {
    appearanceKey = key;
    for (const [k, v] of Object.entries(p)) {
      const input = $('chat-' + k);
      if (input) {
        if (input.type === 'checkbox') input.checked = v;
        else input.value = v;
      }
    }
    const f = $('chat-feed');
    f.style.fontFamily = p.font;
    f.style.fontSize = p.size + 'px';
    f.style.color = p.text;
    f.style.backgroundColor = p.background;
    f.style.setProperty('--chat-name', p.name);
    f.style.setProperty('--chat-emote', p.emote + 'px');
    f.classList.toggle('hide-time', !p.timestamps);
    f.classList.toggle('hide-platform', !p.platforms);
  }
  $('obs-status').textContent = state.obs ? 'OBS is enabled. Copy your links below.' : 'OBS is stopped.';
  for (const id of ['obs-dock', 'obs-overlay', 'obs-send', 'obs-stop', 'obs-reset'])
    $(id).disabled = !state.obs;
}

$('chat-apply').onclick = () => {
  const p = {};
  for (const k of ['font', 'text', 'name', 'background']) p[k] = $('chat-' + k).value;
  for (const k of ['size', 'emote', 'limit', 'duration']) p[k] = Number($('chat-' + k).value);
  for (const k of ['transparent', 'timestamps', 'platforms']) p[k] = $('chat-' + k).checked;
  action('chatStyle', p);
};
$('obs-start').onclick = () => action('obsStart');
$('obs-stop').onclick = () => action('obsStop');
$('obs-reset').onclick = () => action('obsReset');
$('obs-dock').onclick = () => action('obsCopy', 'dock');
$('obs-send').onclick = () => action('obsCopy', 'send');
$('obs-overlay').onclick = () => action('obsCopy', 'overlay');

let pulseLoaded = false;

function renderPulseSettings() {
  if (!state.pulse) return;
  $('pulse-status').textContent = state.pulse.status;
  $('pulse-action').textContent = state.pulse.action;
  if (!pulseLoaded) {
    pulseLoaded = true;
    $('pulse-port').value = state.prefs.pulsePort || 4455;
    for (const r of state.prefs.pulseRules || [
      {
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
      }
    ])
      pulseRow(r);
  }
}

function pulseRow(r) {
  const box = el('div', '', 'panel'),
    fields = {};
  for (const [k, label] of Object.entries({
    enabled: 'Enabled',
    name: 'Rule name',
    direction: 'Above or Below',
    threshold: 'Trigger BPM',
    reset: 'Reset BPM',
    hold: 'Hold seconds',
    cooldown: 'Cooldown seconds',
    sound: 'Play sound',
    animation: 'Animate overlay',
    scene: 'OBS scene name (blank = no change)'
  })) {
    const l = el('label', label + ' ');
    let input;
    if (k === 'direction') {
      input = document.createElement('select');
      for (const x of ['Above', 'Below']) input.append(el('option', x));
    } else {
      input = document.createElement('input');
      input.type = ['enabled', 'sound', 'animation'].includes(k)
        ? 'checkbox'
        : ['threshold', 'reset', 'hold', 'cooldown'].includes(k)
          ? 'number'
          : 'text';
    }
    if (input.type === 'checkbox') input.checked = !!r[k];
    else input.value = r[k] ?? '';
    fields[k] = input;
    l.append(input);
    box.append(l);
  }
  let soundFile = r.soundFile || '';
  const soundLabel = el('p', soundFile || 'Default chime');
  box.append(
    soundLabel,
    button('Choose WAV', async () => {
      const f = await action('pulseSound');
      if (f) {
        soundFile = f;
        soundLabel.textContent = f;
      }
    }),
    button('Default sound', () => {
      soundFile = '';
      soundLabel.textContent = 'Default chime';
    })
  );
  box.read = () => {
    const v = { soundFile };
    for (const [k, i] of Object.entries(fields))
      v[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value;
    return v;
  };
  box.append(
    button('Preview sound + animation', () => action('pulsePreview', box.read())),
    button('Remove rule', () => box.remove())
  );
  $('pulse-rules').append(box);
}

$('pulse-add').onclick = () => {
  if ($('pulse-rules').children.length < 20)
    pulseRow({
      enabled: true,
      name: 'Heart rate high',
      direction: 'Above',
      threshold: 120,
      reset: 110,
      hold: 5,
      cooldown: 60,
      sound: true,
      animation: true,
      scene: ''
    });
};
$('pulse-save').onclick = async () => {
  await action('pulseSave', {
    token: $('pulse-token').value,
    password: $('pulse-password').value,
    port: Number($('pulse-port').value),
    rules: [...$('pulse-rules').children].map(b => b.read())
  });
  $('pulse-token').value = $('pulse-password').value = '';
};
$('pulse-stop').onclick = () => action('pulseStop');
$('pulse-forget').onclick = () => action('pulseForget');
$('pulse-test').onclick = async () => {
  $('message').textContent =
    (await action('pulseTestObs', {
      port: Number($('pulse-port').value),
      password: $('pulse-password').value
    })) || 'OBS connection failed.';
};
$('pulse-effects').onclick = async () => {
  await action('obsStart');
  await action('obsCopy', 'effects');
};

let toolsLoaded = false,
  actionsKey = '',
  toolRulesKey = '';

function renderTools() {
  if (!state) return;
  const rk = JSON.stringify((state.prefs.pulseRules || []).map(r => r.name));
  if (toolsLoaded && rk !== toolRulesKey) {
    toolsLoaded = false;
    $('tools-mappings').replaceChildren();
    actionsKey = '';
  }
  toolRulesKey = rk;
  $('tools-status').textContent = state.toolsStatus || '';
  const c = state.prefs.tools || { bot: false, lumia: false, port: 8080, mappings: [] };
  if (!toolsLoaded) {
    toolsLoaded = true;
    $('tools-bot').checked = c.bot;
    $('tools-lumia').checked = c.lumia;
    $('tools-port').value = c.port;
    const triggers = [
      'Follows',
      'Subscriptions',
      'Resubscriptions',
      'Gift subscriptions',
      'Bits',
      'Tips',
      'Raids',
      'Super Chats and Stickers',
      'Memberships',
      'Kicks and gifts',
      ...(state.prefs.pulseRules || []).map(r => 'Pulsoid: ' + r.name)
    ];
    for (const trigger of triggers) {
      const m = c.mappings.find(m => m.trigger === trigger) || {},
        row = el('div', '', 'panel');
      row.dataset.trigger = trigger;
      row.append(el('h3', trigger));
      const select = document.createElement('select');
      select.dataset.saved = m.action || '';
      row.append(select);
      const command = document.createElement('input');
      command.placeholder = 'Lumia command (optional)';
      command.setAttribute('aria-label', trigger + ' Lumia command');
      command.value = m.command || '';
      row.append(command);
      $('tools-mappings').append(row);
    }
  }
  const key = JSON.stringify(state.toolActions || []);
  if (key !== actionsKey) {
    actionsKey = key;
    for (const row of $('tools-mappings').children) {
      const select = row.querySelector('select'),
        value = select.value || select.dataset.saved;
      select.replaceChildren();
      const none = el('option', 'No Streamer.bot action');
      none.value = '';
      select.append(none);
      for (const a of state.toolActions || []) {
        const o = el('option', a.name);
        o.value = a.id;
        select.append(o);
      }
      if (value && !(state.toolActions || []).some(a => a.id === value)) {
        const o = el('option', 'Saved action (refresh list for name)');
        o.value = value;
        select.append(o);
      }
      select.value = value;
    }
  }
}

$('tools-refresh').onclick = () =>
  action('toolsActions', { port: Number($('tools-port').value), password: $('tools-password').value });
$('tools-save').onclick = async () => {
  await action('toolsSave', {
    bot: $('tools-bot').checked,
    lumia: $('tools-lumia').checked,
    port: Number($('tools-port').value),
    password: $('tools-password').value,
    token: $('tools-token').value,
    mappings: [...$('tools-mappings').children].map(row => ({
      trigger: row.dataset.trigger,
      action: row.querySelector('select').value,
      command: row.querySelector('input').value.trim()
    }))
  });
  $('tools-password').value = $('tools-token').value = '';
};

let collabLoaded = false,
  collabKey = '';
function renderCollab() {
  const c = state.collab;
  if (!c) return;
  if (!collabLoaded) {
    collabLoaded = true;
    $('collab-origin').value = c.origin || '';
    $('collab-title').value = state.prefs.collabReminder?.title || '';
  }
  $('collab-status').textContent = c.status;
  const key = JSON.stringify(c.entries);
  if (key !== collabKey) {
    collabKey = key;
    $('collab-entries').replaceChildren(...Object.values(c.entries).map(v => el('p', v)));
  }
}

$('collab-connect').onclick = async () => {
  await action('collabConnect', {
    origin: $('collab-origin').value.trim(),
    credential: $('collab-token').value.trim()
  });
  $('collab-token').value = '';
};
$('collab-stop').onclick = () => action('collabStop');
$('collab-reminder').onclick = () =>
  action('collabReminder', {
    title: $('collab-title').value.trim(),
    due: new Date($('collab-due').value).getTime()
  });

// Chat sending: results per platform; never retried automatically.
let chatSending = false;
$('chat-send').onsubmit = async e => {
  e.preventDefault();
  const text = $('chat-message').value.trim();
  if (chatSending || !text) return;
  chatSending = true;
  $('chat-send-button').disabled = $('chat-target').disabled = true;
  $('chat-send-result').textContent = 'Sending…';
  try {
    const r = await window.assist.action('sendChat', { target: $('chat-target').value, text });
    if (!r || r.error) {
      $('chat-send-result').textContent = r?.error || 'Could not send.';
      return;
    }
    $('chat-send-result').textContent = r.results.map(x => x.platform + ': ' + x.message).join(' · ');
    if (r.results.length && r.results.every(x => x.sent)) $('chat-message').value = '';
    else $('chat-send-result').textContent += '  Choose only the failed platform before retrying.';
  } catch {
    $('chat-send-result').textContent = 'Could not send. Check your connection.';
  } finally {
    chatSending = false;
    $('chat-send-button').disabled = $('chat-target').disabled = false;
  }
};
for (const [id, name] of Object.entries({
  'controls-start': 'controlsStart',
  'controls-stop': 'controlsStop',
  'controls-reset': 'controlsReset'
}))
  $(id).onclick = () => action(name);
window.assist.showChat(() => {
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'chat';
});

$('remember').onchange = () => action('remember', $('remember').checked);
// Relays often use http://IP:port. That works, but the personal token is then unencrypted.
function collabTransport() {
  const v = $('collab-origin').value.trim();
  let warn = false;
  try {
    const u = new URL(v);
    warn = u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {}
  $('collab-transport').textContent = warn
    ? 'HTTP: your personal token travels without encryption. Use HTTPS when your relay offers it.'
    : '';
}
$('collab-origin').addEventListener('input', collabTransport);
setInterval(collabTransport, 1000);
