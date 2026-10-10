'use strict';
// Destination alerts (1.2.0). During a live broadcast, when a destination (YouTube, Twitch, Kick or a custom one)
// stops receiving the stream for 20 seconds, the app plays an alert sound and says so in the notice line and the
// Destination health card. When it is receiving again it says so with a softer sound. Paused outputs (paused on
// purpose) do not alert. "Alert sound" in the Destination health card turns the sound off.
(() => {
  const AFTER = 20000;
  const REASON = {
    connecting: 'is still connecting',
    reconnecting: 'is reconnecting',
    stalled: 'has stalled',
    failed: 'has failed'
  };

  // Pure state step, testable in Node: outputs now, the time, and what is known so far. Returns the alerts to raise.
  function step(outputs, now, known) {
    const events = [];
    const seen = new Set();
    for (const o of outputs) {
      seen.add(o.id);
      const k = known.get(o.id) || { since: 0, alerted: false };
      if (o.state === 'sending') {
        if (k.alerted) events.push({ type: 'back', output: o });
        known.set(o.id, { since: 0, alerted: false, name: o.name });
        continue;
      }
      if (o.state === 'paused') {
        known.set(o.id, { since: 0, alerted: false, name: o.name });
        continue;
      }
      const since = k.since || now;
      let alerted = k.alerted;
      if (!alerted && now - since >= AFTER) {
        alerted = true;
        events.push({ type: 'down', output: o });
      }
      known.set(o.id, { since, alerted, name: o.name });
    }
    // No longer reported (removed from the broadcast): forget it.
    for (const id of known.keys()) if (!seen.has(id)) known.delete(id);
    return events;
  }
  const text = e =>
    e.type === 'back'
      ? `${e.output.name} is receiving your stream again.`
      : `${e.output.name} stopped receiving your stream: it ${REASON[e.output.state] || 'is not receiving'}. The relay keeps retrying; you can restart it from Destination health.`;

  const api = { step, text, AFTER };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.destinationAlerts = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const KEY = 'uc-destination-alert-sound';
    let sound = true;
    try {
      sound = localStorage.getItem(KEY) !== 'false';
    } catch {}
    const box = document.createElement('div');
    box.id = 'destinationAlerts';
    const line = document.createElement('p');
    line.className = 'quality-warning';
    line.setAttribute('role', 'alert');
    line.hidden = true;
    const toggle = document.createElement('label');
    toggle.className = 'destination-alert-sound';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'destinationAlertSound';
    check.checked = sound;
    toggle.append(check, ' Alert sound when a destination drops');
    check.onchange = () => {
      sound = check.checked;
      try {
        localStorage.setItem(KEY, String(sound));
      } catch {}
    };
    box.append(line, toggle);

    let audio = null;
    // Two falling tones for a drop, two rising ones when it is back. Made with Web Audio (no sound files).
    function beep(down) {
      if (!sound) return;
      try {
        audio ||= new AudioContext();
        const tones = down ? [880, 660] : [660, 880];
        tones.forEach((f, i) => {
          const o = audio.createOscillator(),
            g = audio.createGain(),
            t = audio.currentTime + i * 0.18;
          o.frequency.value = f;
          o.type = 'sine';
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(down ? 0.25 : 0.12, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          o.connect(g).connect(audio.destination);
          o.start(t);
          o.stop(t + 0.17);
        });
        window.destinationAlertBeeps = (window.destinationAlertBeeps || 0) + 1;
      } catch {}
    }

    const known = new Map();
    const down = new Map();
    function tick() {
      const card = document.getElementById('destinationHealthCard');
      if (card && box.parentElement !== card) card.append(box);
      const live = connected && !uncertain && !!view?.status?.broadcast;
      if (!live) {
        known.clear();
        down.clear();
        line.hidden = true;
        return;
      }
      const outputs = view?.status?.outputs || [];
      for (const id of down.keys()) if (!outputs.some(o => o.id === id)) down.delete(id);
      for (const e of step(outputs, Date.now(), known)) {
        if (e.type === 'down') down.set(e.output.id, e.output.name);
        else down.delete(e.output.id);
        note(text(e));
        beep(e.type === 'down');
      }
      line.hidden = !down.size;
      line.textContent = down.size
        ? '⚠ Not receiving your stream: ' + [...down.values()].join(', ') + '. The relay keeps retrying.'
        : '';
    }
    setInterval(tick, 1000);
  })().catch(() => {});
})();
