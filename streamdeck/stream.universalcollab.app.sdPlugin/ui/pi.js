'use strict';
// Key settings for the UniversalCollab Stream Deck plugin. Stream Deck calls connectElgatoStreamDeckSocket.
// The scene / audio source / Stream Assist lists come from the plugin, which gets them from UniversalCollab.
const CHOICES = {
  obsscene: {
    key: 'scene',
    label: 'OBS scene',
    list: i => i.scenes,
    empty: 'Connect OBS in UniversalCollab to list scenes.'
  },
  relayscene: {
    key: 'scene',
    label: 'Relay scene',
    list: i => i.relayScenes,
    empty: 'Connect to your relay in UniversalCollab to list relay scenes.'
  },
  mute: {
    key: 'input',
    label: 'Audio source',
    list: i => i.inputs,
    empty: 'Connect OBS in UniversalCollab to list audio sources.'
  },
  assist: {
    key: 'assistAction',
    label: 'Assist action',
    list: i => Object.entries(i.assistActions || {}),
    empty: '',
    hint: 'Start Stream Assist in UniversalCollab first.'
  }
};
const $ = id => document.getElementById(id);
let socket,
  uuid,
  action,
  settings = {},
  global = {};

function send(event, payload, extra = {}) {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ event, context: uuid, payload, ...extra }));
}

function fill(info) {
  const kind = action.slice('stream.universalcollab.app.'.length);
  const c = CHOICES[kind];
  const status = $('status');
  status.textContent = info.status;
  status.className = 'status ' + (info.connected ? 'ok' : 'bad');
  $('port').value = global.port || '';
  if (!info.hasToken) $('pairing').open = true;
  if (!c) return;
  $('choiceRow').hidden = false;
  $('choiceLabel').textContent = c.label;
  const select = $('choice');
  const options = (c.list(info) || []).map(o => (Array.isArray(o) ? o : [o, o]));
  const current = settings[c.key] || '';
  // Keep a saved choice that the app does not list right now (OBS closed, other relay).
  if (current && !options.some(([v]) => v === current))
    options.unshift([current, current + ' (not found now)']);
  select.replaceChildren(new Option('Choose…', ''), ...options.map(([v, t]) => new Option(t, v)));
  select.value = current;
  const hint = !options.length ? c.empty : c.hint || '';
  $('choiceHint').hidden = !hint;
  $('choiceHint').textContent = hint;
}

// eslint-disable-next-line no-unused-vars
function connectElgatoStreamDeckSocket(port, propertyInspectorUUID, registerEvent, infoJSON, actionInfoJSON) {
  uuid = propertyInspectorUUID;
  const actionInfo = JSON.parse(actionInfoJSON);
  action = actionInfo.action;
  settings = actionInfo.payload?.settings || {};
  socket = new WebSocket('ws://127.0.0.1:' + port);
  socket.onopen = () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    send('getGlobalSettings');
    send('sendToPlugin', { type: 'getInfo' }, { action });
  };
  socket.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.event === 'didReceiveGlobalSettings') {
      global = m.payload?.settings || {};
      $('port').value = global.port || '';
    }
    if (m.event === 'sendToPropertyInspector') fill(m.payload);
  };
  $('choice').onchange = () => {
    const c = CHOICES[action.slice('stream.universalcollab.app.'.length)];
    settings[c.key] = $('choice').value;
    send('setSettings', settings);
  };
  $('save').onclick = () => {
    const token = $('token').value.trim();
    const port = Number($('port').value) || 18750;
    global = { ...global, port, ...(token ? { token } : {}) };
    send('setGlobalSettings', global);
    $('token').value = '';
    $('status').textContent = 'Saved. Connecting…';
    setTimeout(() => send('sendToPlugin', { type: 'getInfo' }, { action }), 1500);
  };
  // Refresh the lists while the settings are open (scenes can change in OBS).
  setInterval(() => send('sendToPlugin', { type: 'getInfo' }, { action }), 3000);
}
