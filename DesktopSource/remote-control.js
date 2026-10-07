'use strict';
// Stream Deck control (1.2.0), window side. Runs commands from the UniversalCollab Stream Deck plugin through the
// same code as the buttons (window.streamControls, window.studioMode, window.relayScenes, Stream Assist) and
// sends the state keys show (live, recording, Studio Mode, scenes, mutes). Tools → Stream Deck pairs the plugin.
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const bridge = window.relayDesktop;
  if (!bridge?.remote) return;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const relayOnline = () => connected && !uncertain;
  let assistRunning = false;

  async function run(action, args) {
    const sc = window.streamControls;
    if (!sc) throw Error('UniversalCollab is still starting.');
    switch (action) {
      case 'stream-start':
        return sc.start();
      case 'stream-stop':
        return sc.stop();
      case 'record':
        return sc.record();
      case 'clip':
        return sc.clip();
      case 'obs-scene':
        return sc.scene(args.name);
      case 'mute':
        return sc.mute(args.name);
      case 'end-relay':
        if (!relayOnline() || !view?.status?.broadcast) throw Error('No relay broadcast is running.');
        await window.endRelayBroadcast();
        return 'Relay broadcast ended.';
      case 'studio-mode':
        if (!window.studioMode) throw Error('Studio Mode is unavailable.');
        await window.studioMode.toggle();
        return window.studioMode.enabled ? 'Studio Mode on.' : 'Studio Mode off.';
      case 'transition':
        if (!window.studioMode?.enabled) throw Error('Turn on Studio Mode first.');
        await window.studioMode.transition();
        return 'Transitioned.';
      case 'relay-scene':
        if (!window.relayScenes) throw Error('Relay scenes are unavailable.');
        await window.relayScenes.switch(args.name);
        return 'Relay scene: ' + args.name;
      case 'assist': {
        const r = await bridge.assist({ op: 'action', action: args.action });
        if (!r?.ok) throw Error(r?.error || 'Stream Assist did not respond.');
        return 'Done.';
      }
      default:
        throw Error('Unknown action.');
    }
  }
  bridge.onRemoteCommand(async ({ id, action, args }) => {
    try {
      const message = await run(action, args || {});
      bridge.remoteReply({ id, ok: true, message: typeof message === 'string' ? message : '' });
    } catch (e) {
      bridge.remoteReply({ id, ok: false, error: e?.message || 'Action failed.' });
    }
  });

  function snapshot() {
    const obs = window.streamControls?.state() || { online: false };
    return {
      obs,
      studioMode: !!window.studioMode?.enabled,
      relay: { online: relayOnline(), live: relayOnline() && !!view?.status?.broadcast },
      relayScenes: window.relayScenes?.list() || [],
      assist: { running: assistRunning }
    };
  }
  setInterval(async () => {
    try {
      assistRunning = !!(await bridge.assist({ op: 'status' }))?.running;
    } catch {
      assistRunning = false;
    }
    bridge.remoteState(snapshot());
  }, 1000);

  // Tools → Stream Deck: turn control on or off and copy the pairing token.
  const dialog = el('dialog');
  dialog.id = 'streamDeckWindow';
  dialog.setAttribute('aria-label', 'Stream Deck');
  const status = el('p');
  status.setAttribute('role', 'status');
  const toggle = el('button'),
    copy = el('button', 'Copy pairing token'),
    reset = el('button', 'Reset pairing token'),
    close = el('button', 'Close');
  for (const b of [toggle, copy, reset, close]) b.type = 'button';
  const steps = el('ol');
  for (const t of [
    'Install the UniversalCollab Stream Deck plugin (double-click UniversalCollab.streamDeckPlugin).',
    'Choose Enable Stream Deck control below, then Copy pairing token.',
    'In the Stream Deck app, drag any UniversalCollab action onto a key and paste the token into its settings.',
    'Pick the scene, audio source or Stream Assist action in the key settings where asked.'
  ])
    steps.append(el('li', t));
  const note = el(
    'p',
    'Stream Deck control only accepts connections from this PC. Anyone with the pairing token on this PC can control your stream, so keep it private; Reset pairing token disconnects every paired key. Stop Stream and End Relay keys need a second press within 3 seconds.'
  );
  note.className = 'hint';
  const row = el('div');
  row.className = 'assist-actions';
  row.append(toggle, copy, reset, close);
  dialog.append(el('h2', 'Stream Deck'), steps, status, row, note);
  document.body.append(dialog);
  let info = null;
  function paint() {
    toggle.textContent = info?.enabled ? 'Turn off Stream Deck control' : 'Enable Stream Deck control';
    copy.disabled = reset.disabled = !info?.paired;
    status.textContent = info?.error
      ? info.error
      : info?.enabled
        ? `On · listening on this PC (port ${info.port}) · ${info.clients} Stream Deck connection${info.clients === 1 ? '' : 's'}`
        : 'Off';
  }
  async function request(op, done) {
    const r = await bridge.remote({ op });
    if (!r.ok) {
      status.textContent = r.error;
      return;
    }
    info = r;
    paint();
    if (done) status.textContent += ' · ' + done;
  }
  toggle.onclick = () => request(info?.enabled ? 'disable' : 'enable');
  copy.onclick = () =>
    request('copy-token', 'Pairing token copied. Paste it into the Stream Deck key settings.');
  reset.onclick = () => {
    if (confirm('Reset the pairing token? Every Stream Deck key will need the new token.'))
      void request('reset-token', 'New token made. Copy it and paste it into your Stream Deck keys.');
  };
  close.onclick = () => dialog.close();
  window.openStreamDeckSettings = async () => {
    if (!dialog.open) dialog.showModal();
    await request('status');
  };
  setInterval(() => dialog.open && void request('status'), 2000);
})().catch(() => {});
