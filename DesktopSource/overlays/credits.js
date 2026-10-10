'use strict';
// End credits overlay: polls data.json and rolls the names up the screen at the chosen speed, looping (or once).
// "Roll credits now" in the app (rollAt) starts the roll again from the bottom.
(() => {
  const roll = document.getElementById('roll');
  let signature = '',
    rollAt = 0,
    startedAt = performance.now(),
    data = null;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function render(c) {
    const parts = [el('h1', c.title)];
    if (c.subtitle) parts.push(el('p', c.subtitle, 'subtitle'));
    for (const s of c.sections.filter(s => s.names.length)) {
      parts.push(el('h2', s.title));
      for (const n of s.names) parts.push(el('div', n, 'name'));
    }
    if (!c.sections.some(s => s.names.length)) parts.push(el('p', 'and everyone who watched', 'subtitle'));
    parts.push(el('div', '', 'end'));
    roll.replaceChildren(...parts);
  }
  async function poll() {
    try {
      const r = await fetch('data.json', { cache: 'no-store' });
      data = await r.json();
      const c = data.credits;
      const next = JSON.stringify([c.title, c.subtitle, c.sections]);
      if (next !== signature) {
        signature = next;
        render(c);
      }
      if (c.rollAt !== rollAt) {
        rollAt = c.rollAt;
        startedAt = performance.now();
      }
    } catch {}
  }
  function frame(now) {
    if (data) {
      const c = data.credits,
        h = innerHeight,
        total = roll.offsetHeight + h;
      let travelled = ((now - startedAt) / 1000) * c.speed * (h / 1080);
      if (c.loop) travelled %= total;
      else travelled = Math.min(travelled, total - h * 0.5);
      roll.style.transform = `translateY(${h - travelled}px)`;
    }
    requestAnimationFrame(frame);
  }
  poll();
  setInterval(poll, 2000);
  requestAnimationFrame(frame);
})();
