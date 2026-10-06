'use strict';
(async () => {
  await window.portalReady;
  if (document.body.dataset.ready !== 'true')
    await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const $ = id => document.getElementById(id),
    bridge = window.relayDesktop;
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const btn = (text, fn) => {
    const n = node('button', text);
    n.type = 'button';
    n.onclick = () => run(fn);
    return n;
  };
  const status = node('p');
  status.id = 'obsControlStatus';
  status.setAttribute('role', 'status');
  $('streamsPanel').append(status);
  const previewStatus = node('p', 'OBS preview off — connect OBS to display its output.');
  previewStatus.id = 'obsPreviewStatus';
  previewStatus.className = 'hint';
  $('layoutPreview').after(previewStatus);
  let retrying = false,
    autoRetry = localStorage.getItem('uc-ui7-obs-retry') !== 'false',
    paired = localStorage.getItem('uc-ui7-obs-paired') === 'true',
    retryPaused = false;
  let draftPending = false,
    state = null,
    online = false,
    polling = false,
    working = false,
    editScene = '',
    selectedSource = null,
    signature = '',
    lastAuto = '',
    configuring = null,
    previewBusy = false,
    previewTimer,
    previewEpoch = 0,
    meters = false;
  let pref;
  try {
    pref = JSON.parse(localStorage.getItem('uc-ui6-preview'));
  } catch {}
  pref = {
    enabled: pref?.enabled !== false,
    mode: pref?.mode === 'snapshots' ? 'snapshots' : 'live',
    rate: [1000 / 60, 1000 / 30, 100, 200, 500, 1000, 2000].includes(pref?.rate) ? pref.rate : 1000 / 60,
    width: [320, 640, 1280, 1920, 2560].includes(pref?.width) ? pref.width : 640
  };
  const say = text => {
    status.textContent = text;
    $('obsFeedback').textContent = text;
  };
  const call = (op, input = {}) => {
    if (!bridge?.obs) throw Error('OBS controls require the desktop app.');
    return bridge.obs(op, { ...input, serverKey: selected()?.key });
  };
  // "With OBS" builds include OBS. Settings → OBS chooses between it and the user's own OBS.
  let bundled = { available: false };
  let obsSource = localStorage.getItem('uc-obs-source');
  const useBundled = () => bundled.available && obsSource !== 'own';
  async function run(fn) {
    if (working) return;
    working = true;
    buttons();
    try {
      await fn();
    } catch (e) {
      say(e.message);
    } finally {
      working = false;
      buttons();
    }
  }
  const start = btn('Start Stream', async () => {
    if (!online) throw Error('Connect OBS in Settings → OBS first.');
    await call('start', { automatic: $('obsMode').value === 'auto' });
    say('Stream started in OBS.');
    // Start the replay buffer with the stream so the first Clip already has footage (skipped if it is off in OBS).
    call('replay-start').catch(() => {});
    await poll();
  });
  start.id = 'startStream';
  $('newStream').after(start);
  const stop = btn('Stop Stream', async () => {
    if (
      confirm(
        'Stop sending your OBS feed? Your relay may continue broadcasting its fallback until you end the relay broadcast.'
      )
    ) {
      await call('stream-stop');
      say('OBS stream stopped.');
      await poll();
    }
  });
  stop.id = 'stopOBSStream';
  start.after(stop);
  const record = btn('Start Recording', async () => {
    if (state?.record?.outputActive) {
      if (!confirm('Stop the local OBS recording?')) return;
      await call('record-stop');
    } else await call('record-start');
    await poll();
  });
  record.id = 'obsRecord';
  stop.after(record);
  // Clip: saves the last seconds of OBS output (OBS replay buffer) as a video file in OBS's recording folder.
  const clipNote = node('p');
  clipNote.id = 'obsClipNote';
  clipNote.className = 'hint';
  clipNote.setAttribute('role', 'status');
  clipNote.hidden = true;
  const clip = btn('Clip', async () => {
    const r = await call('clip');
    clipNote.replaceChildren();
    clipNote.hidden = false;
    if (r.started) {
      clipNote.textContent = `Replay buffer started. Press Clip again to save the last ${r.seconds || 'few'} seconds.`;
      return;
    }
    const file = r.path ? r.path.split(/[\\/]/).pop() : '';
    clipNote.append(file ? 'Clip saved: ' + file + ' ' : "Clip saved in OBS's recording folder.");
    if (r.path) {
      const show = btn('Show file', async () => {
        const s = await call('clip-show', { path: r.path });
        if (!s.shown) say('That clip is on the computer running OBS: ' + s.path);
      });
      clipNote.append(show);
    }
  });
  clip.id = 'obsClip';
  clip.title = 'Save the last seconds of your stream as a video file (OBS replay buffer)';
  // Start Recording and Clip share a row (like End Relay and its settings) to keep Stream controls short.
  const recordRow = node('div');
  recordRow.className = 'record-clip-row';
  record.after(recordRow);
  recordRow.append(record, clip);
  recordRow.after(clipNote);
  clipNote.after($('end'));
  $('end').hidden = false;
  function buttons() {
    start.hidden = !!state?.stream?.outputActive;
    stop.hidden = !online || !state?.stream?.outputActive;
    record.hidden = !online;
    clip.hidden = !online;
    recordRow.hidden = !online;
    clip.disabled = working || !online;
    start.disabled =
      draftPending || working || !online || !connected || uncertain || !!state?.stream?.outputActive;
    stop.disabled = working || !state?.stream?.outputActive;
    record.disabled = working || !online;
    record.textContent = state?.record?.outputActive ? 'Stop Recording' : 'Start Recording';
  }
  function connection(value) {
    if (!value) {
      window.obsOutputs = null;
      window.studioMode?.obsLost();
    }
    $('obsConnectionIndicator').textContent = value
      ? 'OBS: Connected'
      : retryPaused
        ? 'OBS: Disconnected'
        : paired && autoRetry
          ? 'OBS: Reconnecting'
          : 'OBS: Disconnected';
    const changed = online !== value;
    online = value;
    window.obsConnected = value;
    if (changed) meters = false;
    if (!value) {
      state = null;
      lastAuto = '';
      editScene = '';
      signature = '';
      previewEpoch++;
      clearTimeout(previewTimer);
      window.streamCanvas.preview('');
      previewStatus.textContent = 'OBS preview unavailable — OBS is disconnected.';
      $('obsVideoFields').hidden = true;
      $('obsSettingsState').textContent = 'Connect OBS to edit these settings.';
    }
    buttons();
    if (changed) {
      window.dispatchEvent(new Event('obs-connection'));
      if (value) {
        schedulePreview();
        void autoConfigure();
      }
      updateMeters();
    }
  }
  async function autoConfigure(force = false) {
    if (!online || !connected || uncertain || $('obsMode').value !== 'auto') return;
    const key = selected()?.key;
    if (!key || (!force && lastAuto === key)) return;
    if (configuring) return configuring;
    lastAuto = key;
    configuring = (async () => {
      try {
        await call('configure');
        say('Relay URL and key set and verified in OBS.');
      } catch (e) {
        say(e.message + ' New Stream or Start Stream will retry when ready.');
      } finally {
        configuring = null;
      }
    })();
    return configuring;
  }
  async function connect(saved, discover = false) {
    const password = $('obsPassword').value;
    $('obsPassword').value = '';
    await call(
      'connect',
      discover
        ? { discover: true, bundled: useBundled() }
        : saved
          ? { saved: true, bundled: useBundled() }
          : { port: Number($('obsPort').value), password, remember: $('obsRemember').checked }
    );
    paired = true;
    retryPaused = false;
    localStorage.setItem('uc-ui7-obs-paired', 'true');
    connection(true);
    say('OBS connected.');
    await autoConfigure();
    await poll();
    await loadSettings();
  }
  window.connectOBSAutomatically = () => connect(false, true);
  $('obsConnect').onclick = () => run(() => connect(false));
  $('obsReconnect').onclick = () => run(() => connect(true));
  $('obsDisconnect').onclick = () =>
    run(async () => {
      retryPaused = true;
      await call('disconnect');
      connection(false);
      say('OBS disconnected.');
    });
  $('obsRestore').onclick = () =>
    run(async () => {
      if (
        confirm(
          'Restore the OBS destination from before automatic relay setup? Stop OBS streaming first. Automatic mode will change it again when you connect to a relay or prepare a stream.'
        )
      ) {
        await call('restore');
        say('Previous OBS destination restored.');
      }
    });
  $('obsMode').addEventListener('change', () => {
    if ($('obsMode').value === 'auto') void autoConfigure(true);
  });
  $('newStream').addEventListener('click', () => {
    draftPending = true;
    buttons();
    void autoConfigure(true);
  });
  window.addEventListener('stream-prepared', () => {
    draftPending = false;
    buttons();
    void autoConfigure(true);
  });
  window.addEventListener('relay-state', () => {
    buttons();
    if (!connected) lastAuto = '';
    void autoConfigure();
  });
  function optionList(select, list, value) {
    const before = JSON.stringify([...select.options].map(o => [o.value, o.textContent]));
    if (before !== JSON.stringify(list)) {
      select.replaceChildren(...list.map(([v, n]) => new Option(n, v)));
    }
    select.value = value;
  }
  function transform() {
    const item = state?.items?.find(i => i.sceneItemId === selectedSource);
    $('obsTransform').hidden = !item;
    if (!item) return;
    const t = item.sceneItemTransform || {};
    for (const [id, k, fallback] of [
      ['obsSourceX', 'positionX', 0],
      ['obsSourceY', 'positionY', 0],
      ['obsSourceSX', 'scaleX', 1],
      ['obsSourceSY', 'scaleY', 1],
      ['obsSourceRotation', 'rotation', 0]
    ]) {
      if (document.activeElement !== $(id)) $(id).value = t[k] ?? fallback;
      $(id).disabled = !!item.sceneItemLocked;
    }
    $('obsTransformSave').disabled = !!item.sceneItemLocked;
  }
  function paint() {
    buttons();
    const scenes = (state.scenes || []).map(s => [s.sceneName, s.sceneName]);
    optionList($('obsEditScene'), scenes, editScene);
    const studio = !!state.studioMode;
    const sceneSig = JSON.stringify([scenes, state.current, state.preview, studio]);
    if ($('obsScenes').dataset.signature !== sceneSig) {
      $('obsScenes').dataset.signature = sceneSig;
      $('obsScenes').replaceChildren(
        ...scenes.map(([name]) => {
          const b = btn(name, async () => {
            // Studio mode: pick the preview scene; Transition puts it on the program.
            if (state.studioMode) await call('preview-scene', { sceneName: name });
            else await call('scene-switch', { sceneName: name });
            editScene = name;
            selectedSource = null;
            await poll();
          });
          b.setAttribute('aria-pressed', String(name === (studio ? state.preview : state.current)));
          b.classList.toggle('obs-program', studio && name === state.current);
          if (studio && name === state.current) b.title = 'On the OBS program';
          return b;
        })
      );
    }
    const items = state.items || [];
    const next = JSON.stringify([editScene, items]);
    if (next !== signature && !$('obsSources').contains(document.activeElement)) {
      signature = next;
      $('obsSources').replaceChildren();
      for (const item of [...items].sort((a, b) => b.sceneItemIndex - a.sceneItemIndex)) {
        const row = node('div');
        row.className = 'obs-source-row';
        const base = { sceneName: editScene, id: item.sceneItemId };
        const select = btn(item.sourceName, () => {
          selectedSource = item.sceneItemId;
          transform();
        });
        select.className = 'source-name';
        row.append(select);
        const toggle = (label, checked, op, key) => {
          const l = node('label', label),
            c = node('input');
          c.type = 'checkbox';
          c.checked = checked;
          c.setAttribute('aria-label', label + ' ' + item.sourceName);
          c.onchange = () =>
            run(async () => {
              await call(op, { ...base, [key]: c.checked });
              await poll();
            });
          l.className = 'check-row';
          l.prepend(c);
          row.append(l);
        };
        toggle('Show', item.sceneItemEnabled, 'source-visible', 'enabled');
        toggle('Lock', item.sceneItemLocked, 'source-lock', 'locked');
        for (const [text, delta] of [
          ['↑', 1],
          ['↓', -1]
        ]) {
          const b = btn(text, async () => {
            await call('source-order', { ...base, index: item.sceneItemIndex + delta });
            await poll();
          });
          b.setAttribute('aria-label', (delta === 1 ? 'Raise ' : 'Lower ') + item.sourceName);
          b.disabled = item.sceneItemIndex + delta < 0 || item.sceneItemIndex + delta >= items.length;
          row.append(b);
        }
        row.append(
          btn('Remove', async () => {
            if (confirm('Remove ' + item.sourceName + ' from this OBS scene?')) {
              await call('source-delete', base);
              selectedSource = null;
              await poll();
            }
          })
        );
        $('obsSources').append(row);
      }
    }
    optionList(
      $('obsExistingSource'),
      (state.inputs || []).map(i => [i.inputName, i.inputName]),
      $('obsExistingSource').value || (state.inputs || [])[0]?.inputName || ''
    );
    const mixer = $('obsMixer'),
      names = (state.mixer || []).map(i => i.inputName);
    if (mixer.dataset.names !== JSON.stringify(names)) {
      mixer.dataset.names = JSON.stringify(names);
      mixer.replaceChildren();
      for (const input of state.mixer || []) {
        const row = node('div');
        row.className = 'obs-mixer-row';
        row.dataset.name = input.inputName;
        row.append(node('strong', input.inputName));
        const meter = node('div');
        meter.className = 'obs-meter';
        meter.setAttribute('role', 'meter');
        meter.setAttribute('aria-valuemin', '-60');
        meter.setAttribute('aria-valuemax', '0');
        meter.setAttribute('aria-label', input.inputName + ' audio level');
        meter.append(node('span'));
        showLevel(meter, 0);
        const slider = node('input');
        slider.type = 'range';
        slider.min = -100;
        slider.max = 0;
        slider.step = 1;
        slider.setAttribute('aria-label', input.inputName + ' volume');
        slider.onchange = () =>
          run(async () => {
            await call('volume', { inputName: input.inputName, db: Number(slider.value) });
            await poll();
          });
        const mute = btn('Mute', async () => {
          const latest = state.mixer.find(i => i.inputName === input.inputName);
          await call('mute', { inputName: input.inputName, muted: !latest.inputMuted });
          await poll();
        });
        row.append(meter, slider, mute);
        mixer.append(row);
      }
    }
    for (const row of mixer.children) {
      const input = state.mixer.find(i => i.inputName === row.dataset.name),
        slider = row.querySelector('input'),
        mute = row.querySelector('button');
      if (document.activeElement !== slider)
        slider.value = Number.isFinite(input.inputVolumeDb) ? Math.max(-100, input.inputVolumeDb) : -100;
      mute.textContent = input.inputMuted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(input.inputMuted));
    }
    transform();
  }
  async function poll() {
    if (polling || !bridge?.obs || document.hidden) return;
    polling = true;
    try {
      const r = await call('state');
      connection(!!r.connected);
      if (online) {
        if (!$('studioPage').hidden) {
          state = await call('snapshot', { ...(editScene ? { sceneName: editScene } : {}) });
          editScene = state.sceneName;
          // Stream and recording timers for the status bar (durations count on locally between polls).
          window.obsOutputs = { stream: state.stream, record: state.record, at: Date.now() };
          if (state.available?.includes?.('SetStudioModeEnabled'))
            window.studioMode?.fromOBS(!!state.studioMode);
          paint();
          checkVirtualCam();
        } else buttons();
      }
    } catch (e) {
      say(e.message);
      editScene = '';
    } finally {
      polling = false;
      updateMeters();
    }
  }
  // OBS sends linear peak levels (0–1). Show them like OBS does: -60 dB at the bottom, 0 dB at the top.
  function showLevel(meter, level) {
    const db = level > 0 ? 20 * Math.log10(level) : -Infinity,
      position = Math.min(1, Math.max(0, (db + 60) / 60));
    meter.style.setProperty('--level', String(position));
    meter.setAttribute('aria-valuenow', String(Number.isFinite(db) ? Math.max(-60, Math.round(db)) : -60));
  }
  function updateMeters() {
    const next = online && !document.hidden && !$('studioPage').hidden && !$('obsMixerPanel').hidden;
    if (next === meters) return;
    meters = next;
    if (online) call('meters', { enabled: next }).catch(() => {});
  }
  $('obsEditScene').onchange = () =>
    run(async () => {
      editScene = $('obsEditScene').value;
      selectedSource = null;
      await poll();
    });
  for (const [button, op] of [
    ['obsSceneCreate', 'scene-create'],
    ['obsSceneRename', 'scene-rename'],
    ['obsSceneDelete', 'scene-delete']
  ])
    $(button).onclick = () =>
      run(async () => {
        const name = $('obsSceneName').value.trim();
        if (
          op === 'scene-delete' &&
          !confirm('Delete the OBS scene “' + editScene + '” and its scene items?')
        )
          return;
        await call(op, { sceneName: op === 'scene-create' ? name : editScene, newName: name });
        editScene = op === 'scene-delete' ? '' : name;
        selectedSource = null;
        await poll();
      });
  $('obsSourceAdd').onclick = () =>
    run(async () => {
      await call('source-add', { sceneName: editScene, sourceName: $('obsExistingSource').value });
      await poll();
    });
  $('obsTransformSave').onclick = () =>
    run(async () => {
      await call('source-transform', {
        sceneName: editScene,
        id: selectedSource,
        x: Number($('obsSourceX').value),
        y: Number($('obsSourceY').value),
        scaleX: Number($('obsSourceSX').value),
        scaleY: Number($('obsSourceSY').value),
        rotation: Number($('obsSourceRotation').value)
      });
      await poll();
    });
  const videoMap = {
    baseWidth: 'obsBaseWidth',
    baseHeight: 'obsBaseHeight',
    outputWidth: 'obsOutputWidth',
    outputHeight: 'obsOutputHeight',
    fpsNumerator: 'obsFPSNum',
    fpsDenominator: 'obsFPSDen'
  };
  async function loadSettings() {
    if (!online) return;
    const s = await call('settings');
    for (const [k, id] of Object.entries(videoMap)) $(id).value = s.video[k];
    $('obsRecordDirectory').value = s.record?.recordDirectory || '';
    $('obsRecordDirectorySave').disabled = !s.record;
    $('obsVideoFields').hidden = false;
    $('obsSettingsState').textContent = 'Connected to OBS. Changes apply to its current profile.';
  }
  $('obsSettingsLoad').onclick = () => run(loadSettings);
  $('obsVideoSave').onclick = () =>
    run(async () => {
      await call(
        'video',
        Object.fromEntries(Object.entries(videoMap).map(([k, id]) => [k, Number($(id).value)]))
      );
      stopLive(false);
      live.offPolls = 0;
      live.retryAt = 0;
      schedulePreview();
      await loadSettings();
      say('OBS video settings saved.');
    });
  $('obsRecordDirectorySave').onclick = () =>
    run(async () => {
      await call('record-directory', { directory: $('obsRecordDirectory').value });
      say('OBS recording folder saved.');
    });
  $('obsPreviewEnabled').checked = pref.enabled;
  $('obsPreviewRate').value = String(pref.rate);
  $('obsPreviewWidth').value = String(pref.width);
  {
    const label = node('label', 'Preview type');
    const mode = node('select');
    mode.id = 'obsPreviewMode';
    for (const [value, text] of [
      ['live', 'Live video · full quality (OBS Virtual Camera)'],
      ['snapshots', 'Snapshots · uses the rate and width below']
    ]) {
      const o = node('option', text);
      o.value = value;
      mode.append(o);
    }
    mode.value = pref.mode;
    label.append(mode);
    $('obsPreviewRate').closest('label').before(label);
  }
  const live = {
    error: '',
    stream: null,
    starting: false,
    failed: 0,
    retryAt: 0,
    epoch: 0,
    offPolls: 0,
    stoppedInOBS: false
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Studio mode: the Virtual Camera (OBS's program) feeds the Program pane and snapshots of the
  // OBS preview scene fill the editor. With the relay video live, Program shows the relay instead.
  const studioOn = () => !!window.studioMode?.enabled;
  function showLive(stream) {
    if (studioOn()) {
      window.streamCanvas.live?.(null);
      window.studioMode.program(stream);
    } else {
      window.studioMode?.program(null);
      window.streamCanvas.live?.(stream);
    }
  }
  function liveWanted() {
    return (
      pref.mode === 'live' &&
      !live.stoppedInOBS &&
      previewAllowed() &&
      !(studioOn() && window.relayVideoActive) &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }
  function stopLive(releaseCamera) {
    live.epoch++;
    if (live.stream) {
      for (const t of live.stream.getTracks()) t.stop();
      live.stream = null;
      showLive(null);
    }
    if (releaseCamera && online) call('virtualcam', { enabled: false }).catch(() => {});
  }
  async function startLive() {
    if (live.stream || live.starting || Date.now() < live.retryAt) return;
    live.starting = true;
    const epoch = ++live.epoch;
    try {
      await call('virtualcam', { enabled: true });
      let device = null;
      for (let i = 0; i < 15 && !device; i++) {
        device = (await navigator.mediaDevices.enumerateDevices()).find(
          d => d.kind === 'videoinput' && /obs/i.test(d.label) && /virtual/i.test(d.label)
        );
        if (!device) await sleep(300);
      }
      if (!device) throw Error('Windows did not list the OBS Virtual Camera.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: device.deviceId },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 }
        }
      });
      if (epoch !== live.epoch || !liveWanted()) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const track = stream.getVideoTracks()[0];
      live.stream = stream;
      live.failed = 0;
      live.offPolls = 0;
      clearTimeout(previewTimer);
      previewTimer = null;
      track.onended = () => {
        if (live.stream !== stream) return;
        stopLive(false);
        live.retryAt = Date.now() + 3000;
        schedulePreview();
      };
      showLive(stream);
      if (live.error) say('Live OBS preview is running.');
      live.error = '';
      const v = track.getSettings();
      previewStatus.textContent =
        'Live OBS preview · ' +
        (v.width || '?') +
        '×' +
        (v.height || '?') +
        ' · ' +
        Math.round(v.frameRate || 0) +
        ' FPS · no audio';
    } catch (e) {
      if (epoch === live.epoch) {
        live.failed++;
        live.retryAt = Date.now() + Math.min(30000, 3000 * live.failed);
        const message = e?.message || 'camera error';
        if (message !== live.error)
          say('Live OBS preview unavailable: ' + message + ' Showing snapshots until it works.');
        live.error = message;
      }
    } finally {
      live.starting = false;
    }
  }
  function checkVirtualCam() {
    if (pref.mode !== 'live' || !state || state.virtualCam === null || state.virtualCam === undefined) return;
    if (state.virtualCam) {
      live.offPolls = 0;
      if (live.stoppedInOBS) {
        live.stoppedInOBS = false;
        live.retryAt = 0;
        schedulePreview();
      }
      return;
    }
    if (live.stream && ++live.offPolls >= 2) {
      stopLive(false);
      live.stoppedInOBS = true;
      say(
        'The OBS Virtual Camera was stopped in OBS, so the preview is showing snapshots. Start it in OBS again to return to live video.'
      );
      schedulePreview();
    }
  }
  function previewAllowed() {
    return (
      (!window.relayVideoActive || studioOn()) &&
      pref.enabled &&
      online &&
      !document.hidden &&
      !$('studioPage').hidden &&
      !$('canvasPanel').hidden
    );
  }
  let previewStarted = 0,
    previewFrames = 0,
    previewMeasured = performance.now(),
    previewActual = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = null;
    if (!pref.enabled) {
      stopLive(true);
      window.streamCanvas.preview('');
      previewStatus.textContent = 'OBS preview is off.';
      return;
    }
    if (pref.mode !== 'live') stopLive(true);
    if (!previewAllowed()) {
      stopLive(false);
      return;
    }
    if (live.stream && !liveWanted()) stopLive(false);
    if (liveWanted()) {
      if (live.stream && !studioOn()) return;
      if (!live.stream) void startLive();
    }
    previewTimer = setTimeout(preview, Math.max(0, pref.rate - (performance.now() - previewStarted)));
  }
  async function preview() {
    previewTimer = null;
    if (previewBusy || !previewAllowed() || (live.stream && !studioOn())) return;
    previewBusy = true;
    previewStarted = performance.now();
    const epoch = previewEpoch;
    try {
      const r = await call('preview', { width: pref.width, ...(studioOn() ? { scene: 'preview' } : {}) });
      if (epoch === previewEpoch && previewAllowed()) {
        window.streamCanvas.preview(r.image);
        previewFrames++;
        const elapsed = performance.now() - previewMeasured;
        if (elapsed >= 1000) {
          previewActual = (previewFrames * 1000) / elapsed;
          previewFrames = 0;
          previewMeasured = performance.now();
        }
        previewStatus.textContent =
          (studioOn() ? 'OBS preview scene · ' : 'OBS preview · ') +
          previewActual.toFixed(1) +
          ' updates/s · target ' +
          Math.round(1000 / pref.rate) +
          ' FPS' +
          (pref.mode === 'live' && live.error ? ' · live video unavailable: ' + live.error : '');
      }
    } catch (e) {
      window.streamCanvas.preview('');
      previewStatus.textContent = 'OBS preview unavailable: ' + e.message;
    } finally {
      previewBusy = false;
      schedulePreview();
    }
  }
  for (const id of ['obsPreviewEnabled', 'obsPreviewMode', 'obsPreviewRate', 'obsPreviewWidth'])
    $(id).onchange = () => {
      live.stoppedInOBS = false;
      live.retryAt = 0;
      live.failed = 0;
      pref = {
        enabled: $('obsPreviewEnabled').checked,
        mode: $('obsPreviewMode').value === 'snapshots' ? 'snapshots' : 'live',
        rate: Number($('obsPreviewRate').value),
        width: Number($('obsPreviewWidth').value)
      };
      localStorage.setItem('uc-ui6-preview', JSON.stringify(pref));
      previewEpoch++;
      schedulePreview();
    };
  window.addEventListener('studio-mode', () => {
    showLive(live.stream);
    previewEpoch++;
    schedulePreview();
    void poll();
  });
  document.addEventListener('visibilitychange', () => {
    previewEpoch++;
    schedulePreview();
    updateMeters();
    if (!document.hidden) void poll();
  });
  for (const b of document.querySelectorAll('[data-page]'))
    b.addEventListener('click', () => {
      previewEpoch++;
      schedulePreview();
      updateMeters();
      void poll();
    });
  bridge?.onOBS?.(e => {
    if (e.type === 'connection') {
      if (!e.connected) stopLive(false);
      connection(e.connected);
      if (!e.connected) say('OBS disconnected. Reconnect in Settings → OBS.');
    } else if (e.type === 'meters' && meters) {
      for (const row of $('obsMixer').children) {
        const input = e.inputs.find(i => i.name === row.dataset.name);
        showLevel(row.querySelector('.obs-meter'), input?.level || 0);
      }
    }
  });
  window.addEventListener('beforeunload', () => {
    clearTimeout(previewTimer);
    stopLive(false);
    if (online) call('meters', { enabled: false }).catch(() => {});
  });
  async function setupBundled() {
    try {
      bundled = await call('bundled-info');
    } catch {
      bundled = { available: false };
    }
    if (!bundled.available) return;
    // Existing users who already paired their own OBS keep it until they switch.
    if (!obsSource) {
      obsSource = paired ? 'own' : 'bundled';
      localStorage.setItem('uc-obs-source', obsSource);
      if (obsSource === 'own')
        say('This version includes OBS. Switch to it in Settings → OBS → OBS connection settings.');
    }
    const box = node('div');
    box.id = 'bundledOBSBox';
    box.className = 'bundled-obs';
    const label = node('label', 'OBS to use');
    const select = node('select');
    select.id = 'obsSource';
    for (const [v, t] of [
      ['bundled', 'OBS included with UniversalCollab (recommended)'],
      ['own', 'My own OBS installation']
    ]) {
      const o = node('option', t);
      o.value = v;
      select.append(o);
    }
    select.value = obsSource;
    label.append(select);
    const info = node('p');
    info.id = 'bundledOBSStatus';
    info.className = 'hint';
    const start = btn('Start included OBS', async () => {
      retryPaused = false;
      say('Starting the included OBS…');
      await connect(false, true);
    });
    start.id = 'bundledOBSStart';
    const show = btn('Open OBS window', async () => {
      const r = await call('bundled-show');
      say(
        r.shown
          ? 'OBS window opened. Close it or minimise it to the tray when finished.'
          : 'Open OBS from its icon in the system tray (near the clock).'
      );
    });
    show.id = 'bundledOBSShow';
    const stop = btn('Close included OBS', async () => {
      retryPaused = true;
      await call('bundled-stop');
      connection(false);
      say('Included OBS closed.');
    });
    stop.id = 'bundledOBSStop';
    box.append(label, info, start, show, stop);
    const intro = $('automaticOBS').querySelector('p');
    $('automaticOBS').insertBefore(box, intro);
    const manual = [
      intro,
      $('obsPort').closest('label'),
      $('obsPassword').closest('label'),
      $('obsRemember').closest('label'),
      $('obsConnect'),
      $('obsReconnect')
    ];
    async function paintBundled() {
      try {
        bundled = { ...(await call('bundled-info')), available: true };
      } catch {}
      const on = useBundled();
      for (const n of manual) if (n) n.hidden = on;
      start.hidden = show.hidden = stop.hidden = !on;
      start.disabled = online && bundled.running;
      show.disabled = stop.disabled = !bundled.running;
      info.hidden = !on;
      info.textContent = bundled.running
        ? 'The included OBS' +
          (bundled.version ? ' ' + bundled.version : '') +
          ' is running in the background (system tray). UniversalCollab starts it and closes it for you.'
        : bundled.error ||
          (bundled.closedByUser
            ? 'The included OBS was closed. Start it again here.'
            : 'The included OBS starts automatically with UniversalCollab.');
    }
    select.onchange = () =>
      run(async () => {
        obsSource = select.value;
        localStorage.setItem('uc-obs-source', obsSource);
        retryPaused = false;
        if (online) {
          await call('disconnect');
          connection(false);
        }
        if (obsSource === 'own' && bundled.running) await call('bundled-stop');
        await paintBundled();
        if (useBundled()) await connect(false, true);
        else say('Using your own OBS. Enable its WebSocket server and connect below.');
      });
    window.addEventListener('obs-connection', () => void paintBundled());
    setInterval(() => {
      if ($('obsPairWindow').open) void paintBundled();
    }, 2000);
    await paintBundled();
  }
  await setupBundled();
  $('obsAutoReconnect').checked = autoRetry;
  $('obsAutoReconnect').onchange = () => {
    autoRetry = $('obsAutoReconnect').checked;
    retryPaused = false;
    localStorage.setItem('uc-ui7-obs-retry', String(autoRetry));
    connection(online);
  };
  async function retry() {
    if (!bridge?.obs || online || retrying || working || !paired || !autoRetry || retryPaused) return;
    retrying = true;
    try {
      await call('connect', { retry: true, bundled: useBundled() });
      connection(true);
      say('OBS reconnected.');
      await poll();
    } catch {
      connection(false);
    } finally {
      retrying = false;
    }
  }
  setInterval(() => {
    void retry();
  }, 2000);
  setInterval(() => {
    void poll();
    if (previewAllowed() && !previewBusy && !previewTimer) schedulePreview();
  }, 2000);
  buttons();
  await poll();
  schedulePreview();
})().catch(e => {
  const p = document.getElementById('obsFeedback');
  if (p) p.textContent = 'OBS controls unavailable: ' + e.message;
});
