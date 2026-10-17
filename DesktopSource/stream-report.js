'use strict';
// Post-stream report (1.2.0). While a relay broadcast runs, UniversalCollab notes how it went: each destination's
// average bitrate and frame rate and every time it stopped receiving (and how long until it was back), OBS's dropped
// frames and reconnects, the recording, viewers on Twitch and YouTube (peak and average), new followers, subscribers
// and supporters (from Stream Assist, as for the end credits), the stream markers and the clips saved. When the
// broadcast ends the report is shown and saved as a text file next to the recordings; Tools → Stream reports lists
// past reports. Notes are kept in this window, so a broadcast is only reported while UniversalCollab runs.
(() => {
  const SECTIONS = [
    ['follow', 'new followers', 'new follower'],
    ['sub', 'subscribers', 'subscriber'],
    ['gift', 'gifted subs', 'gifted sub'],
    ['support', 'supporters', 'supporter'],
    ['raid', 'raiders', 'raider'],
    ['chat', 'chatters', 'chatter']
  ];
  function newReport(now, title = '') {
    return {
      version: 1,
      id: new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15),
      title: String(title || '').slice(0, 140),
      startedAt: now,
      endedAt: 0,
      platforms: [],
      outputs: {},
      obs: {
        base: { skipped: 0, total: 0 },
        last: { skipped: 0, total: 0 },
        reconnects: 0,
        reconnecting: false
      },
      recording: { recorded: false, ms: 0 },
      viewers: {},
      clips: [],
      markers: [],
      community: {}
    };
  }
  // One reading during the broadcast: relay outputs, OBS's stream and recording.
  function sample(r, { outputs = [], stream = null, record = null } = {}) {
    for (const o of outputs) {
      const x = (r.outputs[o.id] ||= { name: o.name || o.id, n: 0, kbps: 0, fps: 0, drops: [] });
      x.name = o.name || x.name;
      if (!r.platforms.includes(x.name)) r.platforms.push(x.name);
      if (o.state === 'sending' && Number.isFinite(o.bitrateKbps) && Number.isFinite(o.fps)) {
        x.n++;
        x.kbps += o.bitrateKbps;
        x.fps += o.fps;
      }
    }
    if (stream?.outputActive) {
      const skipped = Number(stream.outputSkippedFrames) || 0,
        total = Number(stream.outputTotalFrames) || 0;
      // OBS starts counting again when its stream restarts: keep what was counted before.
      if (total < r.obs.last.total) {
        r.obs.base.skipped += r.obs.last.skipped;
        r.obs.base.total += r.obs.last.total;
      }
      r.obs.last = { skipped, total };
      if (stream.outputReconnecting && !r.obs.reconnecting) r.obs.reconnects++;
      r.obs.reconnecting = !!stream.outputReconnecting;
    }
    if (record?.outputActive) {
      r.recording.recorded = true;
      if (Number.isFinite(record.outputDuration))
        r.recording.ms = Math.max(r.recording.ms, record.outputDuration);
    }
    return r;
  }
  // Viewers right now ({ twitch, youtube }; null when unknown).
  function viewers(r, counts = {}) {
    for (const [p, n] of Object.entries(counts)) {
      if (!Number.isFinite(n)) continue;
      const v = (r.viewers[p] ||= { peak: 0, sum: 0, n: 0 });
      v.peak = Math.max(v.peak, n);
      v.sum += n;
      v.n++;
    }
    return r;
  }
  function drop(r, e) {
    const x = (r.outputs[e.id] ||= { name: e.name || e.id, n: 0, kbps: 0, fps: 0, drops: [] });
    if (e.type === 'down') x.drops.push({ at: e.at, state: e.state || '', back: 0 });
    else {
      const last = x.drops.at(-1);
      if (last && !last.back) last.back = e.at;
    }
    return r;
  }
  // Ended: the markers, Stream Assist's people (end credits) and the time.
  function finish(r, { now, markers = [], people = {} } = {}) {
    r.endedAt = now;
    r.markers = markers.map(m => ({ ...m }));
    r.community = Object.fromEntries(SECTIONS.map(([k]) => [k, (people[k] || []).length]));
    return r;
  }

  const pad = n => String(n).padStart(2, '0');
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000)),
      h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }
  const time = t => {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const number = n => Math.round(n).toLocaleString('en-GB');
  function summary(r) {
    const skipped = r.obs.base.skipped + r.obs.last.skipped,
      total = r.obs.base.total + r.obs.last.total;
    const drops = Object.values(r.outputs).reduce((n, o) => n + o.drops.length, 0);
    return {
      length: duration((r.endedAt || Date.now()) - r.startedAt),
      skipped,
      total,
      droppedPercent: total ? (skipped / total) * 100 : 0,
      drops,
      community: SECTIONS.filter(([k]) => r.community[k]).map(([k, many, one]) => {
        const n = r.community[k];
        return `${n} ${n === 1 ? one : many}`;
      })
    };
  }
  // The report as text (saved as a file, and shown).
  function toText(r) {
    const s = summary(r),
      lines = [];
    const date = new Date(r.startedAt).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    lines.push('Stream report' + (r.title ? ': ' + r.title : ''));
    lines.push(`${date}, ${time(r.startedAt)} to ${time(r.endedAt || Date.now())} (${s.length})`);
    if (r.platforms.length) lines.push('Platforms: ' + r.platforms.join(', '));
    lines.push('');
    lines.push('Destinations');
    const outs = Object.values(r.outputs);
    if (!outs.length) lines.push('- No destination readings.');
    for (const o of outs) {
      const avg = o.n ? `${number(o.kbps / o.n)} kbps, ${Math.round(o.fps / o.n)} fps` : 'no readings';
      const d = o.drops.length
        ? `stopped receiving ${o.drops.length}× (` +
          o.drops
            .map(x => time(x.at) + (x.back ? ', back after ' + duration(x.back - x.at) : ', not back'))
            .join('; ') +
          ')'
        : 'no drops';
      lines.push(`- ${o.name}: ${avg}; ${d}`);
    }
    lines.push('');
    lines.push('OBS');
    lines.push(
      s.total
        ? `- Dropped frames: ${s.droppedPercent.toFixed(2)}% (${number(s.skipped)} of ${number(s.total)})`
        : '- Dropped frames: no readings'
    );
    lines.push(`- Reconnects: ${r.obs.reconnects}`);
    lines.push(r.recording.recorded ? `- Recorded: ${duration(r.recording.ms)}` : '- Not recorded');
    const v = Object.entries(r.viewers).filter(([, x]) => x.n);
    if (v.length) {
      lines.push('');
      lines.push('Viewers');
      for (const [p, x] of v)
        lines.push(
          `- ${p === 'twitch' ? 'Twitch' : p === 'youtube' ? 'YouTube' : p}: peak ${number(x.peak)}, average ${number(x.sum / x.n)}`
        );
    }
    lines.push('');
    lines.push('Community');
    lines.push(
      s.community.length ? '- ' + s.community.join(', ') : '- No new followers or supporters noted.'
    );
    lines.push('');
    lines.push('Markers' + (r.markers.length ? ` (${r.markers.length})` : ''));
    if (!r.markers.length) lines.push('- None');
    const fmt = typeof window !== 'undefined' ? window.markerFormat : require('./markers.js');
    for (const m of r.markers) lines.push('- ' + fmt.line(m));
    lines.push('');
    lines.push('Clips' + (r.clips.length ? ` (${r.clips.length})` : ''));
    if (!r.clips.length) lines.push('- None');
    for (const c of r.clips) lines.push('- ' + (c.path || 'saved') + ' at ' + time(c.at));
    return lines.join('\n') + '\n';
  }

  const api = { newReport, sample, viewers, drop, finish, summary, toText, duration };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.streamReport = api;

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
    const btn = (text, fn) => {
      const b = el('button', text);
      b.type = 'button';
      b.onclick = fn;
      return b;
    };
    // The report under way survives an app restart mid-broadcast.
    const KEY = 'uc-stream-report',
      SHOW = 'uc-stream-report-show';
    let current = null;
    try {
      current = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {}
    const persist = () => {
      try {
        if (current) localStorage.setItem(KEY, JSON.stringify(current));
        else localStorage.removeItem(KEY);
      } catch {}
    };
    const live = () => !!(connected && !uncertain && view?.status?.broadcast);
    window.addEventListener('destination-alert', e => {
      if (current) drop(current, e.detail);
    });
    window.addEventListener('obs-clip-saved', e => {
      if (current) current.clips.push({ path: (e.detail?.path || '').split(/[\\/]/).pop(), at: Date.now() });
    });

    let was = null,
      ticks = 0;
    setInterval(async () => {
      if (!connected || uncertain) return;
      const now = live();
      if (now && (was === false || (was === null && !current))) {
        current = newReport(Date.now(), document.getElementById('productionTitle')?.value || '');
        persist();
      }
      if (now && current) {
        sample(current, {
          outputs: view?.status?.outputs || [],
          stream: window.obsOutputs?.stream,
          record: window.obsOutputs?.record
        });
        // Viewers once a minute.
        if (++ticks % 60 === 1)
          try {
            viewers(current, await bridge.platform('live-viewers'));
          } catch {}
        if (ticks % 10 === 0) persist();
      }
      if (was === true && !now && current) await end();
      was = now;
    }, 1000);

    async function end() {
      let people = {};
      try {
        people = JSON.parse(localStorage.getItem('uc-end-credits') || '{}').people || {};
      } catch {}
      const report = finish(current, {
        now: Date.now(),
        markers: window.streamMarkers?.list() || [],
        people
      });
      current = null;
      persist();
      const text = toText(report);
      let saved = null;
      try {
        const r = await bridge.streamReports?.({ op: 'save', report, text });
        if (r?.ok) saved = r.data;
      } catch {}
      if (localStorage.getItem(SHOW) !== 'false') show(report, text, saved);
      note('Stream report saved' + (saved?.file ? ': ' + saved.file : '.'));
    }

    // ---- The report window and Tools → Stream reports ----
    const dialog = el('dialog', null, 'stream-report');
    dialog.id = 'streamReportWindow';
    dialog.setAttribute('aria-label', 'Stream report');
    const heading = el('h2', 'Stream report');
    const facts = el('div', null, 'report-facts');
    const body = el('pre', null, 'report-text');
    body.id = 'streamReportText';
    const status = el('p', null, 'hint');
    status.setAttribute('role', 'status');
    const [showAgain, showLabel] = (() => {
      const i = el('input');
      i.type = 'checkbox';
      i.id = 'streamReportShow';
      const l = el('label', ' Show the report when a broadcast ends', 'check-row');
      l.prepend(i);
      i.onchange = () => {
        try {
          localStorage.setItem(SHOW, String(i.checked));
        } catch {}
      };
      return [i, l];
    })();
    const list = el('div', null, 'report-list');
    list.id = 'streamReportList';
    let shownId = '';
    const copy = btn('Copy', async () => {
      await navigator.clipboard?.writeText(body.textContent).catch(() => {});
      status.textContent = 'Report copied.';
    });
    const folder = btn('Show file', async () => {
      const r = await bridge.streamReports({ op: 'show', id: shownId });
      status.textContent = r?.ok ? '' : r?.error || 'The file is not there any more.';
    });
    const row = el('div', null, 'assist-actions');
    row.append(
      copy,
      folder,
      btn('Close', () => dialog.close())
    );
    dialog.append(heading, facts, body, status, showLabel, el('h3', 'Earlier reports'), list, row);
    document.body.append(dialog);

    function fact(value, label) {
      const box = el('div', null, 'report-fact');
      box.append(el('strong', value), el('span', label));
      return box;
    }
    function show(report, text, saved) {
      const s = summary(report);
      shownId = report.id;
      heading.textContent = 'Stream report' + (report.title ? ': ' + report.title : '');
      const peak = Math.max(0, ...Object.values(report.viewers).map(v => v.peak || 0));
      facts.replaceChildren(
        fact(s.length, 'length'),
        fact(String(s.drops), s.drops === 1 ? 'destination drop' : 'destination drops'),
        fact(s.total ? s.droppedPercent.toFixed(2) + '%' : '–', 'frames dropped'),
        fact(peak ? String(peak) : '–', 'peak viewers'),
        fact(String(report.markers.length), report.markers.length === 1 ? 'marker' : 'markers'),
        fact(String(report.clips.length), report.clips.length === 1 ? 'clip' : 'clips')
      );
      body.textContent = text;
      status.textContent = saved?.file ? 'Saved as ' + saved.file : '';
      folder.hidden = !saved?.file && !saved?.path;
      showAgain.checked = localStorage.getItem(SHOW) !== 'false';
      void paintList();
      if (!dialog.open) dialog.showModal();
    }
    async function paintList() {
      const r = await bridge.streamReports?.({ op: 'list' }).catch(() => null);
      const items = r?.ok ? r.data : [];
      list.replaceChildren(
        ...(items.length
          ? items.map(x =>
              btn(
                `${new Date(x.startedAt).toLocaleString()} · ${duration(x.endedAt - x.startedAt)}` +
                  (x.title ? ' · ' + x.title : ''),
                async () => {
                  const g = await bridge.streamReports({ op: 'get', id: x.id });
                  if (g?.ok) show(g.data.report, toText(g.data.report), g.data);
                }
              )
            )
          : [el('p', 'No reports yet. One is made each time a relay broadcast ends.', 'hint')])
      );
      for (const b of list.querySelectorAll('button')) b.classList.add('report-item');
    }
    window.openStreamReports = async () => {
      const r = await bridge.streamReports?.({ op: 'list' }).catch(() => null);
      const latest = r?.ok ? r.data[0] : null;
      if (latest) {
        const g = await bridge.streamReports({ op: 'get', id: latest.id });
        if (g?.ok) return show(g.data.report, toText(g.data.report), g.data);
      }
      heading.textContent = 'Stream reports';
      facts.replaceChildren();
      body.textContent = 'No reports yet. One is made each time a relay broadcast ends.';
      folder.hidden = true;
      showAgain.checked = localStorage.getItem(SHOW) !== 'false';
      void paintList();
      if (!dialog.open) dialog.showModal();
    };
    window.streamReportNow = () => current;
  })().catch(() => {});
})();
