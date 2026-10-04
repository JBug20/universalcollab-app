'use strict';
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const api = window.relayDesktop?.assist;
  if (!api) return;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };

  // Stream Assist is a docked workspace panel (default: bottom row). Its title bar moves it like any other panel.
  const hub = el('section');
  hub.id = 'assistHub';
  hub.className = 'card assist-panel';
  hub.dataset.dock = 'assist';
  hub.setAttribute('aria-label', 'Stream Assist');
  const handle = el('div', 'Stream Assist');
  handle.className = 'dock-handle';
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', 'Move Stream Assist panel');
  handle.ondragstart = e => {
    if (!window.workspaceUI.getWorkspace().unlocked) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', 'assist');
  };
  hub.append(handle);

  const status = el('p', 'Start Assist to use alerts, combined chat and integrations.');
  status.setAttribute('role', 'status');
  hub.append(status);
  const linux = /Linux/.test(navigator.userAgent);
  const notice = el(
    'p',
    linux
      ? 'Uses your UniversalStream Assist (Linux) accounts and settings, kept in your desktop keyring. Close the separate UniversalStream Assist app before starting.'
      : 'Uses your existing private Assist settings securely on this Windows account. Close the separate Assist app before starting.'
  );
  notice.className = 'assist-muted';
  hub.append(notice);
  const top = el('div');
  top.className = 'assist-actions';
  hub.append(top);
  function button(label, action, parent = top) {
    const b = el('button', label);
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api({ op: 'action', action });
        if (!r.ok) status.textContent = r.error;
      } catch {
        status.textContent = 'Assist is unavailable.';
      } finally {
        b.disabled = false;
      }
    };
    parent.append(b);
    return b;
  }
  const start = el('button', 'Start Assist');
  start.onclick = async () => {
    const r = await api({ op: 'start' });
    status.textContent = r.ok ? 'Starting Assist…' : r.error;
  };
  top.append(start);
  const stop = el('button', 'Stop Assist');
  stop.onclick = async () => {
    if (confirm('Stop alerts, chat and Assist integrations? Your broadcast relay will continue.'))
      await api({ op: 'stop' });
  };
  top.append(stop);
  button('Connect saved accounts', 'connectSaved');
  button('Manage accounts', 'accounts');
  const nav = el('nav');
  nav.setAttribute('aria-label', 'Stream Assist sections');
  hub.append(nav);
  const pages = {};
  for (const name of ['Activity', 'Notifications', 'Integrations', 'Chat & OBS']) {
    const page = el('section');
    pages[name] = page;
    hub.append(page);
    const b = el('button', name);
    b.onclick = () => {
      for (const [key, p] of Object.entries(pages)) p.hidden = key !== name;
      for (const item of nav.children) item.setAttribute('aria-pressed', String(item === b));
    };
    nav.append(b);
    page.hidden = name !== 'Activity';
    b.setAttribute('aria-pressed', String(name === 'Activity'));
  }
  const accounts = el('div');
  accounts.className = 'assist-account-grid';
  pages.Activity.append(accounts);
  const filter = el('input');
  filter.placeholder = 'Search alerts by viewer, platform or event';
  filter.setAttribute('aria-label', 'Search alert history');
  pages.Activity.append(filter);
  const feed = el('div');
  feed.className = 'assist-feed';
  pages.Activity.append(feed);
  let lastState = null,
    signature = '';
  function renderFeed() {
    const items = (lastState?.alerts || []).filter(a =>
      [a.name, a.platform, a.kind, a.detail].join(' ').toLowerCase().includes(filter.value.toLowerCase())
    );
    const next = JSON.stringify(items);
    if (next === signature) return;
    signature = next;
    feed.replaceChildren();
    if (!items.length) feed.append(el('p', 'No matching alerts yet.'));
    for (const a of items) {
      const row = el('article');
      row.className = 'assist-card';
      row.append(
        el('strong', `${a.name} · ${a.kind}${a.demo ? ' · Sample' : ''}`),
        el('p', a.detail),
        el('small', `${a.platform} · ${a.time}`)
      );
      feed.append(row);
    }
  }
  filter.oninput = renderFeed;
  button('Pop out alerts', 'popout', pages.Activity);
  button('Try sample alerts', 'samples', pages.Activity);
  // Connection health opens inside the app: Assist's own health window never appeared in the combined
  // app and, being modal, blocked every other Assist action until it timed out.
  const health = el('dialog');
  health.id = 'assistHealthWindow';
  health.setAttribute('aria-label', 'Connection health');
  const healthList = el('div');
  const healthClose = el('button', 'Close');
  healthClose.type = 'button';
  healthClose.onclick = () => health.close();
  health.append(el('h2', 'Connection health'), healthList, healthClose);
  document.body.append(health);
  function renderHealth() {
    if (!health.open) return;
    healthList.replaceChildren();
    if (!lastState) {
      healthList.append(el('p', 'Start Assist to see connection health.'));
      return;
    }
    for (const a of lastState.accounts || []) {
      // Alerts arrive newest first.
      const last = (lastState.alerts || []).find(x => x.platform === a.name && !x.demo);
      const row = el('article');
      row.className = 'assist-card';
      row.append(
        el('h3', a.name),
        el('p', a.status),
        el('small', 'Last received event: ' + (last ? last.time : 'None yet'))
      );
      healthList.append(row);
    }
  }
  const healthButton = el('button', 'Connection health');
  healthButton.onclick = () => {
    health.showModal();
    renderHealth();
  };
  pages.Activity.append(healthButton);
  function card(parent, title, description, actions) {
    const c = el('section');
    c.className = 'assist-card';
    c.append(el('h3', title), el('p', description));
    const row = el('div');
    row.className = 'assist-actions';
    for (const [label, action] of actions) button(label, action, row);
    c.append(row);
    parent.append(c);
  }
  card(
    pages.Notifications,
    'Sounds and desktop alerts',
    'Choose sounds, volume, per-event preferences, quiet time and history retention.',
    [
      ['Notification settings', 'notifications'],
      ['Alert preferences', 'preferences'],
      ['Toggle sound', 'toggleSound'],
      ['Toggle desktop pop-ups', 'togglePopups']
    ]
  );
  card(pages.Integrations, 'Pulsoid', 'Heart-rate monitoring and event actions.', [
    ['Configure Pulsoid', 'pulsoid']
  ]);
  card(
    pages.Integrations,
    'Streamer.bot & Lumia Stream',
    'Map stream events to your local automation actions.',
    [['Configure actions', 'tools']]
  );
  card(pages.Integrations, 'Stream Deck', 'Pair your existing Stream Deck controls.', [
    ['Configure Stream Deck', 'streamDeck']
  ]);
  card(
    pages.Integrations,
    'Collaboration centre',
    'Use teammate status, requests and reminders in UniversalCollab.',
    [['Relay notification connection', 'collaboration']]
  );
  card(
    pages['Chat & OBS'],
    'Combined chat',
    'The workspace Chat panel automatically uses your Assist chats once Assist starts. Choose all or individual platforms when sending.',
    [
      ['Pop out chat', 'chatPopout'],
      ['Fonts and colours', 'appearance'],
      ['Emotes', 'emotes']
    ]
  );
  card(
    pages['Chat & OBS'],
    'OBS dock and browser source',
    'Copy the existing local OBS links. Keep UniversalCollab running while using them.',
    [['OBS links', 'obs']]
  );
  function open() {
    const ui = window.workspaceUI;
    if (ui.getWorkspace().hidden?.includes('assist')) ui.setPanelVisible('assist', true);
    if (document.getElementById('studioPage')?.hidden) ui.setPage?.('studio');
    hub.hidden = false;
    hub.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    handle.focus({ preventScroll: true });
  }
  const anchor = document.getElementById('settingsGear') || document.querySelector('[data-page="settings"]');
  const launch = el('button', 'Stream Assist');
  launch.onclick = open;
  if (anchor) anchor.parentNode.insertBefore(launch, anchor);
  else document.body.append(launch);
  const summary = el('p'),
    recent = el('div');
  {
    const ui = window.workspaceUI;
    ui.panels.set('assist', hub);
    ui.titles.assist = 'Stream Assist';
    const key = 'uc-assist-dock-bottom-v1';
    let moved = false;
    try {
      moved = localStorage.getItem(key) === '1';
    } catch {}
    const placed = Object.values(ui.getWorkspace().order || {}).some(
      list => Array.isArray(list) && list.includes('assist')
    );
    if (!moved || !placed) {
      document.getElementById('dockBottom').append(hub);
      ui.saveWorkspace();
      try {
        localStorage.setItem(key, '1');
      } catch {}
    } else ui.workspacePaint();
    window.dispatchEvent(new Event('panels-changed'));
  }
  let busy = false,
    accountSignature = '',
    recentSignature = '';
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const r = await api({ op: 'status' });
      start.disabled = r.running;
      lastState = r.state;
      const s = r.state;
      summary.textContent = r.error || (s ? 'Assist running' : 'Assist stopped');
      if (s) {
        status.textContent =
          r.error ||
          s.error ||
          `Assist running · Sound ${s.sound ? 'on' : 'off'} · Desktop alerts ${s.popups ? 'on' : 'off'}`;
        const next = JSON.stringify(s.accounts);
        if (next !== accountSignature) {
          accountSignature = next;
          accounts.replaceChildren();
          for (const a of s.accounts) {
            const box = el('div');
            box.className = 'assist-card';
            box.append(el('h3', a.name), el('p', a.identity), el('small', a.status));
            accounts.append(box);
          }
        }
        renderFeed();
        renderHealth();
        const brief = JSON.stringify(s.alerts.slice(0, 8));
        if (brief !== recentSignature) {
          recentSignature = brief;
          recent.replaceChildren();
          for (const a of s.alerts.slice(0, 8))
            recent.append(el('p', `${a.platform} · ${a.name} · ${a.kind}\n${a.detail}`));
        }
      } else if (r.error) status.textContent = r.error;
      window.dispatchEvent(new CustomEvent('integrated-assist-state', { detail: s }));
    } catch {
      summary.textContent = 'Assist status unavailable.';
    } finally {
      busy = false;
    }
  }
  await poll();
  setInterval(poll, 1000);
})().catch(() => {});
