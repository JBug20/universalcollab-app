'use strict';
// Studio mode, like OBS: edit in Preview, send to the stream with Transition.
// - Relay layout: scene switches and layout edits stay in the editor (Preview). The Program pane shows
//   what is on the stream. Transition sends the edited layout to the relay.
// - OBS: the same switch turns on OBS's own studio mode. OBS scene buttons pick the preview scene and
//   Transition runs the OBS transition too.
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const $ = id => document.getElementById(id);
  const make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const KEY = 'uc-studio-mode';
  let enabled = false;
  try {
    enabled = localStorage.getItem(KEY) === 'true';
  } catch {}

  const panel = $('canvasPanel'),
    canvas = $('layoutPreview');
  // Stage: Preview (the editor) and Program (what is on stream) side by side, level with each other.
  const stage = make('div', null, 'studio-stage'),
    panes = make('div', null, 'studio-panes');
  stage.id = 'studioStage';
  const previewPane = make('div', null, 'studio-pane studio-preview-pane'),
    programPane = make('div', null, 'studio-pane studio-program-pane'),
    middle = make('div', null, 'studio-transition');
  const previewLabel = make('span', 'Preview', 'studio-label is-preview'),
    programLabel = make('span', 'Program', 'studio-label is-program');
  const program = make('div', null, 'studio-program');
  program.id = 'programView';
  program.setAttribute('aria-label', 'Program: what is on the stream now');
  const programVideo = make('video', null, 'studio-program-video');
  programVideo.muted = true;
  programVideo.autoplay = true;
  programVideo.playsInline = true;
  programVideo.disablePictureInPicture = true;
  programVideo.hidden = true;
  programVideo.setAttribute('aria-label', 'OBS program output');
  const boxes = make('div', null, 'studio-program-boxes');
  const programNote = make('p', '', 'studio-program-note');
  program.append(programVideo, boxes, programNote);
  previewPane.append(previewLabel);
  programPane.append(programLabel, program);
  const transitionButton = make('button', 'Transition', 'primary studio-transition-button');
  transitionButton.type = 'button';
  transitionButton.id = 'studioTransition';
  transitionButton.title = 'Send Preview to the stream';
  const pending = make('span', '', 'studio-pending');
  pending.setAttribute('role', 'status');
  middle.append(transitionButton, pending);
  panes.append(previewPane, programPane);
  stage.append(panes);
  // Transition sits in the panel's title bar so the videos get the full height.
  for (const b of [transitionButton]) b.addEventListener('pointerdown', e => e.stopPropagation());
  transitionButton.draggable = false;

  // Stream controls: a Studio Mode button like OBS's Controls dock.
  const toggle = make('button', 'Studio Mode', 'studio-mode-toggle');
  toggle.type = 'button';
  toggle.id = 'studioModeToggle';
  const controls = document.querySelector('#streamsPanel > .sectionhead');
  if (controls) controls.append(toggle);

  function place() {
    if (enabled) {
      if (canvas.parentElement !== previewPane) {
        panel.insertBefore(stage, canvas);
        previewPane.append(canvas);
      }
      const head = panel.querySelector(':scope > .dock-handle');
      if (middle.parentElement !== (head || stage)) (head || stage).append(middle);
    } else if (canvas.parentElement === previewPane) {
      panel.insertBefore(canvas, stage);
      stage.remove();
      middle.remove();
    }
  }

  // ---- Sizing: size the editor through
  // fitStreamCanvas, give Program the same size, and pin each label to its video's corner. ----
  function aspect() {
    const r = (canvas.style.aspectRatio || '16/9').split('/').map(Number);
    return r[0] / r[1] || 16 / 9;
  }
  // Preview and Program always sit side by side, level with each other, like OBS.
  function arrange() {
    if (!enabled) return;
    if (panes.classList.contains('stacked')) {
      panes.classList.remove('stacked');
      window.fitStreamCanvas?.();
    }
  }
  function follow() {
    if (!enabled) return;
    program.style.width = canvas.style.width;
    program.style.height = canvas.style.height;
    for (const [label, frame] of [
      [previewLabel, canvas],
      [programLabel, program]
    ]) {
      label.style.left = frame.offsetLeft + 6 + 'px';
      label.style.top = frame.offsetTop + 4 + 'px';
    }
  }

  // ---- Program pane: relay video when broadcasting, otherwise OBS program video, with outlines
  // of the layout that is live on the relay. ----
  function liveLayout() {
    const s = view?.me?.settings;
    if (!s) return [];
    const pct = (view?.status?.overlayWidthPercent || 25) / 100;
    const list = [
      { label: 'Your main feed', x: 0, y: 0, width: 1, height: 1, ...(s.main || {}), main: true }
    ];
    for (const p of s.overlays || [])
      list.push({
        label: (view?.peers?.find(x => x.id === p.publisher)?.displayName || p.publisher) + ' POV',
        visible: p.visible,
        x: p.x ?? (p.corner?.endsWith('left') ? 0.027 : 0.973),
        y: p.y ?? (p.corner?.startsWith('bottom') ? 0.973 : 0.027),
        width: p.width ?? pct,
        height: p.height ?? pct
      });
    for (const c of s.chatOverlays || []) list.push({ ...c, label: 'Chat · ' + c.source });
    for (const m of s.mediaOverlays || [])
      list.push({
        ...m,
        label: m.name || (m.kind === 'text' ? 'Text' : m.kind === 'image' ? 'Picture' : 'Browser page')
      });
    return list.filter(
      i =>
        i.visible !== false &&
        [i.x, i.y, i.width, i.height].every(n => typeof n === 'number' && Number.isFinite(n))
    );
  }
  let boxSignature = '';
  function paintBoxes() {
    const list = liveLayout(),
      s = view?.me?.settings,
      size = s?.resolution?.width ? s.resolution : view?.status?.width ? view.status : null;
    program.style.aspectRatio = (size?.width || 16) + '/' + (size?.height || 9);
    const sig = JSON.stringify(list);
    if (sig === boxSignature) return;
    boxSignature = sig;
    boxes.replaceChildren(
      ...list.map(i => {
        const b = make('div', null, 'studio-program-box' + (i.main ? ' main' : ''));
        b.style.left = i.x * (1 - i.width) * 100 + '%';
        b.style.top = i.y * (1 - i.height) * 100 + '%';
        b.style.width = i.width * 100 + '%';
        b.style.height = i.height * 100 + '%';
        b.append(make('span', i.label));
        return b;
      })
    );
  }
  let relayVideo = false,
    obsStream = null;
  function paintProgram() {
    relayVideo = !!document.querySelector('#programView #relayCanvasVideo:not([hidden])');
    programVideo.hidden = relayVideo || !obsStream;
    program.classList.toggle('relay-video', relayVideo);
    boxes.hidden = relayVideo;
    programNote.textContent = relayVideo
      ? ''
      : !connected
        ? 'Connect to a relay to see what is on stream.'
        : view?.status?.broadcast
          ? 'Outlines show the live relay layout.'
          : 'Not live · outlines show the layout the stream will start with.';
    paintBoxes();
  }

  // ---- OBS ----
  const obs = (op, input) => window.relayDesktop?.obs?.(op, input);
  let obsKnown, // OBS's studio mode as last seen (undefined until the first poll after connecting)
    localChangeAt = 0;
  async function pushOBS() {
    if (!window.obsConnected) return;
    localChangeAt = Date.now();
    try {
      await obs('studio-mode', { enabled });
      obsKnown = enabled;
    } catch (e) {
      note('OBS studio mode could not be changed: ' + e.message);
    }
  }

  function paint() {
    document.body.classList.toggle('studio-mode', enabled);
    panel.classList.toggle('studio-mode', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.classList.toggle('active', enabled);
    place();
    const save = document.querySelector(
      '#sourcesPanel .dock-actions button[aria-label="Apply relay layout"]'
    );
    if (save) save.title = enabled ? 'Transition: send Preview to the stream' : 'Apply relay layout';
    pending.textContent = enabled && layoutDirty && connected ? 'Preview has changes' : '';
    transitionButton.disabled = busy || transitioning;
    if (enabled) paintProgram();
  }
  function set(value, { fromOBS = false } = {}) {
    value = !!value;
    if (value === enabled) return;
    enabled = value;
    try {
      localStorage.setItem(KEY, String(enabled));
    } catch {}
    if (!fromOBS) void pushOBS();
    else obsKnown = value;
    paint();
    arrange();
    window.fitStreamCanvas?.();
    window.dispatchEvent(new Event('studio-mode'));
    note(
      enabled
        ? 'Studio mode on. Edit scenes and the layout in Preview, then press Transition to send them live.'
        : 'Studio mode off. Changes apply to the stream directly.'
    );
  }
  let transitioning = false;
  async function transition() {
    if (!enabled || transitioning) return false;
    transitioning = true;
    paint();
    try {
      let ok = true;
      if (connected) ok = await window.streamCanvas.save({ transition: true });
      if (ok && window.obsConnected && obsKnown) {
        try {
          await obs('transition');
        } catch (e) {
          note('OBS transition failed: ' + e.message);
          ok = false;
        }
      }
      if (ok && !connected && !window.obsConnected) note('Connect to a relay or OBS to transition.');
      return ok;
    } finally {
      transitioning = false;
      paint();
    }
  }
  toggle.onclick = () => set(!enabled);
  transitionButton.onclick = () => void transition();

  window.studioMode = {
    get enabled() {
      return enabled;
    },
    programBox: program,
    set,
    toggle: () => set(!enabled),
    transition,
    // The OBS Virtual Camera (OBS's program output) shown in the Program pane.
    program: stream => {
      obsStream = stream || null;
      if (programVideo.srcObject !== obsStream) programVideo.srcObject = obsStream;
      paintProgram();
    },
    // Called by the OBS panel after each poll with OBS's studio mode state.
    fromOBS: value => {
      if (typeof value !== 'boolean') return;
      if (obsKnown === undefined) {
        // First look after connecting: OBS follows the app.
        obsKnown = value;
        if (value !== enabled) void pushOBS();
        return;
      }
      if (Date.now() - localChangeAt < 4000) return;
      if (value !== obsKnown) {
        obsKnown = value;
        // Turned on or off in OBS itself: follow it.
        set(value, { fromOBS: true });
      }
    },
    obsLost: () => {
      obsKnown = undefined;
    }
  };
  window.addEventListener('relay-state', paint);
  window.addEventListener('scene-change', paint);
  window.addEventListener('studio-program', paint);
  setInterval(() => enabled && paint(), 1000);
  new ResizeObserver(() => {
    arrange();
    if (enabled) window.fitStreamCanvas?.();
  }).observe(panes);
  new ResizeObserver(follow).observe(canvas);
  new ResizeObserver(follow).observe(programPane);
  paint();
  if (enabled) {
    window.fitStreamCanvas?.();
    window.dispatchEvent(new Event('studio-mode'));
  }
})().catch(() => {});
