'use strict';
// Stream layout editor.
// Merged 1.2.0: private build (live relay video, presets, chat overlays, scenes)
// + rc.8 layout work (offline editing, snapping, corners/2x2 split, text, picture
// and browser sources), with the rc.8 gaps fixed: sources are rendered on the
// relay output, survive connecting/saving/scene switches, never use prompt(),
// and an offline draft is never replaced without asking.
(() => {
  let resolution = null,
    locked = new Set();
  let items = [],
    selection = 'main',
    messages = [],
    chatStatus = {},
    moving = null,
    uploading = false,
    lastSent = '',
    lastAt = 0;
  const OFFLINE_KEY = 'universalcollab-offline-layout-v1',
    MEDIA_KINDS = ['text', 'image', 'browser'];
  const TEXT_DEFAULT = {
    font: 'sans',
    size: 6,
    color: '#ffffff',
    background: '#000000',
    backgroundOpacity: 0,
    align: 'left',
    valign: 'top',
    outline: 0,
    outlineColor: '#000000',
    bold: true,
    italic: false,
    wrap: true,
    shadow: false
  };
  const FONT_FAMILY = {
    sans: '"Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Courier New", monospace',
    rounded: '"Arial Rounded MT Bold", "Segoe UI", sans-serif',
    display: 'Impact, "Arial Black", sans-serif'
  };
  const root = $('layoutPreview'),
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    defaultMain = () => ({ id: 'main', kind: 'main', x: 0, y: 0, width: 1, height: 1, z: -1 });
  const online = () => connected && view?.capabilities?.streamCanvas === 1;
  const mediaRelay = () => online() && view.capabilities.mediaSourcesApi === 1 && capability('mediaSources');
  const isMedia = i => MEDIA_KINDS.includes(i?.kind);
  // Offline, every item can be arranged locally. Online, relay capabilities apply.
  const editable = item =>
    !!item &&
    !locked.has(item.id) &&
    (!online() ||
      item.kind === 'main' ||
      isMedia(item) ||
      capability(item.kind === 'video' ? 'pictureInPicture' : 'chatOverlays'));
  const chosen = () => items.find(i => i.id === selection) || items[0];
  const hostOf = url => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  };
  const title = i =>
    i.kind === 'main'
      ? 'Your main feed'
      : i.kind === 'video'
        ? (view?.peers?.find(p => p.id === i.publisher)?.displayName || i.publisher) + ' POV'
        : i.kind === 'text'
          ? i.name || (i.text || '').split('\n')[0].slice(0, 40) || 'Text'
          : i.kind === 'image'
            ? i.name || 'Picture'
            : i.kind === 'browser'
              ? i.name || hostOf(i.url) || 'Browser page'
              : { twitch: 'Twitch chat', youtube: 'YouTube chat', combined: 'Combined chat' }[i.source];
  const hint = text => {
    $('canvasHint').textContent = text;
  };
  function idleHint() {
    if (!connected) return 'Offline layout — changes save on this device. Connect to a relay to apply them.';
    if (!online()) return 'Offline layout — this relay needs an update before it can use the layout editor.';
    if (layoutDirty)
      return window.studioMode?.enabled
        ? 'Preview has changes that are not live yet — press Transition to send them to the stream.'
        : 'Unsaved changes — Save stream layout & fallback to apply.';
    if (items.some(isMedia) && view.capabilities.mediaSourcesApi !== 1)
      return 'Text, picture and browser sources stay local until this relay is updated to 1.2.0.';
    if (items.some(isMedia) && !capability('mediaSources'))
      return 'This relay host has turned off text, picture and browser sources.';
    return 'Drag to move or resize. Items snap to edges, centres and other items — hold Alt to place freely. Right-click for corners, centre and 2×2 split.';
  }
  function changed() {
    layoutDirty = true;
    window.dispatchEvent(new Event('scene-change'));
    hint(
      online()
        ? window.studioMode?.enabled
          ? 'Preview has changes that are not live yet — press Transition to send them to the stream.'
          : 'Unsaved changes — Save stream layout & fallback to apply.'
        : 'Offline layout — saved on this device automatically.'
    );
    if (!online()) scheduleDraft();
  }

  // ---- item validation (drafts, presets, scenes, relay settings) ----
  const validBox = i =>
    ['x', 'y', 'width', 'height'].every(k => Number.isFinite(i?.[k]) && i[k] >= 0 && i[k] <= 1) &&
    i.width >= 0.04 &&
    i.height >= 0.04;
  const colour = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const within = (v, a, b, d) => (Number.isFinite(v) ? clamp(v, a, b) : d);
  function normalizeMedia(p) {
    if (
      !p ||
      !isMedia(p) ||
      typeof p.id !== 'string' ||
      !new RegExp('^' + p.kind + ':[A-Za-z0-9-]{8,64}$').test(p.id) ||
      !validBox(p)
    )
      return null;
    const out = {
      id: p.id,
      kind: p.kind,
      name: String(p.name || '').slice(0, 80),
      visible: p.visible !== false,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      z: Number.isFinite(p.z) ? p.z : 100
    };
    if (p.kind === 'text') {
      const s = p.style || {};
      out.text = String(p.text || '').slice(0, 1000);
      out.style = {
        font: FONT_FAMILY[s.font] ? s.font : 'sans',
        size: within(s.size, 1, 40, TEXT_DEFAULT.size),
        color: colour(s.color, '#ffffff'),
        background: colour(s.background, '#000000'),
        backgroundOpacity: within(s.backgroundOpacity, 0, 100, 0),
        align: ['left', 'center', 'right'].includes(s.align) ? s.align : 'left',
        valign: ['top', 'middle', 'bottom'].includes(s.valign) ? s.valign : 'top',
        outline: within(s.outline, 0, 20, 0),
        outlineColor: colour(s.outlineColor, '#000000'),
        bold: s.bold !== false,
        italic: !!s.italic,
        wrap: s.wrap !== false,
        shadow: !!s.shadow
      };
    }
    if (p.kind === 'image') {
      out.media = /^[a-f0-9]{64}$/.test(p.media || '') ? p.media : '';
      out.fit = ['contain', 'cover', 'stretch'].includes(p.fit) ? p.fit : 'contain';
      out.opacity = within(p.opacity, 0, 100, 100);
    }
    if (p.kind === 'browser') {
      if (!/^https?:\/\/[^\s]+$/i.test(p.url || '') || p.url.length > 2048) return null;
      out.url = p.url;
      out.pageWidth = Number.isInteger(p.pageWidth) ? clamp(p.pageWidth, 320, 3840) : 1280;
    }
    return out;
  }
  function validItem(i) {
    if (!i || !validBox(i)) return null;
    if (i.kind === 'main') return { ...defaultMain(), ...i, id: 'main', kind: 'main' };
    if (i.kind === 'video' && typeof i.publisher === 'string') return { ...i, id: 'video:' + i.publisher };
    if (i.kind === 'chat' && ['twitch', 'youtube', 'combined'].includes(i.source))
      return { ...i, id: 'chat:' + i.source };
    return normalizeMedia(i);
  }
  const approved = (peer, kind) =>
    !!view &&
    view.requests.some(
      r => r.owner === view.me.id && r.peer === peer && r.kind === kind && r.status === 'approved'
    ) &&
    view.peers.some(p => p.id === peer);
  // When connected, POVs need current approval; offline they are kept for later.
  const usable = i =>
    i.kind !== 'video' || !online() || (capability('pictureInPicture') && approved(i.publisher, 'video'));
  function setItems(list) {
    const clean = [],
      used = new Set();
    for (const raw of list || []) {
      const i = validItem(raw);
      if (!i || used.has(i.id)) continue;
      used.add(i.id);
      clean.push(i);
    }
    items = [clean.find(i => i.kind === 'main') || defaultMain(), ...clean.filter(i => i.kind !== 'main')];
    return used;
  }

  // ---- offline draft ----
  let draftTimer = 0,
    choosing = false;
  function readDraft() {
    try {
      const v = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null');
      return v && Array.isArray(v.items) ? v : null;
    } catch {
      return null;
    }
  }
  function writeDraft(pending) {
    clearTimeout(draftTimer);
    try {
      localStorage.setItem(
        OFFLINE_KEY,
        JSON.stringify({
          version: 2,
          resolution,
          items,
          locked: [...locked],
          pending: !!pending,
          updated: Date.now()
        })
      );
      return true;
    } catch {
      note('Could not save the offline layout on this device.');
      return false;
    }
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => writeDraft(true), 400);
  }
  function applyDraft(d) {
    resolution = d.resolution || null;
    const used = setItems(d.items);
    locked = new Set((d.locked || []).filter(id => used.has(id)));
    selection = items.some(i => i.id === selection) ? selection : 'main';
    paint();
    availability();
  }
  const choice = document.createElement('dialog');
  choice.id = 'offlineLayoutChoice';
  choice.className = 'floating-window';
  function offerDraft(draft, settings) {
    choosing = true;
    choice.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'Use your offline layout?';
    const p = document.createElement('p');
    p.textContent =
      'You changed your stream layout while offline' +
      (draft.updated ? ' (' + new Date(draft.updated).toLocaleString() + ')' : '') +
      '. Nothing has been sent to this relay yet.';
    const done = () => {
      choosing = false;
      if (choice.open) choice.close();
    };
    const apply = button('Apply my offline layout', async () => {
      done();
      applyDraft(draft);
      for (const i of items.filter(i => !usable(i))) items.splice(items.indexOf(i), 1);
      layoutDirty = true;
      paint();
      if (!(await save()))
        hint('Your offline layout is loaded but not applied yet. Check the message, then Save.');
    });
    const relay = button('Use the relay’s layout', () => {
      done();
      keepAsPreset(draft);
      writeDraft(false);
      layoutDirty = false;
      load(settings);
    });
    const later = button('Decide later', () => {
      done();
      applyDraft(draft);
      layoutDirty = true;
      hint(
        'Offline layout kept on this device. Save stream layout & fallback when you want it on this relay.'
      );
    });
    apply.className = 'primary';
    choice.oncancel = e => {
      e.preventDefault();
      later.click();
    };
    const note2 = document.createElement('p');
    note2.className = 'hint';
    note2.textContent = 'Use the relay’s layout keeps your offline version as a stream layout preset.';
    const row = document.createElement('div');
    row.className = 'buttons';
    row.append(apply, relay, later);
    choice.append(h, p, row, note2);
    if (!choice.isConnected) document.body.append(choice);
    try {
      choice.showModal();
    } catch {
      choice.show();
    }
  }

  function load(settings) {
    if (online() && !choosing) {
      const d = readDraft();
      if (d?.pending && d.items.length) {
        offerDraft(d, settings);
        return;
      }
    }
    if (choosing) return;
    const localOnly = mediaRelay() ? [] : items.filter(isMedia);
    resolution = settings.resolution || null;
    const list = [{ ...defaultMain(), ...(settings.main || {}) }];
    for (const [n, p] of (settings.overlays || []).entries())
      list.push({
        id: 'video:' + p.publisher,
        kind: 'video',
        visible: p.visible !== false,
        publisher: p.publisher,
        corner: p.corner || 'top-right',
        x: p.x ?? (p.corner?.endsWith('left') ? 0.027 : 0.973),
        y: p.y ?? (p.corner?.startsWith('bottom') ? 0.973 : 0.027),
        width: p.width ?? (view?.status?.overlayWidthPercent || 25) / 100,
        height: p.height ?? (view?.status?.overlayWidthPercent || 25) / 100,
        z: p.z ?? n
      });
    for (const [n, p] of (settings.chatOverlays || []).entries())
      list.push({ id: 'chat:' + p.source, kind: 'chat', ...p, z: p.z ?? 100 + n });
    for (const [n, p] of (settings.mediaOverlays || []).entries()) list.push({ ...p, z: p.z ?? 200 + n });
    for (const i of localOnly) if (!list.some(x => x.id === i.id)) list.push(i);
    setItems(list);
    locked = new Set([...locked].filter(id => items.some(i => i.id === id)));
    selection = items.some(i => i.id === selection) ? selection : 'main';
    lastSent = '';
    paint();
    availability();
    if (online()) writeDraft(false);
  }
  function availability() {
    const old = $('canvasSource').value,
      select = $('canvasSource');
    select.replaceChildren(new Option('Choose an item', ''));
    if (online()) {
      if (capability('pictureInPicture'))
        for (const peer of view.peers)
          if (approved(peer.id, 'video') && !items.some(i => i.publisher === peer.id))
            select.add(new Option((peer.displayName || peer.id) + ' POV', 'video:' + peer.id));
      if (desktop?.platform && capability('chatOverlays'))
        for (const source of ['twitch', 'youtube', 'combined'])
          if (!items.some(i => i.source === source))
            select.add(new Option(title({ kind: 'chat', source }), 'chat:' + source));
    }
    if (!online() || view.capabilities.mediaSourcesApi !== 1 || capability('mediaSources'))
      for (const [value, label] of [
        ['text:new', 'Text'],
        ['image:new', 'Picture'],
        ['browser:new', 'Browser page']
      ])
        select.add(new Option(label, value));
    if ([...select.options].some(o => o.value === old)) select.value = old;
    select.disabled = false;
    $('canvasAdd').disabled = select.options.length === 1;
    $('canvasSave').disabled = false;
    hint(idleHint());
    inspect();
    presetPaint();
  }
  function styleBox(el, item) {
    el.style.left = item.x * (1 - item.width) * 100 + '%';
    el.style.top = item.y * (1 - item.height) * 100 + '%';
    el.style.width = item.width * 100 + '%';
    el.style.height = item.height * 100 + '%';
    el.style.zIndex = String((item.z ?? -1) + 1);
    el.hidden = item.visible === false;
  }
  let obsImage = '',
    liveVideo = null;
  function previewImage(tile) {
    if (liveVideo) {
      tile.prepend(liveVideo);
      if (liveVideo.paused) liveVideo.play().catch(() => {});
      return;
    }
    if (!obsImage) return;
    const img = document.createElement('img');
    img.className = 'obs-preview-image';
    img.alt = 'OBS program output preview';
    img.src = obsImage;
    tile.prepend(img);
  }

  // ---- output geometry, matching the relay's boxPixels() ----
  function outputSize() {
    const s = resolution?.width ? resolution : view?.status?.width ? view.status : null;
    return { w: s?.width || 1920, h: s?.height || 1080 };
  }
  function boxPx(item, o = outputSize()) {
    const even = n => Math.floor(n / 2) * 2,
      w = Math.max(2, even(o.w * item.width)),
      h = Math.max(2, even(o.h * item.height));
    return { w, h };
  }
  function renderSize(item) {
    const o = outputSize(),
      b = boxPx(item, o),
      k = Math.min(1, Math.sqrt((2560 * 1440) / (b.w * b.h)));
    const even = n => Math.max(2, Math.floor(n / 2) * 2);
    return { w: even(b.w * k), h: even(b.h * k), k, o };
  }

  // ---- pictures (stored by hash on this computer) ----
  const pictures = new Map(),
    memoryPictures = new Map();
  async function sha256(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  function picture(hash) {
    if (!hash) return null;
    let p = pictures.get(hash);
    if (p) return p;
    p = { img: null, error: '', ready: false };
    pictures.set(hash, p);
    (async () => {
      try {
        let url = memoryPictures.get(hash);
        if (!url && desktop?.layoutMedia) {
          const r = await desktop.layoutMedia({ op: 'get', hash });
          if (!r.ok) throw Error(r.error);
          url = r.dataUrl;
        }
        if (!url) throw Error('Picture not found on this computer.');
        const img = new Image();
        img.src = url;
        await img.decode();
        p.img = img;
        p.ready = true;
      } catch (e) {
        p.error = e.message || 'Picture unavailable.';
      }
      renders.clear();
      paint();
    })();
    return p;
  }
  async function storePicture(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type))
      throw Error('Choose a PNG, JPEG, WebP, GIF or BMP picture.');
    if (file.size > 32 * 1024 * 1024) throw Error('Choose a picture up to 32 MB.');
    // Read as a data: URL; the page's content policy does not allow blob: images.
    const source = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(Error('The picture could not be read.'));
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = source;
    try {
      await img.decode();
    } catch {
      throw Error('That file is not a picture this app can read.');
    }
    const k = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = hasAlpha(x, c.width, c.height)
      ? c.toDataURL('image/png')
      : c.toDataURL('image/jpeg', 0.92);
    if (dataUrl.length > 11 * 1024 * 1024) throw Error('That picture is too detailed. Choose a smaller one.');
    if (desktop?.layoutMedia) {
      const r = await desktop.layoutMedia({ op: 'put', dataUrl });
      if (!r.ok) throw Error(r.error);
      pictures.delete(r.hash);
      return r.hash;
    }
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), ch => ch.charCodeAt(0));
    const hash = await sha256(bytes);
    memoryPictures.set(hash, dataUrl);
    pictures.delete(hash);
    return hash;
  }
  function hasAlpha(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
    return false;
  }

  // ---- rendering text and pictures (the same pixels go to the editor and relay) ----
  function wrapLines(ctx, text, width, wrap) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!wrap) {
        out.push(para);
        continue;
      }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        const next = line + word;
        if (ctx.measureText(next).width > width && line.trim()) {
          out.push(line.trimEnd());
          line = word.trimStart();
        } else line = next;
        while (ctx.measureText(line).width > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  function renderText(item, w, h, k, o) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const s = { ...TEXT_DEFAULT, ...item.style };
    if (s.backgroundOpacity > 0) {
      x.globalAlpha = s.backgroundOpacity / 100;
      x.fillStyle = s.background;
      x.fillRect(0, 0, w, h);
      x.globalAlpha = 1;
    }
    const px = Math.max(4, (s.size / 100) * o.h * k),
      pad = px * 0.3,
      lh = px * 1.25;
    x.font = (s.italic ? 'italic ' : '') + (s.bold ? '700 ' : '400 ') + px + 'px ' + FONT_FAMILY[s.font];
    x.textBaseline = 'alphabetic';
    x.textAlign = s.align;
    const lines = wrapLines(x, item.text || '', Math.max(1, w - 2 * pad), s.wrap),
      total = lines.length * lh;
    let y = s.valign === 'top' ? pad : s.valign === 'bottom' ? h - pad - total : (h - total) / 2;
    const ax = s.align === 'left' ? pad : s.align === 'right' ? w - pad : w / 2;
    const outline = ((s.outline * o.h) / 1080) * k * 2;
    for (const line of lines) {
      y += lh;
      const base = y - lh * 0.22;
      if (s.shadow) {
        x.save();
        x.shadowColor = 'rgba(0,0,0,.65)';
        x.shadowBlur = px * 0.15;
        x.shadowOffsetX = x.shadowOffsetY = Math.max(1, px * 0.06);
        x.fillStyle = s.color;
        x.fillText(line, ax, base);
        x.restore();
      }
      if (outline > 0) {
        x.lineJoin = 'round';
        x.lineWidth = outline;
        x.strokeStyle = s.outlineColor;
        x.strokeText(line, ax, base);
      }
      x.fillStyle = s.color;
      x.fillText(line, ax, base);
    }
    return c;
  }
  function renderImage(item, w, h, img) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.globalAlpha = (item.opacity ?? 100) / 100;
    const iw = img.naturalWidth,
      ih = img.naturalHeight;
    let dw = w,
      dh = h;
    if (item.fit !== 'stretch') {
      const k = item.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      dw = iw * k;
      dh = ih * k;
    }
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c;
  }
  const renders = new Map();
  function renderSource(item, forUpload) {
    if (item.kind === 'browser') return null;
    const { w, h, k, o } = renderSize(item);
    const sig = JSON.stringify([
      item.kind,
      item.text,
      item.style,
      item.media,
      item.fit,
      item.opacity,
      w,
      h,
      k,
      o.h
    ]);
    const key = (forUpload ? 'up:' : '') + item.id,
      cached = renders.get(key);
    if (cached?.sig === sig) return cached.canvas;
    let canvas = null;
    if (item.kind === 'text') canvas = renderText(item, w, h, k, o);
    if (item.kind === 'image') {
      const p = picture(item.media);
      if (!p?.ready) return null;
      canvas = renderImage(item, w, h, p.img);
    }
    renders.set(key, { sig, canvas });
    if (renders.size > 96) renders.delete(renders.keys().next().value);
    return canvas;
  }

  // ---- snapping (Alt bypasses) ----
  function clearGuides() {
    for (const g of root.querySelectorAll('.snap-guide')) g.remove();
  }
  function guide(axis, at) {
    const g = document.createElement('div');
    g.className = 'snap-guide ' + axis;
    g.style[axis === 'v' ? 'left' : 'top'] = at * 100 + '%';
    root.append(g);
  }
  function snapLines(item, axis) {
    const lines = [0, 0.25, 0.5, 0.75, 1];
    for (const other of items) {
      if (other === item || other.visible === false) continue;
      const l = axis === 'x' ? other.x * (1 - other.width) : other.y * (1 - other.height),
        s = axis === 'x' ? other.width : other.height;
      lines.push(l, l + s / 2, l + s);
    }
    return lines;
  }
  function nearest(values, lines) {
    let best = null;
    for (const v of values)
      for (const line of lines) {
        const d = line - v;
        if (Math.abs(d) < 0.012 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
      }
    return best;
  }
  function snap(item, resize, free) {
    clearGuides();
    if (free) return;
    for (const axis of ['x', 'y']) {
      const size = axis === 'x' ? item.width : item.height,
        start = item[axis] * (1 - size),
        lines = snapLines(item, axis);
      if (resize) {
        const hit = nearest([start + size], lines);
        if (hit) {
          const ns = clamp(size + hit.d, 0.04, 1 - start);
          if (axis === 'x') {
            item.width = ns;
            item.x = start / Math.max(0.000001, 1 - ns);
          } else {
            item.height = ns;
            item.y = start / Math.max(0.000001, 1 - ns);
          }
          guide(axis === 'x' ? 'v' : 'h', hit.line);
        }
      } else {
        const hit = nearest([start, start + size / 2, start + size], lines);
        if (hit) {
          item[axis] = clamp((start + hit.d) / Math.max(0.000001, 1 - size), 0, 1);
          guide(axis === 'x' ? 'v' : 'h', hit.line);
        }
      }
    }
  }

  function paint() {
    const o = outputSize();
    root.style.aspectRatio = o.w + '/' + o.h;
    for (const child of [...root.children]) if (child.id !== 'relayCanvasVideo') child.remove();
    $('canvasLayers').replaceChildren();
    for (const item of [...items].sort((a, b) => (b.z ?? -1) - (a.z ?? -1))) {
      const tile = document.createElement('div');
      tile.className = 'canvas-item ' + item.kind + (item.id === selection ? ' selected' : '');
      tile.dataset.item = item.id;
      tile.classList.toggle('locked', locked.has(item.id));
      tile.oncontextmenu = e => {
        e.preventDefault();
        selection = item.id;
        selectPaint();
        inspect();
        window.dispatchEvent(new CustomEvent('item-context', { detail: { x: e.clientX, y: e.clientY } }));
      };
      tile.tabIndex = 0;
      tile.setAttribute('role', 'group');
      tile.setAttribute('aria-label', title(item));
      styleBox(tile, item);
      const label = document.createElement('span');
      label.className = 'canvas-label';
      label.textContent = title(item);
      tile.append(label);
      if (item.kind === 'main') previewImage(tile);
      if (item.kind === 'chat') {
        const text = document.createElement('div');
        text.className = 'canvas-chat-preview';
        const filtered = messages
          .filter(m => item.source === 'combined' || m.platform === item.source)
          .slice(-4);
        text.textContent = filtered.length
          ? filtered.map(m => m.author + ': ' + m.text).join('\n')
          : 'Chat messages appear here';
        tile.append(text);
      }
      if (isMedia(item)) {
        tile.ondblclick = () => openProperties(item.id);
        if (item.kind === 'browser') {
          const shot = browserShots.get(item.id);
          if (shot?.url) {
            const img = document.createElement('img');
            img.className = 'obs-preview-image media-preview';
            img.alt = '';
            img.src = shot.url;
            tile.append(img);
          } else {
            const t = document.createElement('div');
            t.className = 'canvas-chat-preview media-status';
            t.textContent =
              browserErrors.get(item.id) ||
              (desktop?.browserSource
                ? 'Loading ' + (hostOf(item.url) || 'page') + '…'
                : 'Browser pages render in the desktop app.');
            tile.append(t);
          }
        } else {
          const canvas = renderSource(item);
          if (canvas) {
            canvas.className = 'media-preview';
            tile.append(canvas);
          } else if (item.kind === 'image') {
            const t = document.createElement('div');
            t.className = 'canvas-chat-preview media-status';
            t.textContent = item.media
              ? picture(item.media)?.error || 'Loading picture…'
              : 'Choose a picture in Properties.';
            tile.append(t);
          }
        }
      }
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'canvas-resize';
      handle.textContent = '↘';
      handle.setAttribute('aria-label', 'Resize ' + title(item));
      tile.append(handle);
      tile.onpointerdown = e => {
        if (e.button !== 0) return;
        selection = item.id;
        selectPaint();
        inspect();
        if (!editable(item)) return;
        e.preventDefault();
        tile.focus();
        moving = {
          id: item.id,
          pointer: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          before: { ...item },
          resize: e.target === handle
        };
        dragging = true;
        tile.setPointerCapture(e.pointerId);
      };
      tile.onpointermove = e => {
        if (!moving || moving.id !== item.id || moving.pointer !== e.pointerId) return;
        const r = root.getBoundingClientRect(),
          b = moving.before,
          dx = (e.clientX - moving.startX) / r.width,
          dy = (e.clientY - moving.startY) / r.height;
        if (moving.resize) {
          const left = b.x * (1 - b.width),
            top = b.y * (1 - b.height);
          item.width = clamp(b.width + dx, 0.04, 1 - left);
          item.height = clamp(b.height + dy, 0.04, 1 - top);
          item.x = left / Math.max(0.000001, 1 - item.width);
          item.y = top / Math.max(0.000001, 1 - item.height);
        } else {
          item.x = clamp(b.x + dx / Math.max(0.000001, 1 - b.width), 0, 1);
          item.y = clamp(b.y + dy / Math.max(0.000001, 1 - b.height), 0, 1);
        }
        item.x = clamp(item.x, 0, 1);
        item.y = clamp(item.y, 0, 1);
        snap(item, moving.resize, e.altKey);
        styleBox(tile, item);
        inspect();
        changed();
      };
      tile.onpointerup = () => {
        const resized = moving?.resize;
        moving = null;
        dragging = null;
        clearGuides();
        if (resized && isMedia(item)) paint();
      };
      tile.onpointercancel = () => {
        clearGuides();
        if (moving) {
          Object.assign(item, moving.before);
          moving = null;
          dragging = null;
          paint();
        }
      };
      tile.onkeydown = e => {
        if (e.key === 'Enter' && isMedia(item)) {
          openProperties(item.id);
          return;
        }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!delta || !editable(item)) return;
        e.preventDefault();
        selection = item.id;
        if (e.shiftKey) {
          item.width = clamp(item.width + delta[0] * 0.01, 0.04, 1);
          item.height = clamp(item.height + delta[1] * 0.01, 0.04, 1);
        } else {
          item.x = clamp(item.x + delta[0] * 0.01, 0, 1);
          item.y = clamp(item.y + delta[1] * 0.01, 0, 1);
        }
        changed();
        styleBox(tile, item);
        inspect();
      };
      root.append(tile);
      const row = document.createElement('div');
      row.className = 'relay-source-row';
      row.dataset.layer = item.id;
      row.draggable = !locked.has(item.id);
      row.setAttribute('aria-selected', String(item.id === selection));
      const layer = button(title(item), () => {
        selection = item.id;
        selectPaint();
        inspect();
      });
      layer.className = 'source-name';
      layer.setAttribute('aria-pressed', String(item.id === selection));
      row.append(layer);
      const visible = button(item.visible === false ? '○' : '◉', () => {
        if (!editable(item) && !locked.has(item.id)) return;
        item.visible = item.visible === false;
        changed();
        paint();
      });
      visible.title = visible.ariaLabel = (item.visible === false ? 'Show ' : 'Hide ') + title(item);
      row.append(visible);
      const lock = button(locked.has(item.id) ? '🔒' : '🔓', () => {
        selection = item.id;
        toggleLock();
      });
      lock.ariaLabel = 'Lock / unlock ' + title(item);
      row.append(lock);
      row.ondragstart = e => {
        if (!editable(item)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('application/x-relay-source', item.id);
      };
      row.ondragover = e => {
        if (e.dataTransfer.types.includes('application/x-relay-source')) e.preventDefault();
      };
      row.ondrop = e => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData('application/x-relay-source'),
          from = items.find(i => i.id === id);
        if (!from || !editable(from) || !editable(item) || from === item) return;
        const ordered = [...items].sort((a, b) => b.z - a.z).filter(i => i !== from);
        ordered.splice(ordered.indexOf(item), 0, from);
        ordered.reverse().forEach((i, n) => (i.z = n));
        selection = id;
        changed();
        paint();
      };
      $('canvasLayers').append(row);
    }
    inspect();
  }
  function selectPaint() {
    for (const node of root.children) node.classList?.toggle('selected', node.dataset.item === selection);
    for (const node of $('canvasLayers').children) {
      node.setAttribute('aria-selected', String(node.dataset.layer === selection));
      node
        .querySelector('.source-name')
        .setAttribute('aria-pressed', String(node.dataset.layer === selection));
    }
  }
  const propsButton = button('Properties…', () => openProperties(selection));
  propsButton.id = 'canvasProps';
  $('canvasRemove').after(propsButton);
  function inspect() {
    const i = chosen();
    if (!i) return;
    for (const [key, id] of [
      ['width', 'canvasWidth'],
      ['height', 'canvasHeight'],
      ['x', 'canvasX'],
      ['y', 'canvasY']
    ]) {
      const el = $(id);
      el.disabled = !editable(i);
      if (document.activeElement !== el)
        el.value =
          Math.round(
            100 * (key === 'x' ? i.x * (1 - i.width) : key === 'y' ? i.y * (1 - i.height) : i[key]) * 10
          ) / 10;
    }
    for (const id of ['canvasRemove', 'canvasBack', 'canvasFront'])
      $(id).disabled = (id === 'canvasRemove' && i.kind === 'main') || !editable(i);
    $('canvasMainReset').disabled = locked.has('main');
    propsButton.disabled = !isMedia(i) || locked.has(i.id);
  }
  for (const [key, id] of [
    ['width', 'canvasWidth'],
    ['height', 'canvasHeight'],
    ['x', 'canvasX'],
    ['y', 'canvasY']
  ])
    $(id).onchange = () => {
      const i = chosen(),
        v = Number($(id).value) / 100;
      if (!i || !editable(i) || !Number.isFinite(v)) return;
      i[key] =
        key === 'x'
          ? clamp(v / Math.max(0.000001, 1 - i.width), 0, 1)
          : key === 'y'
            ? clamp(v / Math.max(0.000001, 1 - i.height), 0, 1)
            : clamp(v, 0.04, 1);
      changed();
      paint();
    };
  const nextZ = () => Math.max(0, ...items.map(i => i.z ?? 0)) + 1;
  $('canvasAdd').onclick = () => {
    const value = $('canvasSource').value;
    if (!value || items.some(i => i.id === value)) return;
    const [kind, source] = value.split(':');
    if (source === 'new' && MEDIA_KINDS.includes(kind)) {
      openProperties(null, kind);
      return;
    }
    if (!online()) return;
    const z = nextZ();
    const i = {
      id: value,
      kind,
      x: 0.5,
      y: 0.5,
      width: kind === 'chat' ? 0.3 : 0.25,
      height: kind === 'chat' ? 0.6 : 0.25,
      z
    };
    if (kind === 'video') {
      i.publisher = source;
      i.corner = 'top-right';
    } else i.source = source;
    items.push(i);
    selection = i.id;
    changed();
    paint();
    availability();
  };
  $('canvasRemove').onclick = () => {
    if (chosen()?.kind === 'main' || !editable(chosen())) return;
    items = items.filter(i => i.id !== selection);
    renders.delete(selection);
    selection = 'main';
    changed();
    paint();
    availability();
  };
  function reorder(step) {
    const item = chosen();
    if (!item || !editable(item)) return;
    const layers = items.slice().sort((a, b) => a.z - b.z),
      at = layers.indexOf(item),
      next = at + step;
    if (next < 0 || next >= layers.length) return;
    [layers[at], layers[next]] = [layers[next], layers[at]];
    layers.forEach((i, n) => (i.z = n));
    changed();
    paint();
  }
  $('canvasBack').onclick = () => reorder(-1);
  $('canvasFront').onclick = () => reorder(1);
  $('canvasMainReset').onclick = () => {
    if (locked.has('main')) return;
    Object.assign(items[0], defaultMain());
    selection = 'main';
    changed();
    paint();
  };
  const box = i => ({ x: i.x, y: i.y, width: i.width, height: i.height });
  function toRelayMedia(i) {
    const base = {
      id: i.id,
      kind: i.kind,
      name: i.name || '',
      visible: i.visible !== false,
      ...box(i),
      z: i.z
    };
    if (i.kind === 'text') return { ...base, text: i.text || '', style: { ...TEXT_DEFAULT, ...i.style } };
    if (i.kind === 'image')
      return { ...base, media: i.media || '', fit: i.fit || 'contain', opacity: i.opacity ?? 100 };
    return { ...base, url: i.url, pageWidth: i.pageWidth || 1280 };
  }
  // Studio mode: saving keeps the live (program) layout on the relay and only sends stream-wide
  // settings such as fallback and the auto-end timer. The edited layout stays in Preview until
  // Transition calls save({ transition: true }).
  function holding(options) {
    return !!(window.studioMode?.enabled && !options?.transition && online() && view?.me?.settings);
  }
  async function save(options = {}) {
    if (busy || choosing) return false;
    if (!online()) {
      layoutDirty = false;
      writeDraft(true);
      note(
        connected
          ? 'Layout saved on this device. This relay needs an update before it can use the layout editor.'
          : 'Layout saved on this device. Connect to a relay to apply it.'
      );
      availability();
      return true;
    }
    const main = { ...box(items[0]), visible: items[0].visible !== false, z: items[0].z },
      overlays = items
        .filter(i => i.kind === 'video')
        .map(i => ({
          publisher: i.publisher,
          corner: i.corner || 'top-right',
          ...box(i),
          z: i.z,
          visible: i.visible !== false
        })),
      chatOverlays = items
        .filter(i => i.kind === 'chat')
        .map(i => ({ source: i.source, ...box(i), z: i.z, visible: i.visible !== false }));
    const media = items.filter(isMedia);
    if (media.some(i => i.kind === 'image' && !i.media)) {
      note('Choose a picture for each picture source, or remove it, before saving.');
      return false;
    }
    const settings = {
      ...window.releaseFeatures?.settings(),
      resolution,
      main,
      overlays: capability('pictureInPicture') ? overlays : view.me.settings.overlays,
      chatOverlays: capability('chatOverlays') ? chatOverlays : view.me.settings.chatOverlays || [],
      fallback: capability('collaboratorFallback')
        ? [1, 2].map(i => $('fallback' + i).value).filter(Boolean)
        : view.me.settings.fallback
    };
    if (mediaRelay()) settings.mediaOverlays = media.map(toRelayMedia);
    if (holding(options)) {
      const live = view.me.settings;
      settings.resolution = live.resolution || null;
      settings.main = live.main;
      settings.overlays = live.overlays;
      settings.chatOverlays = live.chatOverlays || [];
      if (mediaRelay()) settings.mediaOverlays = live.mediaOverlays || [];
      else delete settings.mediaOverlays;
      if (!(await change('/api/v3/settings', settings))) return false;
      writeDraft(false);
      note(
        layoutDirty
          ? 'Settings saved. Your layout changes are waiting in Preview — press Transition to send them live.'
          : 'Settings saved.'
      );
      window.dispatchEvent(new CustomEvent('studio-program', { detail: { layout: false } }));
      return true;
    }
    const savedItems = structuredClone(items),
      savedLocked = [...locked];
    if (await change('/api/v3/settings', settings)) {
      layoutDirty = false;
      writeDraft(false);
      load(view.me.settings);
      for (const i of savedItems)
        if ((i.visible === false || (isMedia(i) && !mediaRelay())) && !items.some(x => x.id === i.id))
          items.push(i);
      locked = new Set(savedLocked.filter(id => items.some(i => i.id === id)));
      paint();
      writeDraft(false);
      mediaSent.clear();
      note(
        media.length && !mediaRelay()
          ? 'Stream layout saved. Text, picture and browser sources stay on this device until the relay supports them.'
          : options.transition
            ? 'Preview is now live.'
            : 'Stream layout saved.'
      );
      window.dispatchEvent(new CustomEvent('studio-program', { detail: { layout: true } }));
      return true;
    }
    return false;
  }
  // Render public chat locally; OAuth tokens never go to the relay. YUV tiles are
  // bounded and sent at most once every three seconds, only while broadcasting.
  function makeFrame(tile) {
    const status = view.status,
      aspect = ((status.width || 1920) * tile.width) / ((status.height || 1080) * tile.height);
    const w = Math.max(2, Math.floor(Math.min(512, 768 * aspect) / 2) * 2),
      h = Math.max(2, Math.floor(Math.min(768, w / aspect) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#11111c';
    c.fillRect(0, 0, w, h);
    const font = Math.max(12, Math.round(w / 23)),
      line = font * 1.4;
    c.font = 'bold ' + font + 'px sans-serif';
    c.fillStyle = '#c7a6ff';
    c.fillText(title({ kind: 'chat', source: tile.source }), 12, line, Math.max(1, w - 24));
    c.font = font + 'px sans-serif';
    const rows = [];
    for (const m of messages
      .filter(m => tile.source === 'combined' || m.platform === tile.source)
      .slice(-30)) {
      const words = (
        (tile.source === 'combined' ? (m.platform === 'twitch' ? '[T] ' : '[Y] ') : '') +
        m.author +
        ': ' +
        m.text
      ).split(/\s+/);
      let row = '';
      for (const word of words) {
        if (c.measureText(row + ' ' + word).width > w - 24 && row) {
          rows.push(row);
          row = '';
        }
        if (c.measureText(word).width > w - 24) {
          for (const char of word) {
            if (c.measureText(row + char).width > w - 24 && row) {
              rows.push(row);
              row = '';
            }
            row += char;
          }
        } else row += (row ? ' ' : '') + word;
      }
      if (row) rows.push(row);
    }
    const visible = rows.slice(-Math.max(0, Math.floor((h - line * 2) / line)));
    c.fillStyle = '#f4f1ff';
    visible.forEach((t, n) => c.fillText(t, 12, line * (n + 2), Math.max(1, w - 24)));
    const rgba = c.getImageData(0, 0, w, h).data,
      n = w * h,
      yuv = new Uint8Array((n * 3) / 2);
    let u = n,
      v = n + n / 4;
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        let rr = 0,
          gg = 0,
          bb = 0;
        for (let yy = 0; yy < 2; yy++)
          for (let xx = 0; xx < 2; xx++) {
            const p = (y + yy) * w + x + xx,
              q = p * 4,
              r = rgba[q],
              g = rgba[q + 1],
              b = rgba[q + 2];
            yuv[p] = clamp(Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b), 16, 235);
            rr += r;
            gg += g;
            bb += b;
          }
        const at = (y / 2) * (w / 2) + x / 2;
        yuv[u + at] = clamp(
          Math.round(128 - (0.148 * rr) / 4 - (0.291 * gg) / 4 + (0.439 * bb) / 4),
          16,
          240
        );
        yuv[v + at] = clamp(
          Math.round(128 + (0.439 * rr) / 4 - (0.368 * gg) / 4 - (0.071 * bb) / 4),
          16,
          240
        );
      }
    return { source: tile.source, width: w, height: h, data: bytesToBase64(yuv) };
  }
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(binary);
  }
  async function upload() {
    if (uploading || !online() || !capability('chatOverlays') || !view?.status?.broadcast) return;
    const tiles = view.me.settings.chatOverlays || [];
    if (!tiles.length) return;
    const available = tiles.filter(t =>
      t.source === 'combined'
        ? chatStatus.twitch?.running || chatStatus.youtube?.running
        : chatStatus[t.source]?.running
    );
    const signature = JSON.stringify([available, messages, view.status.width, view.status.height]);
    if (signature === lastSent && Date.now() - lastAt < 6000) return;
    uploading = true;
    try {
      const frames = available.map(makeFrame);
      await api('/api/v3/chat-frame', { frames });
      lastSent = signature;
      lastAt = Date.now();
    } catch {
      hint('Chat overlay update failed. Check the relay connection; stale overlays hide automatically.');
    } finally {
      uploading = false;
    }
  }

  // ---- text/picture/browser frames to the relay (only the SAVED layout streams) ----
  const mediaSent = new Map();
  let mediaUploading = false,
    mediaFailedAt = 0;
  async function encodeFrame(item) {
    const canvas = renderSource(item, true);
    if (!canvas) return null;
    const cached = renders.get('up:' + item.id);
    if (cached.frame) return cached.frame;
    const x = canvas.getContext('2d', { willReadFrequently: true }),
      d = x.getImageData(0, 0, canvas.width, canvas.height).data;
    let partial = 0,
      transparent = false;
    for (let i = 3; i < d.length; i += 4) {
      const v = d[i];
      if (v !== 255) {
        transparent = true;
        if (v) partial++;
      }
    }
    const alpha = item.kind === 'text' || transparent,
      k = renderSize(item).k,
      visible = (view.me.settings.mediaOverlays || []).filter(i => i.visible !== false).length || 1;
    // Mirrors the relay's blending budget (1.5 million pixels per broadcast, shared).
    if ((partial / (k * k)) * 1.5 > 1500000 / visible)
      note(
        '“' +
          title(item) +
          '” has a large semi-transparent area. To protect relay performance it shows with hard edges on stream. Use 100% opacity or make it smaller.'
      );
    const blob = await new Promise(r => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.92));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    cached.frame = { format: alpha ? 'png' : 'jpeg', hash: await sha256(bytes), data: bytesToBase64(bytes) };
    return cached.frame;
  }
  async function uploadMedia() {
    if (mediaUploading || !mediaRelay() || !view?.status?.broadcast || Date.now() - mediaFailedAt < 5000)
      return;
    const saved = (view.me.settings.mediaOverlays || []).filter(i => i.visible !== false);
    if (!saved.length) return;
    mediaUploading = true;
    try {
      const frames = [];
      for (const raw of saved) {
        const item = normalizeMedia(raw);
        if (!item) continue;
        const f = item.kind === 'browser' ? browserShots.get(item.id) : await encodeFrame(item);
        if (!f?.hash) continue;
        const sent = mediaSent.get(item.id),
          fresh = !sent || sent.hash !== f.hash || sent.missing;
        if (fresh) frames.push({ id: item.id, hash: f.hash, format: f.format, data: f.data });
        else if (Date.now() - sent.at > (item.kind === 'browser' ? 5000 : 30000))
          frames.push({ id: item.id, hash: f.hash, format: f.format });
      }
      // Keep each request under the relay's body limit.
      let batch = [],
        size = 0;
      const send = async () => {
        if (!batch.length) return;
        const r = await api('/api/v3/media-frame', { frames: batch });
        const missing = new Set(r?.missing || []);
        for (const f of batch)
          mediaSent.set(f.id, { hash: f.hash, at: Date.now(), missing: missing.has(f.id) });
        batch = [];
        size = 0;
      };
      for (const f of frames) {
        const n = (f.data?.length || 0) + 200;
        if (size + n > 8000000) await send();
        batch.push(f);
        size += n;
      }
      await send();
    } catch {
      mediaFailedAt = Date.now();
      hint(
        'Text, picture or browser source update failed. Check the relay connection; browser snapshots hide after 15 seconds without updates.'
      );
    } finally {
      mediaUploading = false;
    }
  }

  // ---- browser pages: rendered off-screen by the desktop app ----
  const browserShots = new Map(),
    browserErrors = new Map();
  let browserBusy = false,
    browserRunning = false;
  async function browserTick() {
    if (!desktop?.browserSource || browserBusy) return;
    const broadcasting = mediaRelay() && view?.status?.broadcast;
    const editorVisible = !document.hidden && !$('studioPage')?.hidden && !$('canvasPanel')?.hidden;
    const source = broadcasting
      ? (view.me.settings.mediaOverlays || []).map(normalizeMedia).filter(Boolean)
      : editorVisible
        ? items
        : [];
    const list = source
      .filter(i => i.kind === 'browser' && i.visible !== false)
      .map(i => {
        const r = renderSize(i);
        return { id: i.id, url: i.url, pageWidth: i.pageWidth || 1280, width: r.w, height: r.h };
      });
    if (!list.length && !browserRunning) return;
    browserBusy = true;
    try {
      const r = await desktop.browserSource({ op: 'sync', sources: list });
      browserRunning = list.length > 0;
      if (r?.skipped) hint('Only four browser pages can run at once. Hide or remove extra browser sources.');
      if (!browserRunning) return;
      const known = Object.fromEntries([...browserShots].map(([id, s]) => [id, s.seq]));
      const f = await desktop.browserSource({ op: 'frames', known });
      for (const frame of f?.frames || []) {
        if (frame.error) {
          browserErrors.set(frame.id, frame.error);
          browserShots.delete(frame.id);
          continue;
        }
        browserErrors.delete(frame.id);
        browserShots.set(frame.id, {
          seq: frame.seq,
          hash: frame.hash,
          format: frame.format,
          data: frame.data,
          url: 'data:image/' + frame.format + ';base64,' + frame.data
        });
        const tile = root.querySelector('[data-item="' + CSS.escape(frame.id) + '"]');
        if (tile) {
          let img = tile.querySelector('img.media-preview');
          if (!img) {
            tile.querySelector('.media-status')?.remove();
            img = document.createElement('img');
            img.className = 'obs-preview-image media-preview';
            img.alt = '';
            tile.querySelector('.canvas-resize').before(img);
          }
          img.src = browserShots.get(frame.id).url;
        }
      }
      for (const id of [...browserShots.keys()]) if (!list.some(s => s.id === id)) browserShots.delete(id);
    } catch {
    } finally {
      browserBusy = false;
    }
  }

  // ---- source properties (replaces rc.8's prompt(), which Electron does not support) ----
  const props = document.createElement('dialog');
  props.id = 'sourcePropertiesWindow';
  props.className = 'floating-window source-properties';
  function field(labelText, input) {
    const l = document.createElement('label');
    l.append(labelText, input);
    return l;
  }
  function input(type, attrs = {}) {
    const i = document.createElement(
      type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input'
    );
    if (type !== 'select' && type !== 'textarea') i.type = type;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'options') for (const [val, text] of v) i.add(new Option(text, val));
      else i[k] = v;
    }
    return i;
  }
  function openProperties(id, newKind) {
    const existing = id ? items.find(i => i.id === id) : null;
    if (id && (!existing || !isMedia(existing))) return;
    if (existing && locked.has(existing.id)) {
      note('Unlock this source to change it.');
      return;
    }
    const kind = existing?.kind || newKind;
    const draft = structuredClone(
      existing || {
        kind,
        name: '',
        visible: true,
        x: 0.5,
        y: 0.5,
        width: kind === 'text' ? 0.5 : 0.35,
        height: kind === 'text' ? 0.15 : 0.35,
        text: '',
        style: { ...TEXT_DEFAULT },
        fit: 'contain',
        opacity: 100,
        url: 'https://',
        pageWidth: 1280,
        media: ''
      }
    );
    props.replaceChildren();
    const head = document.createElement('div');
    head.className = 'window-title';
    const strong = document.createElement('strong');
    strong.textContent =
      (existing ? 'Edit ' : 'Add ') + { text: 'text', image: 'picture', browser: 'browser page' }[kind];
    const x = button('×', () => props.close());
    x.ariaLabel = 'Close source properties';
    head.append(strong, x);
    const form = document.createElement('form');
    form.method = 'dialog';
    const error = document.createElement('p');
    error.className = 'hint';
    error.setAttribute('role', 'alert');
    const name = input('text', { maxLength: 80, value: draft.name || '', placeholder: 'Optional name' });
    form.append(field('Name', name));
    let apply = () => true;
    if (kind === 'text') {
      const s = { ...TEXT_DEFAULT, ...draft.style };
      const text = input('textarea', { maxLength: 1000, rows: 4, value: draft.text || '', required: true });
      const font = input('select', {
        options: [
          ['sans', 'Sans-serif'],
          ['serif', 'Serif'],
          ['mono', 'Monospace'],
          ['rounded', 'Rounded'],
          ['display', 'Display (bold)']
        ]
      });
      font.value = s.font;
      const size = input('number', { min: 1, max: 40, step: 0.5, value: s.size });
      const color = input('color', { value: s.color });
      const bg = input('color', { value: s.background });
      const bgOpacity = input('range', { min: 0, max: 100, value: s.backgroundOpacity });
      const align = input('select', {
        options: [
          ['left', 'Left'],
          ['center', 'Centre'],
          ['right', 'Right']
        ]
      });
      align.value = s.align;
      const valign = input('select', {
        options: [
          ['top', 'Top'],
          ['middle', 'Middle'],
          ['bottom', 'Bottom']
        ]
      });
      valign.value = s.valign;
      const outline = input('number', { min: 0, max: 20, step: 1, value: s.outline });
      const outlineColor = input('color', { value: s.outlineColor });
      const checks = Object.fromEntries(
        ['bold', 'italic', 'wrap', 'shadow'].map(k => [k, input('checkbox', { checked: !!s[k] })])
      );
      const grid = document.createElement('div');
      grid.className = 'settings-grid';
      grid.append(
        field('Font', font),
        field('Size (% of stream height)', size),
        field('Text colour', color),
        field('Background', bg),
        field('Background opacity %', bgOpacity),
        field('Horizontal align', align),
        field('Vertical align', valign),
        field('Outline thickness', outline),
        field('Outline colour', outlineColor)
      );
      const row = document.createElement('div');
      row.className = 'check-row';
      for (const [k, label] of [
        ['bold', 'Bold'],
        ['italic', 'Italic'],
        ['wrap', 'Wrap lines'],
        ['shadow', 'Shadow']
      ]) {
        const l = document.createElement('label');
        l.append(checks[k], ' ' + label);
        row.append(l);
      }
      form.append(field('Text', text), grid, row);
      apply = () => {
        if (!text.value.trim()) {
          error.textContent = 'Enter the text to show.';
          return false;
        }
        draft.text = text.value;
        draft.style = {
          font: font.value,
          size: clamp(Number(size.value) || 6, 1, 40),
          color: color.value,
          background: bg.value,
          backgroundOpacity: Number(bgOpacity.value),
          align: align.value,
          valign: valign.value,
          outline: clamp(Math.round(Number(outline.value) || 0), 0, 20),
          outlineColor: outlineColor.value,
          bold: checks.bold.checked,
          italic: checks.italic.checked,
          wrap: checks.wrap.checked,
          shadow: checks.shadow.checked
        };
        return true;
      };
    }
    if (kind === 'image') {
      const file = input('file', { accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' });
      const status = document.createElement('p');
      status.className = 'hint';
      status.textContent = draft.media
        ? 'Picture chosen. Choose another to replace it.'
        : 'No picture chosen yet.';
      const fit = input('select', {
        options: [
          ['contain', 'Fit inside (keep shape)'],
          ['cover', 'Fill (crop edges)'],
          ['stretch', 'Stretch to box']
        ]
      });
      fit.value = draft.fit || 'contain';
      const opacity = input('range', { min: 0, max: 100, value: draft.opacity ?? 100 });
      let pending = null;
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        status.textContent = 'Preparing picture…';
        try {
          pending = await storePicture(f);
          status.textContent = 'Picture ready: ' + f.name;
          if (!name.value) name.value = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
        } catch (e) {
          pending = null;
          status.textContent = e.message;
        }
      };
      form.append(field('Picture file', file), status, field('Fit', fit), field('Opacity %', opacity));
      const p2 = document.createElement('p');
      p2.className = 'hint';
      p2.textContent =
        'The picture stays on this computer. Only the rendered layout image is sent to your relay while you broadcast.';
      form.append(p2);
      apply = () => {
        if (pending) draft.media = pending;
        if (!draft.media) {
          error.textContent = 'Choose a picture first.';
          return false;
        }
        draft.fit = fit.value;
        draft.opacity = Number(opacity.value);
        return true;
      };
    }
    if (kind === 'browser') {
      const url = input('url', { maxLength: 2048, value: draft.url || 'https://', required: true });
      const pageWidth = input('number', { min: 320, max: 3840, step: 1, value: draft.pageWidth || 1280 });
      form.append(field('Page address (http or https)', url), field('Page width in pixels', pageWidth));
      const warn = document.createElement('p');
      warn.className = 'hint';
      warn.textContent =
        'Pages load on this computer in an isolated, muted window without your logins, pop-ups or downloads. Only use pages you trust. The stream shows a snapshot about once per second, so animations are not smooth. Up to four pages at once.';
      form.append(warn);
      if (existing && desktop?.browserSource) {
        const reload = button('Reload page', () => {
          void desktop.browserSource({ op: 'reload', id: existing.id });
          browserShots.delete(existing.id);
          note('Reloading page…');
        });
        form.append(reload);
      }
      apply = () => {
        const v = url.value.trim();
        if (!/^https?:\/\/[^\s]+$/i.test(v) || v.length > 2048) {
          error.textContent = 'Enter a full http:// or https:// address.';
          return false;
        }
        const w = Math.round(Number(pageWidth.value));
        if (!Number.isInteger(w) || w < 320 || w > 3840) {
          error.textContent = 'Choose a page width from 320 to 3840.';
          return false;
        }
        draft.url = v;
        draft.pageWidth = w;
        return true;
      };
    }
    const actions = document.createElement('div');
    actions.className = 'buttons';
    const ok = input('submit', { value: existing ? 'Apply' : 'Add to layout' });
    ok.className = 'primary';
    const cancel = button('Cancel', () => props.close());
    actions.append(ok, cancel);
    form.append(error, actions);
    form.onsubmit = e => {
      e.preventDefault();
      if (!apply()) return;
      draft.name = name.value.trim().slice(0, 80);
      if (existing) {
        Object.assign(existing, draft);
        renders.delete(existing.id);
      } else {
        draft.id = kind + ':' + crypto.randomUUID();
        draft.z = nextZ();
        const clean = normalizeMedia(draft);
        if (!clean) {
          error.textContent = 'This source could not be added.';
          return;
        }
        items.push(clean);
        selection = clean.id;
      }
      props.close();
      changed();
      paint();
      availability();
    };
    props.append(head, form);
    if (!props.isConnected) document.body.append(props);
    try {
      props.showModal();
    } catch {
      props.show();
    }
    (kind === 'text'
      ? form.querySelector('textarea')
      : kind === 'browser'
        ? form.querySelector('input[type=url]')
        : name
    ).focus();
  }

  // ---- corners, centre and 2x2 split ----
  function placeCorner(corner) {
    const i = chosen();
    if (!i || !editable(i)) return;
    if (corner === 'reset') {
      // Back to where a new item starts: the main feed fills the frame; others are centred at their starting size
      // (text, picture and browser sources keep their own size).
      if (i.kind === 'main') Object.assign(i, { x: 0, y: 0, width: 1, height: 1 });
      else {
        if (!isMedia(i))
          Object.assign(i, { width: i.kind === 'chat' ? 0.3 : 0.25, height: i.kind === 'chat' ? 0.6 : 0.25 });
        Object.assign(i, { x: 0.5, y: 0.5 });
      }
    } else if (corner === 'center') {
      i.x = 0.5;
      i.y = 0.5;
    } else {
      i.width = 0.5;
      i.height = 0.5;
      i.x = corner.endsWith('right') ? 1 : 0;
      i.y = corner.startsWith('bottom') ? 1 : 0;
    }
    changed();
    paint();
  }
  function split() {
    const rank = i => (i.kind === 'main' ? 0 : i.kind === 'video' ? 1 : 2);
    const pick = items
      .filter(i => i.visible !== false && editable(i))
      .sort((a, b) => rank(a) - rank(b) || (b.z ?? 0) - (a.z ?? 0))
      .slice(0, 4);
    if (pick.length < 2) {
      note('A 2×2 split needs at least two visible, unlocked items.');
      return;
    }
    pick.forEach((i, n) => {
      i.width = 0.5;
      i.height = 0.5;
      i.x = n % 2;
      i.y = n > 1 ? 1 : 0;
    });
    changed();
    paint();
    note(
      pick.length < 4
        ? 'Split ' + pick.length + ' items into quadrants. Add more items to fill the rest.'
        : 'Arranged four items as a 2×2 split.'
    );
  }

  // Stream presets are scoped to the saved server/account and still require approvals on load/save.
  const presetPanel = document.createElement('details');
  presetPanel.id = 'streamPresetPanel';
  const summary = document.createElement('summary');
  summary.textContent = 'Stream layout presets';
  presetPanel.append(summary);
  const row = document.createElement('div');
  row.className = 'row';
  const presetSelect = document.createElement('select');
  presetSelect.id = 'streamPresetSelect';
  presetSelect.setAttribute('aria-label', 'Saved stream layout');
  const presetName = document.createElement('input');
  presetName.id = 'streamPresetName';
  presetName.maxLength = 48;
  presetName.placeholder = 'Preset name';
  presetName.setAttribute('aria-label', 'Stream layout preset name');
  const presetsKey = 'universalcollab-stream-presets-v1';
  let presetRows = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(presetsKey) || '[]');
    if (Array.isArray(parsed))
      presetRows = parsed
        .slice(0, 100)
        .filter(p => p && typeof p.name === 'string' && Array.isArray(p.items) && p.items.length <= 68);
  } catch {}
  const scope = () => selected()?.key || '';
  function presetPaint() {
    const old = presetSelect.value;
    presetSelect.replaceChildren(
      new Option('Choose saved stream layout', ''),
      ...presetRows.filter(p => p.scope === scope()).map(p => new Option(p.name, p.name))
    );
    presetSelect.value = old;
    for (const b of row.querySelectorAll('button,input,select')) b.disabled = false;
  }
  function presetPersist() {
    try {
      localStorage.setItem(presetsKey, JSON.stringify(presetRows));
      presetPaint();
      return true;
    } catch {
      note('Could not save stream presets on this device.');
      return false;
    }
  }
  function keepAsPreset(draft) {
    const name = ('Offline draft ' + new Date(draft.updated || Date.now()).toLocaleString()).slice(0, 48);
    presetRows = presetRows.filter(p => !(p.scope === scope() && p.name === name));
    if (presetRows.length >= 100) presetRows.shift();
    presetRows.push({ name, scope: scope(), items: draft.items.slice(0, 68), fallback: [] });
    presetPersist();
  }
  const storePreset = button('Save preset', () => {
    const name = presetName.value.trim();
    if (!name) {
      note('Enter a preset name.');
      return;
    }
    const existing = presetRows.find(p => p.scope === scope() && p.name === name);
    if (existing && !confirm('Replace stream preset “' + name + '”?')) return;
    if (!existing && presetRows.length >= 100) {
      note('Delete an unused preset first (100 maximum across servers).');
      return;
    }
    presetRows = presetRows.filter(p => !(p.scope === scope() && p.name === name));
    presetRows.push({
      name,
      scope: scope(),
      items: structuredClone(items),
      fallback: [1, 2].map(i => $('fallback' + i).value).filter(Boolean)
    });
    if (presetPersist()) {
      presetSelect.value = name;
      note('Stream preset saved locally. It does not change the broadcast until you save the stream layout.');
    }
  });
  storePreset.id = 'saveStreamPreset';
  const loadPreset = button('Load preset', () => {
    const p = presetRows.find(p => p.scope === scope() && p.name === presetSelect.value);
    if (!p) return;
    let skipped = 0;
    const clean = [];
    for (const raw of p.items) {
      const item = validItem(raw);
      if (!item) {
        skipped++;
        continue;
      }
      if (
        online() &&
        ((item.kind === 'video' && !(capability('pictureInPicture') && approved(item.publisher, 'video'))) ||
          (item.kind === 'chat' && !capability('chatOverlays')))
      ) {
        skipped++;
        continue;
      }
      clean.push(item);
    }
    setItems(clean);
    selection = 'main';
    const fallbacks = (p.fallback || []).filter(
      peer => online() && capability('collaboratorFallback') && approved(peer, 'fallback')
    );
    skipped += (p.fallback || []).length - fallbacks.length;
    for (const i of [1, 2]) $('fallback' + i).value = fallbacks[i - 1] || '';
    changed();
    paint();
    availability();
    note(
      'Preset loaded for preview. Click ✓ to apply it.' +
        (skipped ? ' ' + skipped + ' unavailable or unapproved item(s) omitted.' : '')
    );
  });
  loadPreset.id = 'loadStreamPreset';
  const deletePreset = button('Delete preset', () => {
    const name = presetSelect.value;
    if (!name || !confirm('Delete stream preset “' + name + '”?')) return;
    presetRows = presetRows.filter(p => !(p.scope === scope() && p.name === name));
    presetPersist();
  });
  deletePreset.id = 'deleteStreamPreset';
  row.append(presetSelect, loadPreset, presetName, storePreset, deletePreset);
  presetPanel.append(row);
  $('canvasSave').after(presetPanel);

  function snapshot() {
    return {
      resolution,
      items: structuredClone(items),
      locked: [...locked]
    };
  }
  function restore(value) {
    resolution = value?.resolution || null;
    const list = (Array.isArray(value?.items) ? value.items : [])
      .map(validItem)
      .filter(Boolean)
      .filter(i => !(i.kind === 'video' && online() && !approved(i.publisher, 'video')));
    const used = setItems(list);
    locked = new Set(Array.isArray(value?.locked) ? value.locked.filter(id => used.has(id)) : []);
    selection = 'main';
    // Scenes change the layout only. Fallback, the auto-end timer and POV labels are stream-wide
    // settings (End Relay ⚙ and Fallback & output), so switching scenes leaves them as they are.
    changed();
    paint();
    availability();
  }
  function toggleLock() {
    const i = chosen();
    if (!i) return;
    locked.has(i.id) ? locked.delete(i.id) : locked.add(i.id);
    changed();
    paint();
  }
  window.streamCanvas = {
    resolution: value => {
      resolution = value;
      changed();
      paint();
    },
    preview: data => {
      obsImage = data || '';
      if (liveVideo) return;
      const tile = root.querySelector('[data-item="main"]');
      if (tile) {
        tile.querySelector('.obs-preview-image:not(.media-preview)')?.remove();
        previewImage(tile);
      }
    },
    live: stream => {
      if (stream) {
        if (!liveVideo) {
          liveVideo = document.createElement('video');
          liveVideo.className = 'obs-preview-image obs-live-video';
          liveVideo.muted = true;
          liveVideo.autoplay = true;
          liveVideo.playsInline = true;
          liveVideo.disablePictureInPicture = true;
          liveVideo.setAttribute('aria-label', 'Live OBS program output');
        }
        if (liveVideo.srcObject !== stream) liveVideo.srcObject = stream;
      } else if (liveVideo) {
        liveVideo.srcObject = null;
        liveVideo.remove();
        liveVideo = null;
      }
      const tile = root.querySelector('[data-item="main"]');
      if (tile) {
        tile.querySelector('img.obs-preview-image:not(.media-preview)')?.remove();
        previewImage(tile);
      }
    },
    snapshot,
    restore,
    toggleLock,
    placeCorner,
    split,
    openProperties: () => openProperties(selection),
    selected: () => ({
      id: selection,
      locked: locked.has(selection),
      kind: chosen()?.kind,
      media: isMedia(chosen())
    }),
    load,
    save,
    availability,
    // Disconnecting keeps the current layout for offline editing instead of wiping it.
    reset: () => {
      const unsaved = layoutDirty && !choosing;
      layoutDirty = false;
      if (choosing) {
        choosing = false;
        if (choice.open) choice.close();
      }
      if (unsaved) {
        writeDraft(true);
        paint();
        availability();
        hint('Connection closed with unsaved layout changes. They are kept on this device.');
        return;
      }
      const d = readDraft();
      if (d) applyDraft(d);
      else {
        root.style.aspectRatio = '16/9';
        paint();
        availability();
      }
    },
    chats: (m, s) => {
      messages = m;
      chatStatus = s;
      if (!moving) {
        for (const el of root.querySelectorAll('.canvas-chat-preview:not(.media-status)')) {
          const item = items.find(i => i.id === el.parentElement.dataset.item);
          if (item?.kind === 'chat')
            el.textContent =
              messages
                .filter(m => item.source === 'combined' || item.source === m.platform)
                .slice(-4)
                .map(m => m.author + ': ' + m.text)
                .join('\n') || 'Chat messages appear here';
        }
      }
    }
  };
  {
    const d = readDraft();
    if (d) applyDraft(d);
    else {
      setItems([]);
      paint();
      availability();
    }
  }
  setInterval(upload, 3000);
  setInterval(() => {
    void browserTick().then(uploadMedia);
  }, 1000);
})();
