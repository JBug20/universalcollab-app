'use strict';
// Twitch quality check (1.2.0). Twitch's simultaneous streaming guidelines ask that the Twitch stream is at least as
// good as the stream sent to other platforms. This warns when it is not:
// - while preparing a stream, when Twitch's resolution, bitrate or frame rate is set lower than another selected
//   destination's (with a confirmation before Create & prepare), and
// - while live, when Twitch's measured frame rate or bitrate stays below another destination's for 30 seconds
//   (Destination health card and the notice line).
(() => {
  const SOURCE = Infinity;
  const height = size => (size ? Number(/x(\d+)$/.exec(size)?.[1]) || SOURCE : SOURCE);
  const label = size => (size ? height(size) + 'p' : 'source size');
  const mbps = k => (k / 1000).toLocaleString('en', { maximumFractionDigits: 1 }) + ' Mbps';

  // Settings: { name, size: '' | 'WxH', bitrateKbps: number | null, fps: number | null }; empty = same as the source.
  // A bitrate is only compared when both are set: "Auto bitrate" depends on the source.
  function settingsGaps(twitch, others) {
    const gaps = [];
    for (const o of others) {
      if (height(twitch.size) < height(o.size))
        gaps.push(`Twitch is ${label(twitch.size)} but ${o.name} is ${label(o.size)}.`);
      if (twitch.fps && (!o.fps || twitch.fps < o.fps))
        gaps.push(`Twitch is ${twitch.fps} fps but ${o.name} is ${o.fps ? o.fps + ' fps' : 'source fps'}.`);
      if (twitch.bitrateKbps && o.bitrateKbps && twitch.bitrateKbps < o.bitrateKbps)
        gaps.push(`Twitch is ${mbps(twitch.bitrateKbps)} but ${o.name} is ${mbps(o.bitrateKbps)}.`);
    }
    return gaps;
  }

  // Live: { name, kbps, fps } averages over the last 30 seconds. Small differences are normal measurement noise.
  function liveGaps(twitch, others) {
    const gaps = [];
    for (const o of others) {
      if (twitch.fps < o.fps - 3)
        gaps.push(`Twitch is getting ${Math.round(twitch.fps)} fps but ${o.name} ${Math.round(o.fps)} fps.`);
      if (twitch.kbps < o.kbps * 0.75)
        gaps.push(
          `Twitch is getting ${Math.round(twitch.kbps)} kbps but ${o.name} ${Math.round(o.kbps)} kbps.`
        );
    }
    return gaps;
  }

  const api = { settingsGaps, liveGaps };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.twitchQuality = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const $id = id => document.getElementById(id);
    const isTwitch = (id, name) => /twitch/i.test(id + ' ' + name);

    // Preparing a stream: read each selected destination's quality choices from the form.
    const list = $id('productionDestinations'),
      form = $id('productionForm');
    const warning = document.createElement('p');
    warning.id = 'twitchQualityWarning';
    warning.className = 'quality-warning';
    warning.setAttribute('role', 'alert');
    warning.hidden = true;
    list?.after(warning);
    function chosen() {
      return [...(list?.querySelectorAll('label.check') || [])]
        .map(l => {
          const box = l.querySelector('input[type=checkbox]');
          if (!box?.checked) return null;
          const [size, rate, fps] = [...l.querySelectorAll('select')].map(s => s.value);
          const name = (l.firstChild?.nextSibling?.textContent || box.value).split(' · ')[0].trim();
          return { id: box.value, name, size, bitrateKbps: Number(rate) || null, fps: Number(fps) || null };
        })
        .filter(Boolean);
    }
    function prepareGaps() {
      const all = chosen(),
        twitch = all.find(d => isTwitch(d.id, d.name));
      return twitch
        ? settingsGaps(
            twitch,
            all.filter(d => d !== twitch)
          )
        : [];
    }
    // The readiness check (readiness.js) shows the same comparison.
    window.twitchQuality.currentGaps = prepareGaps;
    function paintPrepare() {
      const gaps = prepareGaps();
      warning.hidden = !gaps.length;
      warning.textContent = gaps.length
        ? '⚠ Twitch is set to a lower quality than other platforms. Twitch’s simultaneous streaming guidelines ask for the Twitch stream to be at least as good. ' +
          gaps.join(' ')
        : '';
    }
    form?.addEventListener('change', paintPrepare);
    new MutationObserver(paintPrepare).observe(list || document.body, { childList: true });
    // Runs before the form's own submit handler (capture listeners at the target run first).
    form?.addEventListener(
      'submit',
      e => {
        const gaps = prepareGaps();
        if (
          gaps.length &&
          !confirm(
            'Twitch is set to a lower quality than other platforms:\n\n' +
              gaps.join('\n') +
              '\n\nTwitch’s simultaneous streaming guidelines ask for the Twitch stream to be at least as good. Prepare anyway?'
          )
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
    paintPrepare();

    // Live: 30 seconds of measurements per output.
    const samples = new Map(),
      WINDOW = 30;
    const live = document.createElement('p');
    live.id = 'twitchQualityLive';
    live.className = 'quality-warning';
    live.setAttribute('role', 'alert');
    live.hidden = true;
    let told = '';
    function sample() {
      const card = $id('destinationHealthCard');
      if (card && live.parentElement !== card) card.append(live);
      const outputs = connected && !uncertain && view?.status?.broadcast ? view?.status?.outputs || [] : [];
      const ids = new Set(outputs.map(o => o.id));
      for (const id of samples.keys()) if (!ids.has(id)) samples.delete(id);
      for (const o of outputs) {
        const list = samples.get(o.id) || [];
        // Only steady sending counts; a reconnect starts the window again.
        if (o.state !== 'sending' || !Number.isFinite(o.bitrateKbps) || !Number.isFinite(o.fps))
          list.length = 0;
        else list.push({ kbps: o.bitrateKbps, fps: o.fps });
        samples.set(o.id, list.slice(-WINDOW));
      }
      const avg = o => {
        const s = samples.get(o.id);
        return s?.length >= WINDOW
          ? {
              name: o.name,
              kbps: s.reduce((a, x) => a + x.kbps, 0) / s.length,
              fps: s.reduce((a, x) => a + x.fps, 0) / s.length
            }
          : null;
      };
      const twitch = outputs.find(o => isTwitch(o.id, o.name));
      const t = twitch && avg(twitch);
      const others = outputs
        .filter(o => o !== twitch)
        .map(avg)
        .filter(Boolean);
      const gaps = t && others.length ? liveGaps(t, others) : [];
      live.hidden = !gaps.length;
      live.textContent = gaps.length
        ? '⚠ Twitch is streaming at a lower quality than other platforms. ' + gaps.join(' ')
        : '';
      // One notice per problem; it can come back after it has cleared.
      const key = gaps.length ? 'low' : '';
      if (key && key !== told)
        note('Twitch is streaming at a lower quality than other platforms. See Destination health.');
      told = key;
    }
    setInterval(sample, 1000);
  })().catch(() => {});
})();
