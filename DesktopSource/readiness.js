'use strict';
// Pre-stream readiness check (1.2.0). "Check stream readiness" (Stream controls, and the menu) opens a report:
// what must be fixed before going live, what is worth checking, and what is ready. Checking only reads: it never
// changes OBS, the relay or any setting.
(() => {
  const GB = 1073741824;
  const size = b => (b >= GB ? (b / GB).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB');

  // facts → [{ level: 'block' | 'warn' | 'info' | 'ok', text }]
  function evaluate(f) {
    const out = [];
    const add = (level, text) => out.push({ level, text });
    const r = f.relay || {};
    if (!r.connected) add('block', 'Not connected to a relay. Connect in Settings → Relay.');
    else {
      if (r.uncertain)
        add('warn', 'The relay connection is unsteady: the last update did not arrive. Check your internet.');
      if (r.held)
        add(
          'block',
          'The relay is holding your stream after a disconnect. Stop OBS reconnecting and wait for it to rearm.'
        );
      if (r.broadcast) add('info', 'You are already live on the relay.');
      else if (!r.destinationConfigured)
        add('block', 'No stream is prepared. Use New stream → Create & prepare to choose where it goes.');
      else add('ok', 'A stream is prepared on the relay.');
      if (r.mode === 'test')
        add('warn', 'The relay is in TEST mode: nothing is sent to YouTube, Twitch or Kick.');
      else add('ok', 'The relay is in LIVE mode.');
      if (Number.isFinite(r.cpu) && r.cpu >= 85)
        add(
          'warn',
          `Relay CPU is at ${Math.round(r.cpu)}%. Re-encoded destinations may stutter; consider "Source" quality for some.`
        );
      const s = r.storage;
      if (s?.limitBytes > 0 && s.freeBytes < s.limitBytes * 0.1)
        add(
          'warn',
          `Your recording storage on the relay is nearly full: ${size(s.freeBytes)} free of ${size(s.limitBytes)}.`
        );
    }
    const o = f.obs || {};
    if (!o.connected) add('block', 'OBS is not connected. Connect it in Settings → OBS.');
    else if (o.error) add('warn', 'Could not read the OBS settings: ' + o.error);
    else if (o.readiness) {
      const d = o.readiness;
      if (/hevc|h265|av1/i.test(d.encoder))
        add(
          'block',
          `OBS's video encoder is ${d.encoder} (HEVC/AV1). The relay needs H.264: OBS → Settings → Output → Video Encoder → an H.264 one (x264, NVIDIA NVENC H.264, AMD H.264 or QuickSync H.264).`
        );
      else if (!d.encoder) add('warn', "Could not read OBS's video encoder. Make sure it is H.264.");
      else add('ok', `OBS video encoder: ${d.encoder} (H.264).`);
      if (/opus/i.test(d.audioEncoder))
        add(
          'block',
          `OBS's audio encoder is ${d.audioEncoder}. The relay needs AAC: OBS → Settings → Output → Audio Encoder → AAC.`
        );
      const v = d.video;
      if (v?.outputWidth && v.fpsDenominator)
        add(
          'info',
          `OBS sends ${v.outputWidth}×${v.outputHeight} at ${Math.round((v.fpsNumerator / v.fpsDenominator) * 100) / 100} fps.`
        );
      if (d.streaming) add('info', 'OBS is already streaming.');
      if (d.replay?.supported && !d.replay.enabled)
        add('warn', 'Clip will not work: turn on OBS → Settings → Output → Replay Buffer.');
      else if (d.replay?.enabled) add('ok', 'Clip is ready (OBS replay buffer on).');
      const rf = d.recordFolder;
      if (rf && !rf.ok)
        add(
          f.autoRecord ? 'block' : 'warn',
          'Recordings cannot be saved: ' + rf.error + ' Choose another folder in Tools → Recordings folder.'
        );
      else if (rf?.ok) add('ok', 'Recordings and clips are saved in ' + rf.folder + '.');
    }
    if (f.pc) {
      const p = f.pc;
      if (p.freeBytes < 2e9)
        add(
          f.autoRecord ? 'block' : 'warn',
          `This PC is almost out of space where recordings are saved: ${size(p.freeBytes)} free on ${p.drive}.` +
            (f.autoRecord ? ' Auto-record will not start.' : '')
        );
      else if (p.freeBytes < 1e10 || p.freeBytes < p.totalBytes * 0.05)
        add('warn', `This PC is low on space for recordings: ${size(p.freeBytes)} free on ${p.drive}.`);
      else add('ok', `${size(p.freeBytes)} free on ${p.drive} for recordings.`);
    }
    for (const g of f.twitchGaps || [])
      add('warn', 'Twitch quality: ' + g + ' Twitch asks for its stream to be at least as good.');
    if (f.autoRecord) add('info', 'A recording starts automatically with the stream.');
    if (r.connected)
      add(
        'info',
        f.afkTarget
          ? `AFK switches viewers to ${f.afkTarget}'s stream.`
          : 'AFK would show your reconnect image: choose a collaborator in End Relay ⚙ → fallback to show their stream instead.'
      );
    return out;
  }
  function summary(items) {
    const block = items.filter(i => i.level === 'block').length,
      warn = items.filter(i => i.level === 'warn').length;
    if (block) return `Not ready: ${block} thing${block === 1 ? '' : 's'} to fix before going live.`;
    if (warn) return `Ready to go live, with ${warn} thing${warn === 1 ? '' : 's'} worth checking.`;
    return 'Ready to go live.';
  }

  // Not called "api": that would hide portal.js's api(), which asks the relay for its health below.
  const exported = { evaluate, summary };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
    return;
  }
  window.readiness = exported;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    async function gather() {
      const relay = {
        connected: !!connected,
        uncertain: !!uncertain,
        mode: view?.status?.mode,
        held: !!view?.status?.held,
        broadcast: !!view?.status?.broadcast,
        destinationConfigured: !!view?.me?.destinationConfigured
      };
      if (connected)
        try {
          const h = await api('/api/v3/health');
          relay.cpu = h?.cpu?.average10s ?? h?.cpu?.percent;
          relay.storage = h?.storage || null;
        } catch {}
      const obs = { connected: !!window.obsConnected };
      if (obs.connected)
        try {
          obs.readiness = await bridge.obs('readiness');
        } catch (e) {
          obs.error = e?.message || 'no answer';
        }
      let pc = null;
      try {
        const d = await bridge?.diskSpace?.();
        if (d?.ok) pc = d.data;
      } catch {}
      let autoRecord = false;
      try {
        autoRecord = !!JSON.parse(localStorage.getItem('uc-auto-record') || '{}').start;
      } catch {}
      return {
        relay,
        obs,
        pc,
        autoRecord,
        twitchGaps: window.twitchQuality?.currentGaps?.() || [],
        afkTarget: view?.me?.settings?.fallback?.[0] || ''
      };
    }

    const dialog = el('dialog');
    dialog.id = 'readinessWindow';
    dialog.setAttribute('aria-label', 'Stream readiness');
    const head = el('p', null, 'readiness-summary');
    head.setAttribute('role', 'status');
    const list = el('div', null, 'readiness-list');
    const again = el('button', 'Check again'),
      close = el('button', 'Close');
    again.type = close.type = 'button';
    const row = el('div', null, 'assist-actions');
    row.append(again, close);
    const hint = el('p', 'Checking only reads your settings; it never changes OBS or the relay.', 'hint');
    dialog.append(el('h2', 'Ready to go live?'), head, list, row, hint);
    document.body.append(dialog);
    const GROUPS = [
      ['block', 'Fix before going live', '✗'],
      ['warn', 'Worth checking', '⚠'],
      ['info', 'Good to know', 'ℹ'],
      ['ok', 'Ready', '✓']
    ];
    async function run() {
      head.textContent = 'Checking…';
      again.disabled = true;
      try {
        const items = evaluate(await gather());
        head.textContent = summary(items);
        head.dataset.level = items.some(i => i.level === 'block')
          ? 'block'
          : items.some(i => i.level === 'warn')
            ? 'warn'
            : 'ok';
        list.replaceChildren(
          ...GROUPS.filter(([level]) => items.some(i => i.level === level)).map(([level, title, mark]) => {
            const sec = el('section', null, 'readiness-group ' + level);
            const ul = el('ul');
            for (const i of items.filter(i => i.level === level)) {
              const li = el('li');
              li.append(el('span', mark, 'readiness-mark'), el('span', i.text));
              ul.append(li);
            }
            sec.append(el('h3', title), ul);
            return sec;
          })
        );
        return items;
      } finally {
        again.disabled = false;
      }
    }
    again.onclick = () => void run();
    close.onclick = () => dialog.close();
    window.openReadiness = async () => {
      if (!dialog.open) dialog.showModal();
      return run();
    };
    // The existing "Check stream readiness" button (and its menu entry) open the report.
    const old = document.getElementById('readinessCheck');
    if (old) {
      const fresh = old.cloneNode(true);
      fresh.disabled = false;
      old.replaceWith(fresh);
      fresh.onclick = () => void window.openReadiness();
    }
  })().catch(() => {});
})();
