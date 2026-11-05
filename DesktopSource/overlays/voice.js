'use strict';
// Chat voice: plays the speech files the app makes for chat messages, one after another, at the volume the app
// asked for. Speech from before this page was opened is not replayed. It shows nothing; add it to OBS as a
// browser source and OBS gives it its own volume slider (turn on "Control audio via OBS").
(() => {
  let last = null,
    playing = false;
  const queue = [];
  async function next() {
    if (playing || !queue.length) return;
    playing = true;
    const item = queue.shift();
    try {
      const audio = new Audio('voice-' + encodeURIComponent(item.id) + '.wav');
      audio.volume = Math.min(1, Math.max(0, Number(item.volume)));
      await new Promise(resolve => {
        audio.onended = audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    } catch {}
    playing = false;
    next();
  }
  async function poll() {
    try {
      const data = await (await fetch('voice.json', { cache: 'no-store' })).json();
      const items = Array.isArray(data.items) ? data.items : [];
      const newest = Math.max(0, ...items.map(i => i.seq));
      if (last === null) last = newest;
      for (const item of items.filter(i => i.seq > last).sort((a, b) => a.seq - b.seq)) queue.push(item);
      last = Math.max(last, newest);
      next();
    } catch {}
  }
  poll();
  setInterval(poll, 500);
})();
