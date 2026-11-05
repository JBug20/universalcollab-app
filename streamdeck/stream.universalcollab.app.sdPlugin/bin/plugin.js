'use strict';
// UniversalCollab Stream Deck plugin. Stream Deck starts this with -port -pluginUUID -registerEvent -info.
// It connects to Stream Deck (keys, settings) and to UniversalCollab's local control on this PC
// (Tools → Stream Deck in the app), runs key presses as commands and lights keys from the app's state.
const WebSocket = require('./ws');

const PREFIX = 'stream.universalcollab.app.';
const DEFAULT_PORT = 18750;
const CONFIRM_MS = 3000;
// Keys that change something big need a second press within CONFIRM_MS.
const CONFIRM = { stream: 'Press again\nto stop', endrelay: 'Press again\nto end' };
const ASSIST_ACTIONS = {
  toggleSound: 'Toggle sound',
  togglePopups: 'Toggle desktop alerts',
  samples: 'Sample alerts',
  chatPopout: 'Pop out chat',
  popout: 'Pop out alerts',
  connectSaved: 'Connect saved accounts'
};

// What a key press sends to the app, given the key's action, its settings and the app's state.
function commandFor(kind, settings, state) {
  switch (kind) {
    case 'stream': {
      // Live while OBS streams or the relay broadcasts. Stopping ends the whole broadcast (OBS and relay) unless the
      // key is set to stop OBS only. A second press confirms, unless the key's settings turn that off.
      const live = !!(state?.obs?.live || state?.relay?.live);
      if (!live) return { action: 'stream-start' };
      const confirm = settings?.confirmStop !== false;
      return settings?.stopMode === 'obs'
        ? { action: 'stream-stop', confirm }
        : { action: 'stream-stop', args: { endRelay: true }, confirm };
    }
    case 'record':
      return { action: 'record' };
    case 'clip':
      return { action: 'clip' };
    case 'pause':
      return { action: 'record-pause' };
    case 'marker':
      return { action: 'marker' };
    case 'endrelay':
      return { action: 'end-relay', confirm: settings?.confirmStop !== false };
    case 'studiomode':
      return { action: 'studio-mode' };
    case 'transition':
      return { action: 'transition' };
    case 'afk':
      return { action: 'afk' };
    case 'obsscene':
      return settings?.scene
        ? { action: 'obs-scene', args: { name: settings.scene } }
        : { missing: 'Choose an OBS scene in this key’s settings.' };
    case 'relayscene':
      return settings?.scene
        ? { action: 'relay-scene', args: { name: settings.scene } }
        : { missing: 'Choose a relay scene in this key’s settings.' };
    case 'mute':
      return settings?.input
        ? { action: 'mute', args: { name: settings.input } }
        : { missing: 'Choose an audio source in this key’s settings.' };
    case 'assist':
      return ASSIST_ACTIONS[settings?.assistAction]
        ? { action: 'assist', args: { action: settings.assistAction } }
        : { missing: 'Choose a Stream Assist action in this key’s settings.' };
    default:
      return { missing: 'Unknown key.' };
  }
}

// Which state (0 or 1) a key shows for the app's state; null for keys with one state.
function keyState(kind, settings, state) {
  if (!state) return 0;
  const obs = state.obs || {};
  switch (kind) {
    case 'stream':
      return obs.live || state.relay?.live ? 1 : 0;
    case 'record':
      return obs.recording ? 1 : 0;
    case 'pause':
      return obs.paused ? 1 : 0;
    case 'endrelay':
      return state.relay?.live ? 1 : 0;
    case 'studiomode':
      return state.studioMode ? 1 : 0;
    case 'afk':
      return state.afk ? 1 : 0;
    case 'obsscene': {
      const active = state.studioMode && obs.preview ? obs.preview : obs.current;
      return settings?.scene && settings.scene === active ? 1 : 0;
    }
    case 'relayscene':
      return (state.relayScenes || []).some(s => s.name === settings?.scene && s.selected) ? 1 : 0;
    case 'mute':
      return (obs.inputs || []).some(i => i.name === settings?.input && i.muted) ? 1 : 0;
    default:
      return null;
  }
}

function run(args) {
  const arg = name => args[args.indexOf('-' + name) + 1];
  const sdPort = arg('port'),
    pluginUUID = arg('pluginUUID'),
    registerEvent = arg('registerEvent');
  const keys = new Map(); // context -> { kind, settings }
  const armed = new Map(); // context -> timer for a pending confirmation
  let global = {},
    app = null,
    appStatus = 'Not paired yet: paste the pairing token from UniversalCollab (Tools → Stream Deck).',
    appState = null,
    sequence = 0,
    retry = null;
  const waiting = new Map(); // command id -> context

  const sd = new WebSocket('ws://127.0.0.1:' + sdPort);
  const toSD = value => sd.readyState === WebSocket.OPEN && sd.send(JSON.stringify(value));
  const log = message => toSD({ event: 'logMessage', payload: { message: 'UniversalCollab: ' + message } });
  const title = (context, text) => toSD({ event: 'setTitle', context, payload: { title: text, target: 0 } });
  const paintAll = () => {
    for (const [context, k] of keys) {
      const s = keyState(k.kind, k.settings, appState);
      if (s !== null) toSD({ event: 'setState', context, payload: { state: s } });
    }
  };
  const info = () => ({
    type: 'info',
    connected: !!app && app.readyState === WebSocket.OPEN && app.paired,
    status: appStatus,
    port: global.port || DEFAULT_PORT,
    hasToken: !!global.token,
    scenes: appState?.obs?.scenes || [],
    relayScenes: (appState?.relayScenes || []).map(s => s.name),
    inputs: (appState?.obs?.inputs || []).map(i => i.name),
    assistActions: ASSIST_ACTIONS
  });

  function connectApp() {
    clearTimeout(retry);
    if (app) {
      app.removeAllListeners();
      app.terminate();
      app = null;
    }
    if (!global.token) {
      appStatus = 'Not paired yet: paste the pairing token from UniversalCollab (Tools → Stream Deck).';
      return;
    }
    const port = Number(global.port) || DEFAULT_PORT;
    const ws = (app = new WebSocket('ws://127.0.0.1:' + port));
    ws.paired = false;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: global.token })));
    ws.on('message', raw => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === 'hello') {
        ws.paired = true;
        appStatus = 'Connected to UniversalCollab.';
      } else if (m.type === 'state') {
        appState = m.state;
        paintAll();
      } else if (m.type === 'result') {
        const context = waiting.get(m.id);
        waiting.delete(m.id);
        if (!context) return;
        if (m.ok) toSD({ event: 'showOk', context });
        else {
          toSD({ event: 'showAlert', context });
          log(m.error || 'Action failed.');
        }
      }
    });
    ws.on('close', code => {
      if (app !== ws) return;
      appStatus =
        code === 4401
          ? 'Wrong pairing token. Copy it again from UniversalCollab (Tools → Stream Deck).'
          : 'UniversalCollab is not reachable. Open it and turn on Tools → Stream Deck.';
      ws.paired = false;
      // A wrong token will not fix itself; anything else is retried.
      if (code !== 4401) retry = setTimeout(connectApp, 3000);
    });
    ws.on('error', () => {});
  }

  function press(context) {
    const k = keys.get(context);
    if (!k) return;
    const c = commandFor(k.kind, k.settings, appState);
    if (c.missing) {
      log(c.missing);
      return toSD({ event: 'showAlert', context });
    }
    if (!app || app.readyState !== WebSocket.OPEN || !app.paired) {
      log(appStatus);
      return toSD({ event: 'showAlert', context });
    }
    if (c.confirm && !armed.has(context)) {
      title(context, CONFIRM[k.kind] || 'Press again');
      armed.set(
        context,
        setTimeout(() => {
          armed.delete(context);
          title(context, '');
        }, CONFIRM_MS)
      );
      return;
    }
    if (armed.has(context)) {
      clearTimeout(armed.get(context));
      armed.delete(context);
      title(context, '');
    }
    const id = 'c' + ++sequence;
    waiting.set(id, context);
    app.send(JSON.stringify({ type: 'command', id, action: c.action, args: c.args || {} }));
  }

  sd.on('open', () => {
    toSD({ event: registerEvent, uuid: pluginUUID });
    toSD({ event: 'getGlobalSettings', context: pluginUUID });
  });
  sd.on('message', raw => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const kind =
      typeof m.action === 'string' && m.action.startsWith(PREFIX) ? m.action.slice(PREFIX.length) : '';
    switch (m.event) {
      case 'didReceiveGlobalSettings': {
        const next = m.payload?.settings || {};
        const changed = next.token !== global.token || Number(next.port) !== Number(global.port);
        global = next;
        if (changed) connectApp();
        break;
      }
      case 'willAppear':
      case 'didReceiveSettings':
        keys.set(m.context, { kind, settings: m.payload?.settings || {} });
        paintAll();
        break;
      case 'willDisappear':
        keys.delete(m.context);
        break;
      case 'keyDown':
        keys.set(m.context, { kind, settings: m.payload?.settings || {} });
        press(m.context);
        break;
      case 'sendToPlugin':
        // Save connection in a key's settings: the token comes straight here (Stream Deck does not pass the panel's
        // own global-settings change on to the plugin). Stored in Stream Deck's settings so it survives a restart.
        if (m.payload?.type === 'pair') {
          const token = typeof m.payload.token === 'string' ? m.payload.token.trim() : '';
          const port = Number(m.payload.port);
          global = {
            ...global,
            ...(Number.isInteger(port) && port > 1023 && port < 65536 ? { port } : {}),
            ...(token && token.length <= 200 ? { token } : {})
          };
          toSD({ event: 'setGlobalSettings', context: pluginUUID, payload: global });
          connectApp();
        }
      // falls through: answer with the current status
      case 'propertyInspectorDidAppear':
        toSD({ event: 'sendToPropertyInspector', action: m.action, context: m.context, payload: info() });
        break;
    }
  });
  sd.on('close', () => process.exit(0));
  sd.on('error', () => process.exit(1));
}

module.exports = { commandFor, keyState, ASSIST_ACTIONS };
if (require.main === module) run(process.argv);
