'use strict';
// Vertical clips (1.2.0), window side. Settings → OBS → Vertical clips: when on, each clip saved with Clip (button,
// shortcut or Stream Deck) also gets a 9:16 copy next to it, for Shorts, TikTok and Reels (vertical-clips.cjs makes
// it). The facecam layout finds your webcam where it is in the live OBS scene (or the source you choose).
(() => {
  // Video capture source kinds (obs-sources.cjs, webcam).
  const CAMERA = ['dshow_input', 'v4l2_input', 'av_capture_input_v2', 'av_capture_input', 'macos-avcapture'];
  // The facecam's place in the picture (0–1), from the scene's sources: the chosen one, else the first visible camera.
  function facecam(items, base, chosen, rect) {
    const visible = (items || []).filter(i => i.sceneItemEnabled);
    const item = chosen
      ? visible.find(i => i.sourceName === chosen)
      : [...visible].reverse().find(i => CAMERA.includes(i.inputKind));
    if (!item || !base?.width || !base?.height) return null;
    const r = rect(item.sceneItemTransform || {});
    const x = Math.max(0, r.left),
      y = Math.max(0, r.top),
      right = Math.min(base.width, r.right),
      bottom = Math.min(base.height, r.bottom);
    if (right - x < 8 || bottom - y < 8) return null;
    return {
      name: item.sourceName,
      x: x / base.width,
      y: y / base.height,
      w: (right - x) / base.width,
      h: (bottom - y) / base.height
    };
  }
  const api = { facecam, CAMERA };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.verticalClips = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    if (!bridge?.verticalClip) return;
    const $ = id => document.getElementById(id);
    const KEY = 'uc-vertical-clips';
    let settings = { on: false, layout: 'stack', camera: '' };
    try {
      settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {}
    const save = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {}
    };
    const obs = (op, input = {}) => bridge.obs(op, { ...input, serverKey: selected()?.key });
    // The live scene's sources (in Studio Mode, the program scene: that is what the clip shows).
    async function scene() {
      const snap = await obs('snapshot');
      return obs('editor-state', { sceneName: snap.current });
    }
    async function paint() {
      $('verticalClipOn').checked = settings.on;
      $('verticalClipLayout').value = settings.layout;
      for (const id of ['verticalClipLayout', 'verticalClipCam']) $(id).disabled = !settings.on;
      const cam = $('verticalClipCam');
      let names = [],
        found = null;
      if (window.obsConnected)
        try {
          const s = await scene();
          names = (s.items || []).filter(i => i.sceneItemEnabled).map(i => i.sourceName);
          found = facecam(s.items, s.base, settings.camera, window.obsEditorGeometry.rect);
        } catch {}
      const options = [new Option('Find my webcam automatically', ''), ...names.map(n => new Option(n, n))];
      if (settings.camera && !names.includes(settings.camera))
        options.push(new Option(settings.camera + ' (not in the live scene)', settings.camera));
      cam.replaceChildren(...options);
      cam.value = settings.camera;
      $('verticalClipCam').closest('label').hidden = settings.layout !== 'stack';
      $('verticalClipInfo').textContent = !settings.on
        ? 'Makes a 1080 × 1920 copy next to each clip. It takes about as long as the clip and needs MP4 recordings.'
        : settings.layout !== 'stack'
          ? 'Each clip also gets a 1080 × 1920 copy, saved next to it as "… (vertical).mp4".'
          : found
            ? `Facecam: "${found.name}" in the live scene. The top of the vertical clip shows it, the gameplay goes below.`
            : window.obsConnected
              ? 'No webcam found in the live OBS scene: the whole picture over a blurred background is used instead. Choose the facecam source if it has another kind.'
              : 'Connect OBS to find your webcam.';
    }
    $('verticalClipOn').onchange = () => {
      settings.on = $('verticalClipOn').checked;
      save();
      void paint();
    };
    $('verticalClipLayout').onchange = () => {
      settings.layout = $('verticalClipLayout').value;
      save();
      void paint();
    };
    $('verticalClipCam').onchange = () => {
      settings.camera = $('verticalClipCam').value;
      save();
      void paint();
    };
    void paint();
    // Refresh the source list each time Settings → OBS shows this section.
    new IntersectionObserver(entries => entries.some(x => x.isIntersecting) && paint()).observe(
      $('verticalClips')
    );

    // After each clip. A line under Clip shows how the vertical copy is going and stays until the next one, so a
    // copy that is waiting, slow or failed is never silent.
    const status = document.createElement('p');
    status.id = 'verticalClipStatus';
    status.className = 'hint';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const place = () => {
      const after = $('obsClipNote') || $('obsClip');
      if (after && status.previousElementSibling !== after) after.after(status);
    };
    const clock = s => {
      const n = Math.max(0, Math.round(s || 0));
      return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
    };
    const name = f =>
      String(f || '')
        .split(/[\\/]/)
        .pop();
    function show(text, { bad = false, file = '' } = {}) {
      place();
      status.hidden = false;
      status.classList.toggle('bad', bad);
      status.replaceChildren(text);
      if (file) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Show file';
        b.onclick = () => obs('clip-show', { path: file }).catch(e => note(e.message));
        status.append(' ', b);
      }
    }
    const more = n => (n ? ` · ${n} more waiting` : '');
    bridge.onVerticalClip?.(d => {
      if (d.state === 'queued' && d.waiting)
        show(`Vertical copy of ${name(d.file)} is waiting (${d.waiting} ahead).`);
      else if (d.state === 'making') show(`Making the vertical copy of ${name(d.file)}…` + more(d.waiting));
      else if (d.state === 'progress')
        show(
          `Making the vertical copy: ${clock(d.t)}` +
            (d.d ? ` of ${clock(d.d)}` : '') +
            more(d.waiting) +
            ' (it takes as long as the clip).'
        );
      else if (d.state === 'done') show('Vertical clip saved: ' + d.name + more(d.waiting), { file: d.out });
      else if (d.state === 'failed')
        show('Vertical copy failed: ' + d.error + more(d.waiting), { bad: true });
    });
    window.addEventListener('obs-clip-saved', async e => {
      const file = e.detail?.path;
      if (!settings.on) return;
      if (!file) {
        show(
          "No vertical copy: OBS saved the clip but did not say where within 30 seconds. Check OBS's recordings folder.",
          { bad: true }
        );
        return;
      }
      let cam = null;
      if (settings.layout === 'stack')
        try {
          const sc = await scene();
          cam = facecam(sc.items, sc.base, settings.camera, window.obsEditorGeometry.rect);
        } catch {}
      busy++;
      show(`Vertical copy of ${name(file)} is starting…`);
      try {
        const r = await bridge.verticalClip({ file, layout: settings.layout, facecam: cam });
        if (!r?.ok) throw Error(r?.error || 'The vertical copy failed.');
        note('Vertical clip saved: ' + r.data.file);
        window.dispatchEvent(new CustomEvent('vertical-clip-saved', { detail: r.data }));
      } catch (err) {
        // Refused before it started (e.g. MKV): the main side sent nothing, so say it here.
        if (!status.classList.contains('bad') || !status.textContent.includes(err.message))
          show('Vertical copy failed: ' + err.message, { bad: true });
        note('Vertical clip: ' + err.message);
      } finally {
        busy--;
      }
    });
    window.verticalClips.busy = () => busy;
    window.verticalClips.refresh = paint;
  })().catch(() => {});
})();
