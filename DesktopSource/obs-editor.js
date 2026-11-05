'use strict';
// OBS scene editor (1.2.0): edit an OBS scene on screen, like OBS's own preview. The scene's picture comes from
// OBS (a screenshot of the scene, refreshed while the editor is open) and each source gets OBS's red box: drag to
// move, 8 handles to resize (corners keep proportions; Shift resizes freely), Alt+drag a handle to crop, snapping
// to the screen edges, centre and other sources (Ctrl places freely), arrow keys to nudge, a right-click menu (Fit,
// Stretch, Centre, Rotate 90°, Flip, Reset, order, Hide, Lock) and Ctrl+Z. Every change is made in OBS itself
// (SetSceneItemTransform), so OBS shows the same. Locked sources (OBS's own lock) cannot be moved.
//
// Geometry follows OBS (libobs obs-scene.c, update_item_transform): a source is `W × H` (its size after crop, times
// its scale; or its bounding box when it has one), placed so that its alignment point (a corner, an edge middle or
// the centre) is at `position`, rotated about that point. Negative scale (flip) makes W or H negative.
(() => {
  const LEFT = 1,
    RIGHT = 2,
    TOP = 4,
    BOTTOM = 8;
  const NONE = 'OBS_BOUNDS_NONE';
  const hasBounds = t => !!t.boundsType && t.boundsType !== NONE;
  const cropped = t => ({
    w: Math.max(1, (t.sourceWidth || 0) - (t.cropLeft || 0) - (t.cropRight || 0)),
    h: Math.max(1, (t.sourceHeight || 0) - (t.cropTop || 0) - (t.cropBottom || 0))
  });
  // Signed width and height of the source's box on the canvas.
  function size(t) {
    if (hasBounds(t)) return { W: t.boundsWidth || 1, H: t.boundsHeight || 1 };
    const c = cropped(t);
    return { W: c.w * (t.scaleX ?? 1), H: c.h * (t.scaleY ?? 1) };
  }
  // Where the alignment point is inside the box.
  function origin(alignment = LEFT | TOP, W, H) {
    return {
      x: alignment & LEFT ? 0 : alignment & RIGHT ? W : W / 2,
      y: alignment & TOP ? 0 : alignment & BOTTOM ? H : H / 2
    };
  }
  const rad = d => ((d || 0) * Math.PI) / 180;
  // The four corners on the canvas (top-left, top-right, bottom-right, bottom-left of the source itself).
  function corners(t) {
    const { W, H } = size(t),
      o = origin(t.alignment, W, H),
      a = rad(t.rotation),
      c = Math.cos(a),
      s = Math.sin(a);
    return [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ].map(([u, v]) => {
      const x = u * W - o.x,
        y = v * H - o.y;
      return { x: (t.positionX || 0) + x * c - y * s, y: (t.positionY || 0) + x * s + y * c };
    });
  }
  // The box around it (for rotated sources, the box around the rotated source).
  function rect(t) {
    const p = corners(t),
      xs = p.map(q => q.x),
      ys = p.map(q => q.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }
  const centre = t => {
    const r = rect(t);
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  };
  const straight = t => Math.abs((((t.rotation || 0) % 360) + 360) % 360) < 0.01;

  // The transform that puts an unrotated source exactly on `r` (keeps its flip, alignment and crop).
  function fromRect(t, r) {
    const { W, H } = size(t);
    const sx = hasBounds(t) || W >= 0 ? 1 : -1,
      sy = hasBounds(t) || H >= 0 ? 1 : -1;
    const W2 = (r.right - r.left) * sx,
      H2 = (r.bottom - r.top) * sy,
      o = origin(t.alignment, W2, H2);
    const out = { positionX: r.left - Math.min(0, W2) + o.x, positionY: r.top - Math.min(0, H2) + o.y };
    if (hasBounds(t)) return { ...out, boundsWidth: Math.abs(W2), boundsHeight: Math.abs(H2) };
    const c = cropped(t);
    return { ...out, scaleX: W2 / c.w, scaleY: H2 / c.h };
  }
  // Moves keep everything but the position.
  const move = (t, dx, dy) => ({ positionX: (t.positionX || 0) + dx, positionY: (t.positionY || 0) + dy });

  // Resize by dragging a handle (n, ne, e, se, s, sw, w, nw) by dx, dy canvas pixels. Corners keep the proportions
  // unless `free`. Unrotated sources only.
  const MIN = 2;
  function resize(t, handle, dx, dy, free = false) {
    const r0 = rect(t),
      r = { ...r0 };
    if (handle.includes('w')) r.left = Math.min(r0.right - MIN, r0.left + dx);
    if (handle.includes('e')) r.right = Math.max(r0.left + MIN, r0.right + dx);
    if (handle.includes('n')) r.top = Math.min(r0.bottom - MIN, r0.top + dy);
    if (handle.includes('s')) r.bottom = Math.max(r0.top + MIN, r0.bottom + dy);
    if (!free && handle.length === 2) {
      const w0 = r0.right - r0.left,
        h0 = r0.bottom - r0.top,
        w = r.right - r.left,
        h = r.bottom - r.top;
      // The side that changed most leads; the other follows, with the opposite corner fixed.
      if (Math.abs(w / w0 - 1) >= Math.abs(h / h0 - 1)) {
        const nh = (w * h0) / w0;
        if (handle.includes('n')) r.top = r.bottom - nh;
        else r.bottom = r.top + nh;
      } else {
        const nw = (h * w0) / h0;
        if (handle.includes('w')) r.left = r.right - nw;
        else r.right = r.left + nw;
      }
    }
    return fromRect(t, r);
  }

  // Crop by Alt+dragging a handle: the dragged side moves, the picture stays where it is. Unrotated sources without
  // a bounding box only (OBS crops those the same way).
  function crop(t, handle, dx, dy) {
    const out = {},
      next = { ...t },
      r = rect(t);
    const side = (axis, visual, delta) => {
      const scale = axis === 'x' ? t.scaleX || 1 : t.scaleY || 1;
      // A flipped source shows its right edge on the left.
      const flip = scale < 0;
      const key =
        axis === 'x'
          ? (visual === 'w') !== flip
            ? 'cropLeft'
            : 'cropRight'
          : (visual === 'n') !== flip
            ? 'cropTop'
            : 'cropBottom';
      const other = {
        cropLeft: 'cropRight',
        cropRight: 'cropLeft',
        cropTop: 'cropBottom',
        cropBottom: 'cropTop'
      }[key];
      const full = axis === 'x' ? t.sourceWidth || 0 : t.sourceHeight || 0;
      const inward = visual === 'w' || visual === 'n' ? delta : -delta;
      const before = t[key] || 0;
      const after = Math.round(
        Math.max(0, Math.min(full - (t[other] || 0) - 2, before + inward / Math.abs(scale)))
      );
      const moved = (after - before) * Math.abs(scale);
      if (visual === 'w') r.left += moved;
      if (visual === 'e') r.right -= moved;
      if (visual === 'n') r.top += moved;
      if (visual === 's') r.bottom -= moved;
      out[key] = next[key] = after;
    };
    if (handle.includes('w')) side('x', 'w', dx);
    if (handle.includes('e')) side('x', 'e', dx);
    if (handle.includes('n')) side('y', 'n', dy);
    if (handle.includes('s')) side('y', 's', dy);
    // Same scale, smaller picture: only the position changes.
    const { positionX, positionY } = fromRect(next, r);
    return { ...out, positionX, positionY };
  }

  // Snapping: the moving box's edges and centre snap to these lines when within `range` canvas pixels.
  function lines(items, base, except) {
    const xs = [0, base.width / 2, base.width],
      ys = [0, base.height / 2, base.height];
    for (const i of items) {
      if (i.sceneItemId === except || !i.sceneItemEnabled) continue;
      const r = rect(i.sceneItemTransform);
      xs.push(r.left, r.right, (r.left + r.right) / 2);
      ys.push(r.top, r.bottom, (r.top + r.bottom) / 2);
    }
    return { xs, ys };
  }
  function snapAxis(values, targets, range) {
    let best = null;
    for (const v of values)
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= range && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      }
    return best;
  }
  // How far to shift a moved box so it snaps; and where the guide lines are.
  function snapMove(r, l, range) {
    const x = snapAxis([r.left, (r.left + r.right) / 2, r.right], l.xs, range),
      y = snapAxis([r.top, (r.top + r.bottom) / 2, r.bottom], l.ys, range);
    return { dx: x?.d || 0, dy: y?.d || 0, guides: { x: x ? [x.at] : [], y: y ? [y.at] : [] } };
  }

  // Right-click menu actions → the transform fields to change.
  const ACTIONS = {
    fit(t, base) {
      const r = rect(t),
        w = r.right - r.left,
        h = r.bottom - r.top,
        k = Math.min(base.width / w, base.height / h);
      const nw = w * k,
        nh = h * k,
        left = (base.width - nw) / 2,
        top = (base.height - nh) / 2;
      return fromRect(t, { left, top, right: left + nw, bottom: top + nh });
    },
    stretch: (t, base) => fromRect(t, { left: 0, top: 0, right: base.width, bottom: base.height }),
    centre(t, base) {
      const c = centre(t);
      return move(t, base.width / 2 - c.x, base.height / 2 - c.y);
    },
    centreH(t, base) {
      return move(t, base.width / 2 - centre(t).x, 0);
    },
    centreV(t, base) {
      return move(t, 0, base.height / 2 - centre(t).y);
    },
    // Rotate or flip about the source's centre, as OBS does.
    rotate: (t, base, deg) => keepCentre(t, { rotation: ((((t.rotation || 0) + deg) % 360) + 360) % 360 }),
    flipH: t => keepCentre(t, { scaleX: -(t.scaleX ?? 1) }),
    flipV: t => keepCentre(t, { scaleY: -(t.scaleY ?? 1) }),
    reset: () => ({
      positionX: 0,
      positionY: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
      alignment: LEFT | TOP,
      boundsType: NONE
    })
  };
  function keepCentre(t, change) {
    const before = centre(t),
      after = centre({ ...t, ...change });
    return { ...change, ...move(t, before.x - after.x, before.y - after.y) };
  }
  // The fields OBS accepts back (SetSceneItemTransform), e.g. to undo.
  const FIELDS = [
    'positionX',
    'positionY',
    'rotation',
    'scaleX',
    'scaleY',
    'alignment',
    'boundsType',
    'boundsAlignment',
    'boundsWidth',
    'boundsHeight',
    'cropLeft',
    'cropRight',
    'cropTop',
    'cropBottom'
  ];
  function editable(t) {
    const out = {};
    for (const k of FIELDS) if (t[k] !== undefined) out[k] = t[k];
    // OBS refuses a bounding box below 1 × 1, even when there is none.
    if (!(out.boundsWidth >= 1)) delete out.boundsWidth;
    if (!(out.boundsHeight >= 1)) delete out.boundsHeight;
    return out;
  }

  const api = {
    size,
    origin,
    corners,
    rect,
    centre,
    straight,
    fromRect,
    move,
    resize,
    crop,
    lines,
    snapMove,
    ACTIONS,
    editable,
    FIELDS
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.obsEditorGeometry = api;

  (async () => {
    await window.portalReady;
    if (document.body.dataset.ready !== 'true')
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    if (!bridge?.obs) return;
    const $ = id => document.getElementById(id);
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const btn = (text, fn, cls) => {
      const b = el('button', text, cls);
      b.type = 'button';
      b.onclick = fn;
      return b;
    };
    const call = (op, input = {}) => bridge.obs(op, { ...input, serverKey: selected()?.key });

    let scene = '',
      base = { width: 1920, height: 1080 },
      items = [],
      chosen = null,
      drag = null,
      undo = [],
      open = false,
      stateTimer = null,
      imageBusy = false,
      guides = { x: [], y: [] };
    const item = id => items.find(i => i.sceneItemId === id);

    // ---- The window ----
    const dialog = el('dialog', null, 'obs-editor');
    dialog.id = 'obsEditor';
    dialog.setAttribute('aria-label', 'Edit OBS scene on screen');
    const sceneSelect = el('select');
    sceneSelect.id = 'obsEditorScene';
    sceneSelect.setAttribute('aria-label', 'OBS scene');
    const undoButton = btn('↶ Undo', () => undoLast());
    undoButton.id = 'obsEditorUndo';
    const head = el('div', null, 'obs-editor-head');
    head.append(
      el('h2', 'Edit OBS scene'),
      sceneSelect,
      undoButton,
      btn('Close', () => dialog.close())
    );
    const stage = el('div', null, 'obs-editor-stage');
    stage.id = 'obsEditorStage';
    stage.tabIndex = 0;
    stage.setAttribute(
      'aria-label',
      'OBS scene. Drag sources to move them; arrow keys nudge the selected source.'
    );
    const image = el('img');
    image.id = 'obsEditorImage';
    image.alt = '';
    image.draggable = false;
    const boxes = el('div', null, 'obs-editor-boxes');
    stage.append(image, boxes);
    const list = el('div', null, 'obs-editor-list');
    list.id = 'obsEditorList';
    const info = el('p', null, 'obs-editor-info');
    info.id = 'obsEditorInfo';
    info.setAttribute('role', 'status');
    const side = el('div', null, 'obs-editor-side');
    side.append(
      el('h3', 'Sources'),
      list,
      info,
      el(
        'p',
        'Drag to move. Corners keep the shape; hold Shift to stretch. Alt+drag a handle to crop. Ctrl turns snapping off. Arrow keys nudge (Shift: 10 px). Right-click for Fit, Centre, Rotate, Flip and more. Ctrl+Z undoes.',
        'hint'
      )
    );
    const main = el('div', null, 'obs-editor-main');
    main.append(stage, side);
    const menu = el('div', null, 'obs-editor-menu');
    menu.id = 'obsEditorMenu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    dialog.append(head, main, menu);
    document.body.append(dialog);

    function say(text) {
      info.textContent = text;
    }
    function describe() {
      const i = item(chosen);
      if (!i) return say('Click a source to select it.');
      const t = i.sceneItemTransform,
        r = rect(t),
        crops = ['cropLeft', 'cropRight', 'cropTop', 'cropBottom'].map(k => t[k] || 0);
      say(
        `${i.sourceName}: ${Math.round(r.left)}, ${Math.round(r.top)} · ${Math.round(r.right - r.left)} × ${Math.round(
          r.bottom - r.top
        )}` +
          (t.rotation ? ` · rotated ${Math.round(t.rotation)}°` : '') +
          (crops.some(Boolean) ? ` · crop ${crops.join('/')}` : '') +
          (i.sceneItemLocked ? ' · 🔒 locked: unlock it (🔓) to move or resize it' : '') +
          (!straight(t) && !i.sceneItemLocked
            ? ' · rotated: drag to move; Rotate in the menu or Reset to resize'
            : '')
      );
    }

    // ---- Drawing the boxes ----
    const scale = () => stage.clientWidth / base.width;
    function paint() {
      const k = scale();
      boxes.replaceChildren();
      for (const i of items) {
        if (!i.sceneItemEnabled) continue;
        const t = i.sceneItemTransform || {},
          { W, H } = size(t),
          o = origin(t.alignment, W, H);
        const box = el('div', null, 'obs-ebox');
        box.dataset.id = String(i.sceneItemId);
        box.classList.toggle('selected', i.sceneItemId === chosen);
        box.classList.toggle('locked', !!i.sceneItemLocked);
        box.title = i.sourceName;
        const left = (t.positionX || 0) - o.x + Math.min(0, W),
          top = (t.positionY || 0) - o.y + Math.min(0, H);
        box.style.left = left * k + 'px';
        box.style.top = top * k + 'px';
        box.style.width = Math.abs(W) * k + 'px';
        box.style.height = Math.abs(H) * k + 'px';
        box.style.transformOrigin = `${(o.x - Math.min(0, W)) * k}px ${(o.y - Math.min(0, H)) * k}px`;
        box.style.transform = `rotate(${t.rotation || 0}deg)`;
        if (i.sceneItemId === chosen && !i.sceneItemLocked && straight(t))
          for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
            const handle = el('span', null, 'obs-ehandle ' + h);
            handle.dataset.handle = h;
            box.append(handle);
          }
        boxes.append(box);
      }
      for (const [axis, values] of Object.entries(guides))
        for (const v of values) {
          const g = el('div', null, 'obs-eguide ' + axis);
          if (axis === 'x') g.style.left = v * k + 'px';
          else g.style.top = v * k + 'px';
          boxes.append(g);
        }
      paintList();
      describe();
      undoButton.disabled = !undo.length;
    }
    function paintList() {
      list.replaceChildren(
        ...[...items].reverse().map(i => {
          const row = el('div', null, 'obs-editor-row');
          const pick = btn(i.sourceName, () => {
            chosen = i.sceneItemId;
            paint();
            stage.focus();
          });
          pick.setAttribute('aria-pressed', String(i.sceneItemId === chosen));
          const eye = btn(i.sceneItemEnabled ? '👁' : '—', () =>
            act(() =>
              call('source-visible', { sceneName: scene, id: i.sceneItemId, enabled: !i.sceneItemEnabled })
            )
          );
          eye.setAttribute('aria-label', (i.sceneItemEnabled ? 'Hide ' : 'Show ') + i.sourceName);
          const lock = btn(i.sceneItemLocked ? '🔒' : '🔓', () =>
            act(() =>
              call('source-lock', { sceneName: scene, id: i.sceneItemId, locked: !i.sceneItemLocked })
            )
          );
          lock.setAttribute('aria-label', (i.sceneItemLocked ? 'Unlock ' : 'Lock ') + i.sourceName);
          row.append(pick, eye, lock);
          return row;
        })
      );
    }

    // ---- Talking to OBS ----
    async function load() {
      // Not while a change is on its way to OBS: the answer could be from before it. Each change also makes any
      // reading already under way out of date (`epoch`), so an older answer never undoes a newer change.
      if (!open || drag || sending) return;
      const mine = ++epoch;
      try {
        const r = await call('editor-state', { sceneName: scene });
        if (mine !== epoch || drag || sending || r.sceneName !== scene) return;
        base = r.base?.width ? r.base : base;
        items = r.items || [];
        stage.style.aspectRatio = base.width + ' / ' + base.height;
        // As wide as fits, and never taller than the window: the boxes are placed on the stage's width.
        stage.style.width = `min(100%, calc((100vh - 150px) * ${base.width / base.height}))`;
        if (chosen !== null && !item(chosen)) chosen = null;
        // Only redraw when OBS reports something new (boxes being hovered or grabbed stay put).
        const sig = JSON.stringify([base, items, chosen]);
        if (sig !== lastLoaded) {
          lastLoaded = sig;
          paint();
        }
      } catch (e) {
        say(e.message);
      }
    }
    async function picture() {
      if (!open || imageBusy) return;
      imageBusy = true;
      try {
        const width = Math.min(1920, Math.max(320, Math.round(stage.clientWidth * (devicePixelRatio || 1))));
        const r = await call('scene-image', { sceneName: scene, width });
        if (open && r?.image) image.src = r.image;
      } catch {
      } finally {
        imageBusy = false;
        if (open) setTimeout(picture, 150);
      }
    }
    // Changes during a drag go to OBS at most every 80 ms; the latest wins.
    let sending = null,
      queued = null,
      epoch = 0,
      lastLoaded = '';
    function send(id, transform) {
      epoch++;
      queued = { id, transform: { ...(queued?.id === id ? queued.transform : {}), ...transform } };
      if (!sending) sending = flush();
      return sending;
    }
    async function flush() {
      try {
        while (queued) {
          const next = queued;
          queued = null;
          await call('item-transform', { sceneName: scene, id: next.id, transform: next.transform });
          await new Promise(r => setTimeout(r, 80));
        }
      } catch (e) {
        say(e.message);
        note(e.message);
        queued = null;
      } finally {
        sending = null;
      }
    }
    // A change from a menu, a key or undo: shown at once, sent, remembered for Ctrl+Z.
    async function change(id, fields, remember = true) {
      const i = item(id);
      if (!i) return;
      if (i.sceneItemLocked) return say(i.sourceName + ' is locked. Unlock it (🔓) to change it.');
      if (remember) remember_(id, i.sceneItemTransform);
      i.sceneItemTransform = { ...i.sceneItemTransform, ...fields };
      paint();
      await send(id, fields);
      await load();
    }
    function remember_(id, t) {
      undo.push({ scene, id, before: editable(t) });
      if (undo.length > 50) undo.shift();
    }
    async function undoLast() {
      const u = undo.pop();
      if (!u) return;
      if (u.scene !== scene) {
        scene = u.scene;
        sceneSelect.value = scene;
      }
      epoch++;
      const i = item(u.id);
      if (i) {
        i.sceneItemTransform = { ...i.sceneItemTransform, ...u.before };
        paint();
      }
      try {
        await call('item-transform', { sceneName: u.scene, id: u.id, transform: u.before });
      } catch (e) {
        say(e.message);
      }
      await load();
    }
    async function act(fn) {
      try {
        await fn();
      } catch (e) {
        say(e.message);
      }
      await load();
    }

    // ---- Mouse ----
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      menu.hidden = true;
      const handle = e.target.closest('.obs-ehandle'),
        box = e.target.closest('.obs-ebox');
      if (!box) {
        chosen = null;
        paint();
        return;
      }
      const id = Number(box.dataset.id),
        i = item(id);
      chosen = id;
      stage.focus();
      if (i.sceneItemLocked) {
        paint();
        return say(i.sourceName + ' is locked. Unlock it (🔓) to move it.');
      }
      const t0 = { ...i.sceneItemTransform };
      let kind = handle ? (e.altKey ? 'crop' : 'resize') : 'move';
      if (kind === 'crop' && t0.boundsType && t0.boundsType !== 'OBS_BOUNDS_NONE') kind = 'resize';
      drag = { id, kind, handle: handle?.dataset.handle, x: e.clientX, y: e.clientY, t0, changed: false };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      paint();
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const k = scale(),
        dx = (e.clientX - drag.x) / k,
        dy = (e.clientY - drag.y) / k;
      if (!drag.changed && Math.abs(dx) * k < 2 && Math.abs(dy) * k < 2) return;
      drag.changed = true;
      let fields;
      guides = { x: [], y: [] };
      if (drag.kind === 'move') {
        fields = move(drag.t0, dx, dy);
        if (!e.ctrlKey) {
          const s = snapMove(rect({ ...drag.t0, ...fields }), lines(items, base, drag.id), 8 / k);
          fields = move(drag.t0, dx + s.dx, dy + s.dy);
          guides = s.guides;
        }
      } else if (drag.kind === 'resize') fields = resize(drag.t0, drag.handle, dx, dy, e.shiftKey);
      else fields = crop(drag.t0, drag.handle, dx, dy);
      const i = item(drag.id);
      i.sceneItemTransform = { ...drag.t0, ...fields };
      paint();
      void send(drag.id, fields);
    });
    const end = async () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      guides = { x: [], y: [] };
      if (d.changed) remember_(d.id, d.t0);
      paint();
      await sending;
      await load();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // ---- Right-click menu ----
    stage.addEventListener('contextmenu', e => {
      e.preventDefault();
      const box = e.target.closest('.obs-ebox');
      if (!box) return (menu.hidden = true);
      chosen = Number(box.dataset.id);
      paint();
      const i = item(chosen),
        t = i.sceneItemTransform,
        locked = !!i.sceneItemLocked;
      const entry = (text, fn, disabled = false) => {
        const b = btn(text, async () => {
          menu.hidden = true;
          // Keys (arrows, Ctrl+Z) keep working after a menu choice.
          stage.focus();
          await fn();
        });
        b.setAttribute('role', 'menuitem');
        b.disabled = disabled;
        return b;
      };
      const tf =
        (name, ...args) =>
        () =>
          change(i.sceneItemId, ACTIONS[name](t, base, ...args));
      const index = i.sceneItemIndex;
      menu.replaceChildren(
        entry('Fit to screen', tf('fit'), locked || !straight(t)),
        entry('Stretch to screen', tf('stretch'), locked || !straight(t)),
        entry('Centre', tf('centre'), locked),
        entry('Centre horizontally', tf('centreH'), locked),
        entry('Centre vertically', tf('centreV'), locked),
        el('hr'),
        entry('Rotate 90° clockwise', tf('rotate', 90), locked),
        entry('Rotate 90° anticlockwise', tf('rotate', -90), locked),
        entry('Rotate 180°', tf('rotate', 180), locked),
        entry('Flip horizontally', tf('flipH'), locked),
        entry('Flip vertically', tf('flipV'), locked),
        entry('Reset transform', tf('reset'), locked),
        el('hr'),
        entry(
          'Bring forward',
          () => act(() => call('source-order', { sceneName: scene, id: i.sceneItemId, index: index + 1 })),
          index >= items.length - 1
        ),
        entry(
          'Send backward',
          () => act(() => call('source-order', { sceneName: scene, id: i.sceneItemId, index: index - 1 })),
          index <= 0
        ),
        entry('Hide', () =>
          act(() => call('source-visible', { sceneName: scene, id: i.sceneItemId, enabled: false }))
        ),
        entry(locked ? 'Unlock' : 'Lock', () =>
          act(() => call('source-lock', { sceneName: scene, id: i.sceneItemId, locked: !locked }))
        )
      );
      // Next to the pointer, kept on screen.
      menu.hidden = false;
      menu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
      menu.querySelector('button:not([disabled])')?.focus();
    });
    dialog.addEventListener('pointerdown', e => {
      if (!menu.contains(e.target) && !stage.contains(e.target)) menu.hidden = true;
    });

    // ---- Keys ----
    dialog.addEventListener('keydown', e => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undoLast();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
        e.key
      ];
      const i = item(chosen);
      if (!d || !i) return;
      e.preventDefault();
      void change(chosen, move(i.sceneItemTransform, ...d));
    });

    // ---- Opening ----
    sceneSelect.onchange = () => {
      scene = sceneSelect.value;
      chosen = null;
      lastLoaded = '';
      void load();
    };
    new ResizeObserver(() => open && paint()).observe(stage);
    dialog.addEventListener('close', () => {
      open = false;
      menu.hidden = true;
      clearInterval(stateTimer);
    });
    window.openObsSceneEditor = async sceneName => {
      if (!window.obsConnected) return note('Connect OBS first (Settings → OBS).');
      let scenes = [];
      try {
        scenes = (await call('snapshot')).scenes?.map(s => s.sceneName) || [];
      } catch (e) {
        return note(e.message);
      }
      scene =
        sceneName && scenes.includes(sceneName)
          ? sceneName
          : scene && scenes.includes(scene)
            ? scene
            : scenes[0];
      if (!scene) return note('OBS has no scenes yet.');
      sceneSelect.replaceChildren(...scenes.map(n => new Option(n, n)));
      sceneSelect.value = scene;
      open = true;
      if (!dialog.open) dialog.showModal();
      await load();
      void picture();
      clearInterval(stateTimer);
      stateTimer = setInterval(load, 700);
      stage.focus();
    };
    // OBS sources panel: open the editor on the scene being edited there.
    const panelButton = btn('Edit on screen…', () => window.openObsSceneEditor($('obsEditScene')?.value));
    panelButton.id = 'obsEditOnScreen';
    $('obsEditScene')?.closest('label')?.after(panelButton);
  })().catch(() => {});
})();
