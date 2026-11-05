'use strict';
// End credits and stream alerts (1.2.0), window side. While Stream Assist runs, everyone who followed, subscribed,
// gifted, tipped, cheered, raided or chatted during the stream is collected for the End credits overlay, and each
// new event is sent to the Alerts overlay (overlays.cjs serves both to OBS on this PC). A new list starts when a
// relay broadcast starts (or with Start new credits). Tools → End credits & alerts has the settings and the links.
(() => {
  const SECTIONS = [
    ['raid', 'Raiders'],
    ['sub', 'Subscribers'],
    ['gift', 'Gifted subs'],
    ['support', 'Supporters'],
    ['follow', 'New followers'],
    ['chat', 'Chatters']
  ];
  // Stream Assist's event kinds → credits section (null: not in the credits).
  function section(kind) {
    const k = String(kind || '').toLowerCase();
    if (/kick/.test(k)) return 'support';
    if (/gift|bomb/.test(k)) return 'gift';
    if (/raid|host/.test(k)) return 'raid';
    if (/donat|tip|cheer|bits|superchat|super chat|supersticker|super sticker/.test(k)) return 'support';
    if (/sub|member|sponsor|milestone/.test(k)) return 'sub';
    if (/follow/.test(k)) return 'follow';
    if (/^chat$/.test(k)) return 'chat';
    return null;
  }
  function alertTitle(kind) {
    const k = String(kind || '').toLowerCase();
    const s = section(kind);
    if (s === 'follow') return 'New follower';
    if (s === 'raid') return 'Raid!';
    if (s === 'gift') return 'Gifted subs';
    if (s === 'sub')
      return /resub|milestone/.test(k)
        ? 'Resubscribed'
        : /member|sponsor/.test(k)
          ? 'New member'
          : 'New subscriber';
    if (/cheer|bits/.test(k)) return 'Cheer';
    if (/superchat|super chat/.test(k)) return 'Super Chat';
    if (/sticker/.test(k)) return 'Super Sticker';
    if (/kick/.test(k)) return 'Kicks';
    if (s === 'support') return 'Tip';
    return null;
  }
  const keyOf = a => a.id || [a.time, a.platform, a.kind, a.name, a.detail].join('|');

  // Adds new events (newest first, as Assist lists them) to the session. Returns the new alerts for the overlay.
  function collect(session, alerts, { samples = false } = {}) {
    const added = [];
    for (const a of [...(alerts || [])].reverse()) {
      const key = keyOf(a);
      if (session.seen.includes(key)) continue;
      session.seen.push(key);
      if (a.demo && !samples) continue;
      const s = section(a.kind);
      const name = String(a.name || '').trim();
      if (!s || !name) continue;
      const list = (session.people[s] ||= []);
      if (!list.some(n => n.toLowerCase() === name.toLowerCase())) list.push(name);
      const title = alertTitle(a.kind);
      if (title)
        added.push({ title, name, detail: String(a.detail || ''), platform: String(a.platform || '') });
    }
    if (session.seen.length > 3000) session.seen = session.seen.slice(-2000);
    return added;
  }
  const newSession = (alerts = []) => ({
    startedAt: Date.now(),
    people: {},
    seen: (alerts || []).map(keyOf)
  });

  const api = { SECTIONS, section, alertTitle, collect, newSession };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.endCredits = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    if (!bridge?.overlays) return;
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const KEY = 'uc-end-credits',
      SETTINGS = 'uc-end-credits-settings';
    const load = (k, fallback) => {
      try {
        return { ...fallback, ...JSON.parse(localStorage.getItem(k) || '{}') };
      } catch {
        return { ...fallback };
      }
    };
    let settings = load(SETTINGS, {
      title: 'Thanks for watching!',
      subtitle: '',
      speed: 40,
      loop: true,
      sound: true,
      seconds: 6,
      samples: false,
      autoReset: true,
      rollAt: 0
    });
    // The list survives an app restart mid-stream; events it already has are not counted twice.
    let session = load(KEY, { startedAt: 0, people: {}, seen: null });
    let lastAlerts = null,
      seq = 0,
      queue = [],
      wasLive = null,
      published = '';
    const persist = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(session));
        localStorage.setItem(SETTINGS, JSON.stringify(settings));
      } catch {}
    };
    function startNew() {
      session = newSession(lastAlerts || []);
      persist();
      paint();
    }
    window.addEventListener('integrated-assist-state', e => {
      const alerts = e.detail?.alerts || [];
      lastAlerts = alerts;
      // First Assist update with no saved list: what Assist already shows is from before, not this stream.
      if (!Array.isArray(session.seen)) {
        session = newSession(alerts);
        persist();
        return;
      }
      const added = collect(session, alerts, settings);
      if (!added.length) return;
      for (const a of added) queue.push({ ...a, seq: ++seq });
      queue = queue.slice(-50);
      persist();
      paint();
    });
    // A new relay broadcast starts a new list.
    setInterval(() => {
      const live = !!(connected && view?.status?.broadcast);
      if (settings.autoReset && wasLive === false && live) startNew();
      if (connected) wasLive = live;
      publish();
    }, 1000);
    function credits() {
      return {
        title: settings.title,
        subtitle: settings.subtitle,
        speed: settings.speed,
        loop: settings.loop,
        rollAt: settings.rollAt,
        sections: SECTIONS.map(([k, title]) => ({ title, names: session.people?.[k] || [] }))
      };
    }
    async function publish(force) {
      const body = {
        op: 'update',
        credits: credits(),
        alerts: queue,
        config: { sound: settings.sound, seconds: settings.seconds }
      };
      const next = JSON.stringify(body);
      if (next === published && !force) return;
      published = next;
      const r = await bridge.overlays(body).catch(() => null);
      if (r?.ok) links = r.data;
    }

    // ---- Tools → End credits & alerts ----
    let links = null;
    const dialog = el('dialog');
    dialog.id = 'endCreditsWindow';
    dialog.setAttribute('aria-label', 'End credits and alerts');
    const counts = el('p', null, 'credits-counts');
    counts.setAttribute('role', 'status');
    const field = (label, input) => {
      const l = el('label', label);
      l.append(input);
      return l;
    };
    const title = el('input');
    title.id = 'creditsTitle';
    title.maxLength = 120;
    const subtitle = el('input');
    subtitle.id = 'creditsSubtitle';
    subtitle.maxLength = 200;
    subtitle.placeholder = 'Optional, e.g. See you Friday!';
    const speed = el('input');
    speed.id = 'creditsSpeed';
    speed.type = 'range';
    speed.min = '10';
    speed.max = '200';
    const check = (id, text) => {
      const i = el('input');
      i.type = 'checkbox';
      i.id = id;
      const l = el('label', ' ' + text, 'check-row');
      l.prepend(i);
      return [i, l];
    };
    const [loop, loopLabel] = check('creditsLoop', 'Keep rolling (loop)');
    const [autoReset, autoResetLabel] = check(
      'creditsAutoReset',
      'Start a new list when a relay broadcast starts'
    );
    const [sound, soundLabel] = check('alertsSound', 'Play a chime with each alert');
    const [samples, samplesLabel] = check(
      'creditsSamples',
      'Include Stream Assist sample alerts (for testing)'
    );
    const seconds = el('input');
    seconds.id = 'alertsSeconds';
    seconds.type = 'number';
    seconds.min = '2';
    seconds.max = '30';
    const btn = (text, fn) => {
      const b = el('button', text);
      b.type = 'button';
      b.onclick = fn;
      return b;
    };
    const status = el('p', null, 'hint');
    status.setAttribute('role', 'status');
    const copy = which => async () => {
      const r = await bridge.overlays({ op: 'copy', which });
      status.textContent = r?.ok
        ? (which === 'credits' ? 'End credits' : 'Alerts') +
          ' link copied. In OBS: Sources → + → Browser → paste it as the URL, size 1920 × 1080.'
        : r?.error || 'Could not copy the link.';
    };
    const creditRow = el('div', null, 'assist-actions');
    creditRow.append(
      btn('Roll credits now', () => {
        settings.rollAt = Date.now();
        persist();
        status.textContent = 'The credits roll again from the start.';
      }),
      btn('Start new credits', () => {
        if (confirm('Clear the names collected so far and start a new list?')) startNew();
      }),
      btn('Copy credits link', copy('credits'))
    );
    const alertRow = el('div', null, 'assist-actions');
    alertRow.append(
      btn('Send a test alert', () => {
        queue.push({
          seq: ++seq,
          title: 'New follower',
          name: 'Test viewer',
          detail: 'This is a test alert',
          platform: 'Test'
        });
        queue = queue.slice(-50);
        status.textContent = 'Test alert sent to the Alerts overlay.';
      }),
      btn('Copy alerts link', copy('alerts'))
    );
    const close = btn('Close', () => dialog.close());
    const reset = btn('Reset links', async () => {
      if (!confirm('Make new links? The old ones stop working, so paste the new ones into OBS.')) return;
      const r = await bridge.overlays({ op: 'reset-token' });
      status.textContent = r?.ok
        ? 'New links made. Copy them into OBS again.'
        : r?.error || 'Could not reset.';
    });
    const bottom = el('div', null, 'assist-actions');
    bottom.append(reset, close);
    dialog.append(
      el('h2', 'End credits & alerts'),
      counts,
      el('h3', 'End credits'),
      field('Title', title),
      field('Subtitle', subtitle),
      field('Scroll speed', speed),
      loopLabel,
      autoResetLabel,
      creditRow,
      el('h3', 'Alerts'),
      soundLabel,
      field('Seconds on screen', seconds),
      samplesLabel,
      alertRow,
      status,
      el(
        'p',
        'Both are OBS browser sources served from this PC only. You can also add a link to the relay layout as a browser source (Sources → + → Browser) so it is part of the relay picture. Names come from Stream Assist while it runs: followers, subscribers, gifted subs, tips, cheers, Super Chats, Kicks, raids and chatters. Platforms do not say who only watched.',
        'hint'
      ),
      bottom
    );
    document.body.append(dialog);
    function paint() {
      const parts = SECTIONS.map(([k, t]) => [t, (session.people?.[k] || []).length]).filter(([, n]) => n);
      counts.textContent =
        (session.startedAt
          ? 'Collecting since ' + new Date(session.startedAt).toLocaleTimeString() + '. '
          : '') + (parts.length ? parts.map(([t, n]) => `${t}: ${n}`).join(' · ') : 'No names yet.');
    }
    function fill() {
      title.value = settings.title;
      subtitle.value = settings.subtitle;
      speed.value = String(settings.speed);
      loop.checked = settings.loop;
      autoReset.checked = settings.autoReset;
      sound.checked = settings.sound;
      samples.checked = settings.samples;
      seconds.value = String(settings.seconds);
    }
    const save = () => {
      settings = {
        ...settings,
        title: title.value.trim() || 'Thanks for watching!',
        subtitle: subtitle.value.trim(),
        speed: Number(speed.value) || 40,
        loop: loop.checked,
        autoReset: autoReset.checked,
        sound: sound.checked,
        samples: samples.checked,
        seconds: Math.min(30, Math.max(2, Number(seconds.value) || 6))
      };
      persist();
    };
    for (const i of [title, subtitle, speed, loop, autoReset, sound, samples, seconds])
      i.addEventListener('change', save);
    window.openEndCredits = async () => {
      fill();
      paint();
      status.textContent = '';
      if (!dialog.open) dialog.showModal();
      await publish(true);
    };
  })().catch(() => {});
})();
