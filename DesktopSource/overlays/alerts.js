'use strict';
// Alerts overlay: polls data.json and shows each new alert (follow, sub, gift, raid, tip…) as a card with a chime,
// one at a time. Alerts that happened before the overlay was opened are not replayed.
(() => {
  const stage = document.getElementById('stage');
  let lastSeq = null,
    config = { sound: true, seconds: 6 },
    busy = false,
    audio = null;
  const queue = [];
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function chime() {
    if (!config.sound) return;
    try {
      audio ||= new AudioContext();
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = audio.createOscillator(),
          g = audio.createGain(),
          t = audio.currentTime + i * 0.12;
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.55);
      });
    } catch {}
  }
  async function next() {
    if (busy || !queue.length) return;
    busy = true;
    const a = queue.shift();
    const card = el('div', null, 'alert-card');
    card.append(el('div', a.title, 'title'), el('div', a.name, 'name'));
    if (a.detail) card.append(el('div', a.detail, 'detail'));
    stage.replaceChildren(card);
    chime();
    await new Promise(r => setTimeout(r, config.seconds * 1000));
    card.classList.add('out');
    await new Promise(r => setTimeout(r, 450));
    card.remove();
    busy = false;
    next();
  }
  async function poll() {
    try {
      const data = await (await fetch('data.json', { cache: 'no-store' })).json();
      config = data.config;
      const newest = Math.max(0, ...data.alerts.map(a => a.seq));
      if (lastSeq === null) lastSeq = newest;
      for (const a of data.alerts.filter(a => a.seq > lastSeq).sort((x, y) => x.seq - y.seq)) queue.push(a);
      lastSeq = Math.max(lastSeq, newest);
      next();
    } catch {}
  }
  poll();
  setInterval(poll, 1000);
})();
