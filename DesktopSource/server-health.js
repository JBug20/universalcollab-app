'use strict';
// Status bar along the bottom of the window, like OBS: relay connection, broadcast time and frame
// rate, destinations, relay CPU, memory and upload, your own recording storage on the relay, free space on this PC
// (the drive OBS records to), and warnings. Storage nearly full turns yellow (red when almost none is left) and
// says so once in the notice line. Click it for details.
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const bar = make('div', null, 'status-bar');
  bar.id = 'statusBar';
  // App messages (the old #notice line) live at the left of the bar.
  const notice = document.getElementById('notice');
  if (notice) bar.append(notice);
  const segments = make('button', null, 'status-segments');
  segments.type = 'button';
  segments.title = 'Server health details';
  segments.setAttribute('aria-label', 'Server health details');
  const seg = (cls, label) => {
    const s = make('span', null, 'status-seg ' + cls);
    if (label) s.append(make('span', label, 'status-key'));
    const v = make('span', '', 'status-value');
    s.append(v);
    segments.append(s);
    return { el: s, value: v };
  };
  const streamTime = seg('stream-time'),
    recordTime = seg('record-time'),
    relay = seg('relay'),
    live = seg('live'),
    outputs = seg('outputs'),
    cpu = seg('cpu', 'Relay CPU'),
    memory = seg('memory', 'Memory'),
    upload = seg('upload', 'Upload'),
    disk = seg('disk', 'My storage'),
    local = seg('local', 'This PC'),
    alerts = seg('alerts');
  bar.append(segments);
  document.body.append(bar);
  document.body.classList.add('has-status-bar');

  // Details window (opened from the bar).
  const details = make('dialog', null, 'status-details');
  details.id = 'statusDetails';
  const head = make('div', null, 'window-title');
  const close = make('button', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close server health');
  close.onclick = () => details.close();
  head.append(make('strong', 'Server health'), close);
  const body = make('div', null, 'status-details-body');
  details.append(head, body);
  document.body.append(details);
  segments.onclick = () => {
    if (details.open) return details.close();
    paintDetails();
    details.show();
  };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && details.open) details.close();
  });

  const gb = b => (b >= 1e9 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB');
  const clock = s => {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = Math.floor(s % 60);
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  };
  const level = (el, value, warn, crit) => {
    el.classList.toggle('warn', value >= warn && value < crit);
    el.classList.toggle('crit', value >= crit);
  };
  function set(s, text, hidden = false) {
    s.value.textContent = text;
    s.el.hidden = hidden;
  }
  // Free space on this PC's recording drive, checked every 30 seconds.
  let pc = null;
  const pcLevel = s =>
    !s
      ? ''
      : s.freeBytes < 2e9
        ? 'crit'
        : s.freeBytes < 1e10 || s.freeBytes < s.totalBytes * 0.05
          ? 'warn'
          : '';
  const relayLevel = s =>
    !s || !(s.limitBytes > 0)
      ? ''
      : s.freeBytes <= 0
        ? 'crit'
        : s.freeBytes < s.limitBytes * 0.1
          ? 'warn'
          : '';
  // One notice per storage problem; it can come back once the storage has recovered.
  const told = { pc: '', relay: '' };
  function tell(key, levelNow, text) {
    if (levelNow && levelNow !== told[key]) note(text);
    told[key] = levelNow;
  }
  async function pollPC() {
    if (!window.relayDesktop?.diskSpace || document.hidden) return;
    try {
      const r = await window.relayDesktop.diskSpace();
      pc = r?.ok ? r.data : null;
    } catch {
      pc = null;
    }
    const l = pcLevel(pc);
    tell(
      'pc',
      l,
      l === 'crit'
        ? `This PC is almost out of space for recordings and clips: ${pc && gb(pc.freeBytes)} free on ${pc?.drive}. Free up space before recording.`
        : `This PC is running low on space for recordings and clips: ${pc && gb(pc.freeBytes)} free on ${pc?.drive}.`
    );
    paint();
  }
  let health = null,
    unsupported = false,
    busy = false,
    liveSince = 0,
    lastUptime = null;

  // OBS stream and recording timers (from OBS: outputActive, outputDuration in ms, outputPaused).
  function outputTime(o, at) {
    if (!o?.outputActive || !Number.isFinite(o.outputDuration)) return null;
    return (o.outputDuration + (o.outputPaused ? 0 : Date.now() - at)) / 1000;
  }
  function paintTimers() {
    const out = window.obsOutputs;
    const st = out && outputTime(out.stream, out.at),
      rec = out && outputTime(out.record, out.at);
    set(
      streamTime,
      st === null || st === undefined ? '' : 'STREAM ' + clock(st),
      st === null || st === undefined
    );
    streamTime.el.title = 'How long OBS has been streaming';
    set(
      recordTime,
      rec === null || rec === undefined
        ? ''
        : (out.record.outputPaused ? 'REC PAUSED ' : 'REC ') + clock(rec),
      rec === null || rec === undefined
    );
    recordTime.el.classList.toggle('paused', !!out?.record?.outputPaused);
    recordTime.el.title = 'How long OBS has been recording';
  }
  function paint() {
    paintTimers();
    const st = view?.status,
      broadcasting = !!(connected && st?.broadcast);
    set(relay, connected ? 'Relay connected' : 'Relay not connected');
    relay.el.classList.toggle('ok', !!connected);
    // Broadcast state and frame rate come from the relay view; the health report adds detail.
    const mine = health?.sessions?.find(s => s.id === profile?.id);
    if (broadcasting) {
      // The relay reports uptime every few seconds; count locally between reports so the clock ticks.
      if (Number.isFinite(st.health?.uptimeSeconds) && st.health.uptimeSeconds !== lastUptime) {
        lastUptime = st.health.uptimeSeconds;
        liveSince = Date.now() - lastUptime * 1000;
      }
      const uptime = liveSince ? (Date.now() - liveSince) / 1000 : undefined;
      const fps = mine?.fps ?? st.health?.outputFps;
      set(
        live,
        (st.source === 'fallback' ? 'FALLBACK ' : 'LIVE ') +
          (Number.isFinite(uptime) ? clock(uptime) : '') +
          (fps ? ' · ' + Number(fps).toFixed(1) + ' fps' : '')
      );
      live.el.classList.toggle('crit', !!(mine && mine.fps !== null && mine.fps < mine.targetFps * 0.95));
      live.el.classList.toggle('fallback', st.source === 'fallback');
    } else {
      set(live, connected ? 'Not live' : '', !connected);
      liveSince = 0;
      lastUptime = null;
    }
    live.el.classList.toggle('on', broadcasting);
    const outs = (mine?.outputs?.length ? mine.outputs : st?.outputs) || [];
    if (broadcasting && outs.length) {
      outputs.value.replaceChildren();
      for (const o of outs) {
        const bad = ['reconnecting', 'stalled'].includes(o.state);
        const dot = make('span', '', 'status-dot ' + (o.state === 'sending' ? 'ok' : bad ? 'bad' : 'idle'));
        const item = make('span', null, 'status-out');
        item.append(
          dot,
          document.createTextNode(o.name + (o.bitrateKbps ? ' ' + Math.round(o.bitrateKbps) + ' kb/s' : ''))
        );
        item.title = o.name + ': ' + o.state;
        outputs.value.append(item);
      }
      outputs.el.hidden = false;
    } else outputs.el.hidden = true;
    const hide = !health;
    const c = health?.cpu?.average10s ?? health?.cpu?.percent;
    set(cpu, c === null || c === undefined ? '…' : Math.round(c) + '%', hide);
    if (!hide && c !== null && c !== undefined) level(cpu.el, c, 75, 90);
    const m = health?.memory;
    set(memory, m?.limitBytes ? gb(m.usedBytes) + ' / ' + gb(m.limitBytes) : '', hide || !m?.limitBytes);
    if (m?.percent !== null && m?.percent !== undefined) level(memory.el, m.percent, 80, 90);
    const tx = health?.network?.txMbps;
    set(
      upload,
      tx === null || tx === undefined ? '' : tx.toFixed(1) + ' Mb/s',
      hide || tx === null || tx === undefined
    );
    // Only this user's recording allowance is shown, never the server's disk. Relays that do not report
    // the allowance (storage) leave the segment hidden.
    const allowance = health?.storage;
    set(
      disk,
      !allowance ? '' : allowance.limitBytes > 0 ? gb(allowance.freeBytes) + ' free' : 'No allowance',
      hide || !allowance
    );
    if (allowance) {
      const l = relayLevel(allowance);
      disk.el.classList.toggle('warn', l === 'warn');
      disk.el.classList.toggle('crit', l === 'crit');
      disk.el.title = 'Your recording allowance on the relay';
      tell(
        'relay',
        l,
        l === 'crit'
          ? 'Your recording storage on the relay is full. Delete old recordings or ask the relay owner for more space.'
          : `Your recording storage on the relay is nearly full: ${gb(allowance.freeBytes)} free of ${gb(allowance.limitBytes)}.`
      );
    }
    set(local, pc ? gb(pc.freeBytes) + ' free' : '', !pc);
    local.el.classList.toggle('warn', pcLevel(pc) === 'warn');
    local.el.classList.toggle('crit', pcLevel(pc) === 'crit');
    local.el.title = pc ? 'Free space on ' + pc.drive + ' (where your recordings and clips are saved)' : '';
    const warnings = health?.warnings || [];
    const critical = warnings.some(w => w.level === 'critical');
    set(
      alerts,
      unsupported && connected
        ? 'Update the relay for health'
        : warnings.length
          ? '⚠ ' + warnings.length
          : '',
      !(warnings.length || (unsupported && connected))
    );
    alerts.el.classList.toggle('crit', critical);
    alerts.el.classList.toggle('warn', !critical && warnings.length > 0);
    alerts.el.title = warnings.map(w => w.text).join('\n');
    if (details.open) paintDetails();
  }

  function paintDetails() {
    body.replaceChildren();
    const pcRow = () => {
      if (!pc) return;
      const g = make('dl', null, 'status-grid');
      g.append(
        make('dt', 'This PC'),
        make(
          'dd',
          gb(pc.freeBytes) +
            ' free of ' +
            gb(pc.totalBytes) +
            ' on ' +
            pc.drive +
            (pc.fromOBS ? ' (OBS recordings folder: ' + pc.folder + ')' : ' (Videos folder)')
        )
      );
      body.append(g);
    };
    if (!connected) {
      body.append(make('p', 'Connect to a relay to see its health.', 'hint'));
      pcRow();
      return;
    }
    if (!health) {
      body.append(
        make(
          'p',
          unsupported
            ? 'This relay does not report its health yet. Update it from Tools → Relay Admin (owner), or ask the relay owner.'
            : 'Checking the relay…',
          'hint'
        )
      );
      pcRow();
      return;
    }
    if (!health.warnings.length) body.append(make('p', 'Everything looks healthy.', 'health-ok'));
    for (const w of health.warnings) body.append(make('p', w.text, 'health-warning ' + w.level));
    const grid = make('dl', null, 'status-grid');
    const row = (k, v) => grid.append(make('dt', k), make('dd', v));
    const c = health.cpu.average10s ?? health.cpu.percent;
    row(
      'Relay CPU',
      (c === null ? 'measuring' : Math.round(c) + '%') +
        ' of ' +
        health.cpu.cores +
        ' core' +
        (health.cpu.cores === 1 ? '' : 's') +
        (health.cpu.source === 'container' ? ' (server allocation)' : '')
    );
    if (health.memory?.limitBytes)
      row('Memory', gb(health.memory.usedBytes) + ' of ' + gb(health.memory.limitBytes));
    if (health.network?.txMbps !== null && health.network?.txMbps !== undefined)
      row(
        'Network',
        health.network.txMbps.toFixed(1) + ' Mb/s up · ' + health.network.rxMbps.toFixed(1) + ' Mb/s down'
      );
    if (health.storage)
      row(
        'My storage',
        health.storage.limitBytes > 0
          ? gb(health.storage.freeBytes) +
              ' free of ' +
              gb(health.storage.limitBytes) +
              ' (' +
              gb(health.storage.usedBytes) +
              ' used by your recordings)'
          : 'No recording allowance on this relay'
      );
    body.append(grid);
    pcRow();
    if (!health.sessions.length && !health.otherBroadcasts)
      body.append(make('p', 'No broadcasts running.', 'hint'));
    for (const s of health.sessions) {
      const card = make('div', null, 'health-session');
      const ok = s.fps === null || s.fps >= s.targetFps * 0.95;
      card.append(
        make('strong', (s.id === profile?.id ? 'Your broadcast' : s.id) + ' · ' + s.state),
        make(
          'span',
          `${s.width}×${s.height} · ${s.fps === null ? 'measuring' : s.fps.toFixed(1)} of ${s.targetFps} fps`,
          ok ? '' : 'health-bad'
        )
      );
      for (const o of s.outputs)
        card.append(
          make(
            'span',
            `${o.name}: ${o.state}${o.bitrateKbps ? ` · ${Math.round(o.bitrateKbps)} kb/s` : ''}${o.quality === 'custom' ? ' · re-encoded' : ' · copy'}`,
            ['reconnecting', 'stalled'].includes(o.state) ? 'health-bad' : ''
          )
        );
      body.append(card);
    }
    if (health.otherBroadcasts)
      body.append(
        make(
          'p',
          `${health.otherBroadcasts} other broadcast${health.otherBroadcasts === 1 ? '' : 's'} on this relay.`,
          'hint'
        )
      );
    body.append(make('p', 'Updated ' + new Date(health.at).toLocaleTimeString(), 'hint health-stamp'));
  }

  async function poll() {
    if (busy || document.hidden) return;
    if (!connected) {
      health = null;
      unsupported = false;
      paint();
      return;
    }
    busy = true;
    try {
      health = await api('/api/v3/health');
      unsupported = false;
    } catch {
      health = null;
      unsupported = true;
    } finally {
      busy = false;
      paint();
    }
  }
  setInterval(poll, 3000);
  setInterval(pollPC, 30000);
  void pollPC();
  setInterval(paint, 1000);
  document.addEventListener('visibilitychange', poll);
  void poll();
})().catch(() => {});
