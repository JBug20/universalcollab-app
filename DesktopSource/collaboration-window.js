'use strict';
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  if (!window.relayDesktop?.collaboration) return;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const panel = el('dialog');
  panel.id = 'assistCollaborationWindow';
  panel.style.cssText =
    'width:min(720px,90vw);max-height:85vh;overflow:auto;background:#1b1628;color:#f7f0ff;border:1px solid #554366;border-radius:14px;padding:24px';
  const header = el('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  const close = el('button', 'Close');
  close.onclick = () => panel.close();
  header.append(el('h2', 'Collaboration centre'), close);
  panel.append(header);
  const status = el('p'),
    alert = el('p');
  status.setAttribute('role', 'status');
  alert.setAttribute('role', 'alert');
  panel.append(status, alert);
  const peers = el('div'),
    requests = el('div');
  panel.append(el('h3', 'Teammate status'), peers, el('h3', 'Requests'), requests);
  const manage = el('button', 'Manage collaboration requests');
  manage.onclick = () => {
    panel.close();
    document.getElementById('collabButton').click();
  };
  panel.append(manage, el('h3', 'Session reminder'));
  const text = el('input');
  text.maxLength = 500;
  text.placeholder = 'What would you like to remember?';
  text.setAttribute('aria-label', 'Reminder');
  text.style.width = '100%';
  const due = el('input');
  due.type = 'datetime-local';
  due.setAttribute('aria-label', 'Reminder time');
  due.style.margin = '12px 0';
  const save = el('button', 'Save reminder'),
    clear = el('button', 'Clear reminder');
  panel.append(
    text,
    due,
    el('p', 'Local time. Keep UniversalCollab open to receive reminders.'),
    save,
    clear
  );
  document.body.append(panel);
  let account = '',
    lastSession = '',
    signature = '',
    loading = false,
    dirty = false;
  const shown = new Set();
  text.oninput = due.oninput = () => {
    dirty = true;
  };
  function open() {
    if (!panel.open) panel.show();
    applyPlacement();
  }

  const layoutKey = 'uc-collaboration-placement-v1';
  let placement = { dock: 'floating', x: 80, y: 80, sizes: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey));
    if (saved && ['floating', 'dockLeft', 'dockRight', 'dockBottom'].includes(saved.dock))
      placement = {
        dock: saved.dock,
        x: Number.isFinite(saved.x) ? saved.x : 80,
        y: Number.isFinite(saved.y) ? saved.y : 80,
        sizes: saved.sizes && typeof saved.sizes === 'object' ? saved.sizes : {}
      };
  } catch {}
  const docking = el('select');
  docking.setAttribute('aria-label', 'Collaboration centre position');
  for (const [value, label] of [
    ['floating', 'Floating window'],
    ['dockLeft', 'Dock left'],
    ['dockRight', 'Dock right'],
    ['dockBottom', 'Dock bottom']
  ]) {
    const option = el('option', label);
    option.value = value;
    docking.append(option);
  }
  header.insertBefore(docking, close);
  header.style.flexWrap = 'wrap';
  header.style.gap = '8px';
  header.style.touchAction = 'none';
  header.tabIndex = 0;
  header.setAttribute('aria-label', 'Move collaboration window. Use arrow keys when floating.');
  function storePlacement() {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(placement));
    } catch {}
  }
  window.workspaceUI.titles.assistCollaboration = 'Collaboration centre';
  panel.addEventListener('close', () => {
    if (!panel.open) {
      delete panel.dataset.dock;
      window.dispatchEvent(new Event('panels-changed'));
    }
  });
  function applyPlacement() {
    const floating = placement.dock === 'floating';
    const parent = floating ? document.body : document.getElementById(placement.dock);
    if (panel.parentElement !== parent) parent.append(panel);
    docking.value = placement.dock;
    panel.style.position = floating ? 'fixed' : 'relative';
    panel.style.margin = '0';
    panel.style.width = floating ? 'min(720px,90vw)' : '100%';
    panel.style.boxSizing = 'border-box';
    panel.style.minWidth = '0';
    panel.style.height = floating ? '' : 'min(620px,70vh)';
    panel.style.maxHeight = floating ? '85vh' : '70vh';
    panel.style.padding = floating ? '24px' : '14px';
    panel.style.zIndex = floating ? '10000' : 'auto';
    panel.style.resize = 'none';
    const custom = placement.sizes[placement.dock];
    if (custom && Number.isFinite(custom.width) && Number.isFinite(custom.height)) {
      panel.style.width =
        Math.max(180, Math.min(custom.width, floating ? innerWidth * 0.9 : parent.clientWidth)) + 'px';
      panel.style.height = Math.max(180, Math.min(custom.height, innerHeight * 0.9)) + 'px';
    }
    panel.style.maxWidth = '100%';
    panel.style.maxHeight = '90vh';
    panel.style.flexShrink = '0';
    header.style.cursor = floating ? 'move' : 'default';
    if (floating) {
      placement.x = Math.max(0, Math.min(innerWidth - panel.getBoundingClientRect().width, placement.x));
      placement.y = Math.max(0, Math.min(innerHeight - 60, placement.y));
      panel.style.left = placement.x + 'px';
      panel.style.top = placement.y + 'px';
    } else {
      panel.style.left = 'auto';
      panel.style.top = 'auto';
    }
    due.style.maxWidth = '100%';
    if (!floating) {
      panel.style.height = '';
      panel.style.width = placement.dock === 'dockBottom' ? '0px' : '100%';
      panel.style.minHeight = '65px';
      panel.style.maxHeight = 'none';
      panel.style.flex = '1 1 0px';
      panel.classList.add('card');
      if (panel.open) panel.dataset.dock = 'assistCollaboration';
      else delete panel.dataset.dock;
    } else {
      delete panel.dataset.dock;
      panel.classList.remove('card');
      panel.style.flex = 'none';
      panel.style.minHeight = '180px';
    }
    const grip = panel.querySelector('#collaborationResizeGrip');
    if (grip) grip.hidden = !floating;
    window.dispatchEvent(new Event('panels-changed'));
  }
  docking.onchange = () => {
    placement.dock = docking.value;
    applyPlacement();
    storePlacement();
  };
  let drag = null;
  header.onpointerdown = e => {
    if (placement.dock !== 'floating' || e.button !== 0 || e.target.closest('button,select')) return;
    drag = { x: e.clientX, y: e.clientY, left: placement.x, top: placement.y };
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  header.onpointermove = e => {
    if (!drag) return;
    placement.x = drag.left + e.clientX - drag.x;
    placement.y = drag.top + e.clientY - drag.y;
    applyPlacement();
  };
  header.onpointerup = header.onpointercancel = () => {
    if (drag) {
      drag = null;
      storePlacement();
    }
  };
  header.onkeydown = e => {
    if (e.target !== header || placement.dock !== 'floating') return;
    const movement = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[
      e.key
    ];
    if (movement) {
      e.preventDefault();
      placement.x += movement[0];
      placement.y += movement[1];
      applyPlacement();
      storePlacement();
    }
  };
  window.addEventListener('resize', () => {
    if (panel.open) applyPlacement();
  });
  applyPlacement();

  const resizeHandle = el('button', '↔ Resize ↕');
  resizeHandle.id = 'collaborationResizeGrip';
  resizeHandle.hidden = placement.dock !== 'floating';
  resizeHandle.type = 'button';
  resizeHandle.setAttribute('aria-label', 'Resize collaboration centre. Drag or use arrow keys.');
  resizeHandle.title = 'Drag to resize, or focus and use arrow keys';
  resizeHandle.style.cssText =
    'position:sticky;bottom:0;display:block;margin:12px 0 0 auto;cursor:nwse-resize;touch-action:none;background:#40334f;color:#fff;z-index:2';
  panel.append(resizeHandle);
  let sizing = null;
  function setSize(width, height) {
    placement.sizes[placement.dock] = {
      width: Math.max(
        180,
        Math.min(width, placement.dock === 'floating' ? innerWidth * 0.9 : panel.parentElement.clientWidth)
      ),
      height: Math.max(180, Math.min(height, innerHeight * 0.9))
    };
    applyPlacement();
  }
  resizeHandle.onpointerdown = e => {
    if (e.button !== 0) return;
    const r = panel.getBoundingClientRect();
    sizing = { x: e.clientX, y: e.clientY, width: r.width, height: r.height };
    resizeHandle.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  resizeHandle.onpointermove = e => {
    if (sizing) setSize(sizing.width + e.clientX - sizing.x, sizing.height + e.clientY - sizing.y);
  };
  resizeHandle.onpointerup = resizeHandle.onpointercancel = () => {
    if (sizing) {
      sizing = null;
      storePlacement();
    }
  };
  resizeHandle.onkeydown = e => {
    const movement = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[
      e.key
    ];
    if (movement) {
      e.preventDefault();
      const r = panel.getBoundingClientRect();
      setSize(r.width + movement[0], r.height + movement[1]);
      storePlacement();
    }
  };
  window.openAssistCollaboration = open;
  function localDate(ms) {
    const d = new Date(ms);
    return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  async function edit(remove) {
    const time = remove ? 0 : new Date(due.value).getTime();
    if (!remove && (!text.value.trim() || !Number.isFinite(time) || time <= Date.now())) {
      alert.textContent = 'Enter a reminder and choose a future time.';
      return;
    }
    const result = await window.relayDesktop.collaboration({
      op: 'save',
      account,
      text: remove ? '' : text.value,
      due: time
    });
    if (!result.ok) {
      alert.textContent = result.error;
      return;
    }
    dirty = false;
    text.value = result.reminder.text;
    due.value = result.reminder.due ? localDate(result.reminder.due) : '';
    alert.textContent = remove ? 'Reminder cleared.' : 'Reminder saved.';
  }
  save.onclick = () =>
    edit(false).catch(() => {
      alert.textContent = 'Could not save the reminder.';
    });
  clear.onclick = () =>
    edit(true).catch(() => {
      alert.textContent = 'Could not clear the reminder.';
    });
  function rows(root, items, empty) {
    root.replaceChildren();
    if (!items.length) root.append(el('p', empty));
    for (const [name, state] of items) {
      const row = el('div');
      row.style.cssText =
        'padding:10px 0;border-bottom:1px solid #40334f;display:flex;justify-content:space-between;gap:16px';
      row.append(el('strong', name), el('span', state));
      root.append(row);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const result = await window.relayDesktop.collaboration({ op: 'snapshot' });
      if (!result.ok) {
        status.textContent = result.error;
        return;
      }
      const changed = account !== result.account;
      if (changed) {
        account = result.account;
        dirty = false;
        alert.textContent = '';
        signature = '';
      }
      save.disabled = clear.disabled = !account;
      status.textContent =
        (result.connected ? 'Private Notify connected' : 'Private Notify disconnected') +
        (connected && !uncertain ? ' · Relay connected' : ' · Relay unavailable');
      if (result.connected && lastSession !== result.session) {
        lastSession = result.session;
        open();
      }
      if (!dirty) {
        text.value = result.reminder?.text || '';
        due.value = result.reminder?.due ? localDate(result.reminder.due) : '';
      }
      const reminder = result.reminder,
        key = account + ':' + reminder?.due + ':' + reminder?.text;
      if (
        reminder?.text &&
        !reminder.notified &&
        reminder.due > 0 &&
        reminder.due <= Date.now() &&
        !shown.has(key)
      ) {
        shown.add(key);
        alert.textContent = 'Reminder: ' + reminder.text;
        open();
        await window.relayDesktop.collaboration({ op: 'ack', account, due: reminder.due });
      }
      const data = connected && !uncertain ? view : null,
        next = JSON.stringify([data?.peers, data?.collaborations, data?.requests, data?.me?.id]);
      if (next !== signature) {
        signature = next;
        rows(
          peers,
          (data?.peers || []).map(p => [p.displayName || p.id, p.state || 'Unknown']),
          data ? 'No teammates on this relay yet.' : 'Connect to your relay to see teammate status.'
        );
        const mine = data?.me?.id;
        const name = id => (data?.peers || []).find(p => p.id === id)?.displayName || id;
        rows(
          requests,
          [...(data?.collaborations || []), ...(data?.requests || [])]
            .filter(p => p.owner === mine || p.peer === mine)
            .map(p => [
              (p.peer === mine ? 'From ' : 'To ') + name(p.peer === mine ? p.owner : p.peer),
              p.status || 'Unknown'
            ]),
          data ? 'No collaboration requests.' : 'Requests are unavailable while disconnected.'
        );
      }
      manage.disabled = !data;
    } catch {
      status.textContent = 'Connection status unavailable.';
    } finally {
      loading = false;
    }
  }
  setInterval(refresh, 2500);
  void refresh();
})().catch(() => {});
