'use strict';
// Relay layout editor geometry (1.2.0). Layout items are stored as x, y, width, height between 0 and 1, where x and
// y say where the item sits in the space left beside it (0 = left/top edge, 1 = right/bottom edge). These helpers
// turn that into edges and back, and do the OBS-style editing: 8 resize handles (corners keep the shape, Shift
// stretches), snapping the dragged edges, and Fit / Stretch / Centre. Items always stay inside the frame and at
// least 4 % in each direction.
(() => {
  const MIN = 0.04;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function box(i) {
    const left = i.x * (1 - i.width),
      top = i.y * (1 - i.height);
    return { left, top, right: left + i.width, bottom: top + i.height };
  }
  function fromBox(r) {
    const width = clamp(r.right - r.left, MIN, 1),
      height = clamp(r.bottom - r.top, MIN, 1);
    const left = clamp(r.left, 0, 1 - width),
      top = clamp(r.top, 0, 1 - height);
    return {
      x: width >= 1 ? 0 : clamp(left / (1 - width), 0, 1),
      y: height >= 1 ? 0 : clamp(top / (1 - height), 0, 1),
      width,
      height
    };
  }
  // Drag handle `h` (n, ne, e, se, s, sw, w, nw) by dx, dy (fractions of the frame). Keeping the shape keeps
  // width / height as fractions, which keeps the item's real (pixel) proportions.
  function resize(before, h, dx, dy, { free = false } = {}) {
    const b = box(before),
      r = { ...b };
    if (h.includes('w')) r.left = clamp(b.left + dx, 0, b.right - MIN);
    if (h.includes('e')) r.right = clamp(b.right + dx, b.left + MIN, 1);
    if (h.includes('n')) r.top = clamp(b.top + dy, 0, b.bottom - MIN);
    if (h.includes('s')) r.bottom = clamp(b.bottom + dy, b.top + MIN, 1);
    if (!free && h.length === 2) {
      const w0 = b.right - b.left,
        h0 = b.bottom - b.top;
      let w = r.right - r.left,
        hh = r.bottom - r.top;
      // The side that changed most leads; the opposite corner stays put; the frame edge stops both.
      if (Math.abs(w / w0 - 1) >= Math.abs(hh / h0 - 1)) hh = (w * h0) / w0;
      else w = (hh * w0) / h0;
      const maxW = h.includes('w') ? b.right : 1 - b.left,
        maxH = h.includes('n') ? b.bottom : 1 - b.top;
      const k = Math.min(1, maxW / w, maxH / hh);
      w *= k;
      hh *= k;
      if (h.includes('w')) r.left = b.right - w;
      else r.right = b.left + w;
      if (h.includes('n')) r.top = b.bottom - hh;
      else r.bottom = b.top + hh;
    }
    return fromBox(r);
  }
  // Snap the dragged edges to the lines (fractions) within `range`; returns the new box and the lines used.
  function snapEdges(r, h, lines, range) {
    const out = { ...r },
      used = { v: [], h: [] };
    const near = (v, ls) => {
      let best = null;
      for (const l of ls)
        if (Math.abs(l - v) <= range && (best === null || Math.abs(l - v) < Math.abs(best - v))) best = l;
      return best;
    };
    for (const [edge, key, axis] of [
      ['w', 'left', 'x'],
      ['e', 'right', 'x'],
      ['n', 'top', 'y'],
      ['s', 'bottom', 'y']
    ]) {
      if (!h.includes(edge)) continue;
      const l = near(out[key], lines[axis]);
      if (l === null) continue;
      out[key] = l;
      used[axis === 'x' ? 'v' : 'h'].push(l);
    }
    if (out.right - out.left < MIN || out.bottom - out.top < MIN) return { box: r, used: { v: [], h: [] } };
    return { box: out, used };
  }
  // Right-click actions. `ratio` is the frame's width / height.
  const ACTIONS = {
    // As large as fits, keeping its proportions, centred.
    fit(i, ratio = 16 / 9) {
      const b = box(i),
        aspect = ((b.right - b.left) * ratio) / (b.bottom - b.top);
      let w = 1,
        h = ratio / aspect;
      if (h > 1) {
        h = 1;
        w = aspect / ratio;
      }
      return { x: 0.5, y: 0.5, width: clamp(w, MIN, 1), height: clamp(h, MIN, 1) };
    },
    stretch: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    centreH: i => ({ x: 0.5, y: i.y, width: i.width, height: i.height }),
    centreV: i => ({ x: i.x, y: 0.5, width: i.width, height: i.height })
  };
  const api = { box, fromBox, resize, snapEdges, ACTIONS, MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.layoutGeometry = api;
})();
