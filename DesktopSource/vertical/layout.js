'use strict';
// Vertical clips (1.2.0): where each part of a horizontal clip goes in the 9:16 copy. Used by the converter page
// (convert.js) and by the tests. Layouts:
// - stack: your facecam on top (the part of the picture where the webcam source is in the OBS scene), gameplay
//   below (the middle of the picture);
// - blur: the whole picture across the middle, over a blurred, darkened copy filling the background;
// - crop: the middle of the picture, full height.
(() => {
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  // The largest part of a w × h picture with the given aspect (width / height), centred on (cx, cy) where possible.
  function window_(w, h, aspect, cx = w / 2, cy = h / 2, maxW = w, maxH = h) {
    let sw = Math.min(maxW, w),
      sh = sw / aspect;
    if (sh > Math.min(maxH, h)) {
      sh = Math.min(maxH, h);
      sw = sh * aspect;
    }
    const sx = Math.min(Math.max(0, cx - sw / 2), w - sw),
      sy = Math.min(Math.max(0, cy - sh / 2), h - sh);
    return { sx, sy, sw, sh };
  }
  // A region (normalised 0–1) widened or heightened to the aspect, kept inside the picture.
  function around(w, h, r, aspect) {
    let rw = Math.max(16, r.w * w),
      rh = Math.max(16, r.h * h);
    if (rw / rh > aspect) rh = rw / aspect;
    else rw = rh * aspect;
    const cx = (r.x + r.w / 2) * w,
      cy = (r.y + r.h / 2) * h;
    return window_(w, h, aspect, cx, cy, rw, rh);
  }
  function plan(layout, vw, vh, { facecam = null, share = 0.35, width = 1080, height = 1920 } = {}) {
    const W = even(width),
      H = even(height),
      draws = [];
    const all = { sx: 0, sy: 0, sw: vw, sh: vh };
    if (layout === 'stack' && facecam && facecam.w > 0 && facecam.h > 0) {
      const top = even(H * Math.min(0.6, Math.max(0.2, share))),
        bottom = H - top;
      draws.push({ ...around(vw, vh, facecam, W / top), dx: 0, dy: 0, dw: W, dh: top });
      draws.push({ ...window_(vw, vh, W / bottom), dx: 0, dy: top, dw: W, dh: bottom });
    } else if (layout === 'crop') {
      draws.push({ ...window_(vw, vh, W / H), dx: 0, dy: 0, dw: W, dh: H });
    } else {
      // Blurred background (also the facecam layout when no webcam is found).
      draws.push({ ...window_(vw, vh, W / H), dx: 0, dy: 0, dw: W, dh: H, blur: true });
      const dh = (W * vh) / vw;
      draws.push({ ...all, dx: 0, dy: (H - dh) / 2, dw: W, dh });
    }
    return { width: W, height: H, draws };
  }
  const api = { plan, around };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.verticalLayout = api;
})();
