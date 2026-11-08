'use strict';
// Stream labels (1.2.0), window side. Like Streamlabs' Stream Labels, but for every platform at once: text files with
// the latest follower, subscriber, tip, cheer, raid and more, and this stream's counts, kept up to date from Stream
// Assist's events (Twitch, YouTube, Kick and Streamlabs tips). OBS shows them with a Text source that reads from the
// file (stream-labels.cjs writes the files and adds the sources). Only names and amounts go into the files, never
// chat messages. "Latest" labels are kept between streams; "this stream" labels start again when a relay broadcast
// starts (or with Start a new stream). Tools → Stream labels has the settings.
(() => {
  // id → [group, title, default format]. Formats use {name} {amount} {platform} {count} {list} {title}.
  const LABELS = [
    ['latest_follower', 'latest', 'Latest follower', '{name}'],
    ['latest_subscriber', 'latest', 'Latest subscriber or member', '{name}'],
    ['latest_gifter', 'latest', 'Latest gifted subs', '{name} ({amount})'],
    ['latest_donation', 'latest', 'Latest tip (Streamlabs)', '{name} ({amount})'],
    ['latest_superchat', 'latest', 'Latest Super Chat', '{name} ({amount})'],
    ['latest_cheer', 'latest', 'Latest cheer', '{name} ({amount})'],
    ['latest_kicks', 'latest', 'Latest Kicks', '{name} ({amount})'],
    ['latest_raid', 'latest', 'Latest raid', '{name} ({amount})'],
    ['latest_event', 'latest', 'Latest event (any)', '{title}: {name}'],
    ['session_follower_count', 'session', 'New followers this stream', '{count}'],
    ['session_subscriber_count', 'session', 'New subscribers this stream', '{count}'],
    ['session_gifted_count', 'session', 'Gifted subs this stream', '{count}'],
    ['session_bits', 'session', 'Bits this stream', '{count}'],
    ['session_followers', 'session', 'Followers this stream (names)', '{list}'],
    ['session_subscribers', 'session', 'Subscribers this stream (names)', '{list}'],
    ['session_top_tip', 'session', 'Biggest tip this stream', '{name} ({amount})'],
    ['session_top_cheerer', 'session', 'Top cheerer this stream', '{name} ({amount})']
  ];
  const IDS = LABELS.map(l => l[0]);

  // Stream Assist's event kind → which labels it feeds.
  function kindOf(kind) {
    const k = String(kind || '').toLowerCase();
    if (/kick/.test(k)) return 'kicks';
    if (/gift|bomb/.test(k)) return 'gift';
    if (/raid|host/.test(k)) return 'raid';
    if (/cheer|bits/.test(k)) return 'cheer';
    if (/superchat|super chat|supersticker|super sticker/.test(k)) return 'superchat';
    if (/donat|tip/.test(k)) return 'donation';
    if (/sub|member|sponsor|milestone/.test(k)) return 'sub';
    if (/follow/.test(k)) return 'follow';
    return null;
  }
  const TITLES = {
    follow: 'Follower',
    sub: 'Subscriber',
    gift: 'Gifted subs',
    donation: 'Tip',
    superchat: 'Super Chat',
    cheer: 'Cheer',
    kicks: 'Kicks',
    raid: 'Raid'
  };
  // The amount at the start of Assist's detail ("500 bits  Nice!", "$5.00  Thanks", "5 gifted subscriptions").
  function amountOf(type, detail) {
    const d = String(detail || '').trim();
    if (!['gift', 'donation', 'superchat', 'cheer', 'kicks', 'raid'].includes(type)) return '';
    return d
      .split(/\s{2,}/)[0]
      .trim()
      .slice(0, 40);
  }
  // A number from an amount ("$1,234.50" → 1234.5, "12,50 €" → 12.5, "500 bits" → 500).
  function valueOf(amount) {
    let s = String(amount || '').replace(/[^0-9.,]/g, '');
    if (/,\d{2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }
  const keyOf = a => a.id || [a.time, a.platform, a.kind, a.name, a.detail].join('|');
  const newState = () => ({ latest: {}, session: newSession(), seen: null });
  function newSession(now = Date.now()) {
    return { startedAt: now, followers: [], subscribers: [], gifted: 0, bits: 0, topTip: null, cheerers: {} };
  }

  // Adds Assist's events (newest first, as Assist lists them). Returns true when anything changed.
  function collect(state, alerts, { samples = false } = {}) {
    let changed = false;
    if (!Array.isArray(state.seen)) {
      // First update with nothing saved: what Assist already lists is from before.
      state.seen = (alerts || []).map(keyOf);
      return false;
    }
    for (const a of [...(alerts || [])].reverse()) {
      const key = keyOf(a);
      if (state.seen.includes(key)) continue;
      state.seen.push(key);
      if (a.demo && !samples) continue;
      const type = kindOf(a.kind);
      const name = String(a.name || '')
        .trim()
        .slice(0, 80);
      if (!type || !name) continue;
      const amount = amountOf(type, a.detail);
      const entry = { name, amount, platform: String(a.platform || '').slice(0, 20), title: TITLES[type] };
      const s = state.session;
      const add = (list, n) => {
        if (!list.some(x => x.toLowerCase() === n.toLowerCase())) list.push(n);
      };
      const slot = { follow: 'follower', sub: 'subscriber', gift: 'gifter' }[type] || type;
      state.latest[slot] = entry;
      state.latest.event = entry;
      if (type === 'follow') add(s.followers, name);
      if (type === 'sub') add(s.subscribers, name);
      if (type === 'gift') s.gifted += Math.max(1, Math.round(valueOf(amount)) || 1);
      if (type === 'cheer') {
        const bits = Math.round(valueOf(amount));
        s.bits += bits;
        s.cheerers[name] = (s.cheerers[name] || 0) + bits;
      }
      if (type === 'donation' || type === 'superchat') {
        const v = valueOf(amount);
        if (!s.topTip || v > s.topTip.value) s.topTip = { ...entry, value: v };
      }
      changed = true;
    }
    if (state.seen.length > 3000) state.seen = state.seen.slice(-2000);
    return changed;
  }

  function fill(format, v) {
    return String(format || '')
      .replace(/\{(name|amount|platform|count|list|title)\}/g, (_, k) => (v[k] ?? '') + '')
      .replace(/\s*\(\)/g, '')
      .trim()
      .slice(0, 500);
  }
  // The text of every label: { id: text }. A label with nothing yet is empty (or the "nothing yet" text).
  function texts(state, settings = {}) {
    const f = settings.formats || {};
    const none = typeof settings.empty === 'string' ? settings.empty.slice(0, 60) : '';
    const s = state.session || newSession(0);
    const out = {};
    const one = (id, v) => {
      const def = LABELS.find(l => l[0] === id)[3];
      out[id] = v ? fill(f[id] || def, v) || none : none;
    };
    for (const slot of [
      'follower',
      'subscriber',
      'gifter',
      'donation',
      'superchat',
      'cheer',
      'kicks',
      'raid',
      'event'
    ])
      one('latest_' + slot, state.latest?.[slot]);
    const count = n => ({ count: String(n) });
    const list = l => (l.length ? { list: l.slice(-10).join(', '), count: String(l.length) } : null);
    one('session_follower_count', count(s.followers.length));
    one('session_subscriber_count', count(s.subscribers.length));
    one('session_gifted_count', count(s.gifted));
    one('session_bits', count(s.bits));
    one('session_followers', list(s.followers));
    one('session_subscribers', list(s.subscribers));
    one('session_top_tip', s.topTip);
    const top = Object.entries(s.cheerers || {}).sort((a, b) => b[1] - a[1])[0];
    one('session_top_cheerer', top && { name: top[0], amount: top[1] + ' bits', count: String(top[1]) });
    return out;
  }

  const api = { LABELS, IDS, kindOf, amountOf, valueOf, collect, texts, newState, newSession, fill };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.streamLabels = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    if (!bridge?.streamLabels) return;
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const KEY = 'uc-stream-labels',
      SETTINGS = 'uc-stream-labels-settings';
    const load = (k, fallback) => {
      try {
        return { ...fallback, ...JSON.parse(localStorage.getItem(k) || '{}') };
      } catch {
        return { ...fallback };
      }
    };
    let settings = load(SETTINGS, { on: true, formats: {}, empty: '', samples: false, autoReset: true });
    let state = load(KEY, newState());
    state.session = { ...newSession(), ...state.session };
    let wasLive = null,
      written = '',
      info = null;
    const persist = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        localStorage.setItem(SETTINGS, JSON.stringify(settings));
      } catch {}
    };
    async function write(force) {
      if (!settings.on) return;
      const labels = texts(state, settings);
      const next = JSON.stringify(labels);
      if (next === written && !force) return;
      const r = await bridge.streamLabels({ op: 'write', labels }).catch(() => null);
      if (r?.ok) {
        written = next;
        info = r.data;
      }
      if (dialog.open) paint();
    }
    window.addEventListener('integrated-assist-state', e => {
      if (collect(state, e.detail?.alerts || [], settings)) {
        persist();
        write();
      } else if (state.seen && !localStorage.getItem(KEY)) persist();
    });
    // A new relay broadcast starts the "this stream" labels again.
    setInterval(() => {
      const live = !!(typeof connected !== 'undefined' && connected && view?.status?.broadcast);
      if (settings.autoReset && wasLive === false && live) newStream();
      if (typeof connected !== 'undefined' && connected) wasLive = live;
    }, 1000);
    function newStream() {
      state.session = newSession();
      persist();
      write();
    }

    // ---- Tools → Stream labels ----
    const dialog = el('dialog');
    dialog.id = 'streamLabelsWindow';
    dialog.setAttribute('aria-label', 'Stream labels');
    const btn = (text, fn) => {
      const b = el('button', text);
      b.type = 'button';
      b.onclick = fn;
      return b;
    };
    const check = (id, text) => {
      const i = el('input');
      i.type = 'checkbox';
      i.id = id;
      const l = el('label', ' ' + text, 'check-row');
      l.prepend(i);
      return [i, l];
    };
    const status = el('p', null, 'hint');
    status.setAttribute('role', 'status');
    status.id = 'streamLabelsStatus';
    const folder = el('p', null, 'labels-folder');
    folder.id = 'streamLabelsFolder';
    const [on, onLabel] = check('streamLabelsOn', 'Keep the label files up to date');
    const [autoReset, autoResetLabel] = check(
      'streamLabelsAutoReset',
      'Start the "this stream" labels again when a relay broadcast starts'
    );
    const [samples, samplesLabel] = check(
      'streamLabelsSamples',
      'Include Stream Assist sample alerts (for testing)'
    );
    const empty = el('input');
    empty.id = 'streamLabelsEmpty';
    empty.maxLength = 60;
    empty.placeholder = 'Leave empty to show nothing';
    const emptyLabel = el('label', 'Text before there is anyone (e.g. "None yet")');
    emptyLabel.append(empty);
    const folderRow = el('div', null, 'assist-actions');
    folderRow.append(
      btn('Choose folder…', async () => {
        const r = await bridge.streamLabels({ op: 'choose-folder' });
        if (r?.ok && r.data) {
          info = r.data;
          written = '';
          await write(true);
          status.textContent =
            'Label files now go to this folder. Sources already in OBS still read the old one.';
        } else if (r && !r.ok) status.textContent = r.error;
        paint();
      }),
      btn('Open folder', () => bridge.streamLabels({ op: 'open-folder' }))
    );
    const table = el('div', null, 'labels-table');
    table.id = 'streamLabelsTable';
    const rows = {};
    for (const [id, group, title, def] of LABELS) {
      const row = el('div', null, 'labels-row');
      row.dataset.label = id;
      const name = el('strong', title);
      const now = el('span', null, 'labels-now');
      now.setAttribute('aria-label', title + ': now showing');
      const format = el('input');
      format.maxLength = 120;
      format.placeholder = def;
      format.setAttribute('aria-label', title + ': format');
      format.addEventListener('change', () => {
        const v = format.value.trim();
        if (v && v !== def) settings.formats[id] = v;
        else delete settings.formats[id];
        persist();
        write();
      });
      const add = btn('Add to OBS', async () => {
        add.disabled = true;
        status.textContent = 'Adding "' + title + '" to OBS…';
        const r = await bridge
          .streamLabels({ op: 'add-to-obs', id, title })
          .catch(e => ({ error: e.message }));
        add.disabled = false;
        status.textContent = r?.ok
          ? `"${r.data.source}" is in the OBS scene "${r.data.scene}". Change its font and colour in OBS (double-click the source).`
          : r?.error || 'Could not add it to OBS.';
      });
      row.append(name, now, format, add);
      row.dataset.group = group;
      rows[id] = { row, now, format };
    }
    table.append(el('h3', 'Latest (kept between streams)'));
    for (const [id, g] of LABELS) if (g === 'latest') table.append(rows[id].row);
    table.append(el('h3', 'This stream'));
    for (const [id, g] of LABELS) if (g === 'session') table.append(rows[id].row);
    const bottom = el('div', null, 'assist-actions');
    bottom.append(
      btn('Start a new stream', () => {
        if (!confirm('Start the "this stream" labels again from zero?')) return;
        newStream();
        status.textContent = 'The "this stream" labels start again from zero.';
      }),
      btn('Clear latest', () => {
        if (!confirm('Clear the latest follower, subscriber, tip and the rest?')) return;
        state.latest = {};
        persist();
        write();
        status.textContent = 'Latest labels cleared.';
      }),
      btn('Close', () => dialog.close())
    );
    dialog.append(
      el('h2', 'Stream labels'),
      el(
        'p',
        'Text files OBS can show, like Streamlabs Stream Labels, for Twitch, YouTube, Kick and Streamlabs tips together. Add to OBS makes a Text source that reads the file; change its font and colour in OBS. Formats can use {name}, {amount}, {platform}, {count}, {list} and {title}. Events come from Stream Assist while it runs.',
        'hint'
      ),
      folder,
      folderRow,
      onLabel,
      autoResetLabel,
      samplesLabel,
      emptyLabel,
      table,
      status,
      bottom
    );
    document.body.append(dialog);
    function paint() {
      const labels = texts(state, settings);
      for (const id of IDS) {
        rows[id].now.textContent = labels[id] || '—';
        if (document.activeElement !== rows[id].format) rows[id].format.value = settings.formats[id] || '';
      }
      folder.textContent = info?.folder ? 'Label files: ' + info.folder : 'Label files: starting…';
      on.checked = settings.on;
      autoReset.checked = settings.autoReset;
      samples.checked = settings.samples;
      if (document.activeElement !== empty) empty.value = settings.empty;
    }
    for (const [input, key] of [
      [on, 'on'],
      [autoReset, 'autoReset'],
      [samples, 'samples']
    ])
      input.addEventListener('change', () => {
        settings[key] = input.checked;
        persist();
        write(true);
      });
    empty.addEventListener('change', () => {
      settings.empty = empty.value.slice(0, 60);
      persist();
      write();
    });
    window.openStreamLabels = async () => {
      status.textContent = '';
      const r = await bridge.streamLabels({ op: 'status' }).catch(() => null);
      if (r?.ok) info = r.data;
      paint();
      if (!dialog.open) dialog.showModal();
      await write(true);
    };
    // The files exist from the start (empty or as last time), so OBS sources never point at a missing file.
    write(true);
  })();
})();
