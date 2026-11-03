'use strict';
// Stream markers (1.2.0). Mark a good moment with the Mark button, a keyboard shortcut or a Stream Deck key. Each
// marker is added as a Twitch stream marker (when Twitch is connected and live), as a chapter in the recording
// (OBS's own recording in Hybrid MP4, and the Source Record recording scene), and to this stream's marker list with
// its time in the stream and in the recording. The list goes into the post-stream report (stream-report.js), so
// the moments are easy to find when editing. A new list starts when a relay broadcast starts.
(() => {
  // 3725 s → "1:02:05", 65 → "1:05".
  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const s = Math.floor(seconds),
      h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  // Seconds into OBS's recording now, from the last reading (outputDuration in ms) and the time since.
  function recordingSeconds(record, at, now = Date.now()) {
    if (!record?.outputActive || !Number.isFinite(record.outputDuration)) return null;
    return (record.outputDuration + (record.outputPaused ? 0 : Math.max(0, now - (at || now)))) / 1000;
  }
  // One line per marker for the report and the text file.
  function line(m) {
    const parts = [`#${m.n}`, m.label || 'Marker'];
    if (m.stream !== null) parts.push('stream ' + clock(m.stream));
    if (m.recording !== null) parts.push('recording ' + clock(m.recording));
    parts.push(new Date(m.at).toLocaleTimeString());
    const done = [m.twitch && 'Twitch marker', m.chapter && 'recording chapter'].filter(Boolean);
    return parts.join(' · ') + (done.length ? ' (' + done.join(', ') + ')' : '');
  }
  const api = { clock, recordingSeconds, line };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.markerFormat = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    const KEY = 'uc-markers';
    let session = { startedAt: 0, markers: [] };
    try {
      session = { ...session, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {}
    const persist = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(session));
      } catch {}
    };
    const live = () => !!(connected && !uncertain && view?.status?.broadcast);
    // A new list when a relay broadcast starts.
    let was = null;
    setInterval(() => {
      if (!connected || uncertain) return;
      const now = live();
      if (was === false && now) {
        session = { startedAt: Date.now(), markers: [] };
        persist();
      }
      was = now;
    }, 1000);

    let busy = false;
    async function add(label = '') {
      if (busy) throw Error('Still adding the last marker.');
      busy = true;
      try {
        const now = Date.now();
        const out = window.obsOutputs;
        const marker = {
          n: session.markers.length + 1,
          at: now,
          label: String(label || '').slice(0, 100),
          stream: live() && session.startedAt ? (now - session.startedAt) / 1000 : null,
          recording: recordingSeconds(out?.record, out?.at, now),
          twitch: false,
          chapter: false
        };
        const name = marker.label || 'Marker ' + marker.n;
        const tries = [];
        if (live())
          tries.push(
            bridge
              .platform('twitch-marker', { description: name })
              .then(() => (marker.twitch = true))
              .catch(() => {})
          );
        if (window.obsConnected && out?.record?.outputActive)
          tries.push(
            bridge
              .obs('record-chapter', { name, serverKey: selected()?.key })
              .then(r => (marker.chapter = !!(r?.program || r?.scene)))
              .catch(() => {})
          );
        await Promise.all(tries);
        if (!live() && marker.recording === null)
          throw Error('Nothing to mark: start a relay broadcast or a recording first.');
        session.markers.push(marker);
        persist();
        window.dispatchEvent(new CustomEvent('stream-marker', { detail: marker }));
        const where = [
          marker.stream !== null && 'stream ' + clock(marker.stream),
          marker.recording !== null && 'recording ' + clock(marker.recording)
        ].filter(Boolean);
        const done = [marker.twitch && 'Twitch', marker.chapter && 'recording chapter'].filter(Boolean);
        return (
          `${name} at ${where.join(', ')}` +
          (done.length ? ' (added to ' + done.join(' and ') + ')' : '') +
          '.'
        );
      } finally {
        busy = false;
      }
    }
    window.streamMarkers = {
      add,
      list: () => session.markers.slice(),
      session: () => ({ ...session, markers: session.markers.slice() })
    };

    // Mark button, next to Clip.
    const clip = document.getElementById('obsClip');
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'streamMark';
    button.textContent = 'Mark';
    button.title = 'Mark this moment (Twitch stream marker, recording chapter and the post-stream report)';
    button.onclick = async () => {
      button.disabled = true;
      try {
        note(await add());
      } catch (e) {
        note(e.message);
      } finally {
        button.disabled = false;
      }
    };
    if (clip) clip.after(button);
    setInterval(() => {
      button.hidden = !(live() || window.obsOutputs?.record?.outputActive);
    }, 1000);
    button.hidden = true;
  })().catch(() => {});
})();
