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
  // The Collaboration centre is a section of the Collab popup (bottom-left Collab button), not a separate dock.
  const menu = document.getElementById('collabMenu');
  if (!menu) return;
  let panel = document.getElementById('collabCentre');
  if (!panel) {
    panel = el('section');
    panel.id = 'collabCentre';
    panel.className = 'assist-card';
    panel.append(
      el('h3', 'Collaboration centre'),
      el('p', 'Use teammate status, requests and reminders in UniversalCollab.')
    );
    menu.insertBefore(panel, menu.querySelector('[data-close="collabMenu"]'));
  }
  const status = el('p'),
    alert = el('p');
  status.setAttribute('role', 'status');
  alert.setAttribute('role', 'alert');
  panel.append(status, alert);
  const peers = el('div'),
    requests = el('div');
  panel.append(
    el('h4', 'Teammate status'),
    peers,
    el('h4', 'Requests'),
    requests,
    el('h4', 'Session reminder')
  );
  const text = el('input');
  text.maxLength = 500;
  text.placeholder = 'What would you like to remember?';
  text.setAttribute('aria-label', 'Reminder');
  text.style.width = '100%';
  const due = el('input');
  due.type = 'datetime-local';
  due.setAttribute('aria-label', 'Reminder time');
  due.style.margin = '12px 0';
  due.style.maxWidth = '100%';
  const save = el('button', 'Save reminder'),
    clear = el('button', 'Clear reminder');
  save.type = clear.type = 'button';
  panel.append(
    text,
    due,
    el('p', 'Local time. Keep UniversalCollab open to receive reminders.'),
    save,
    clear
  );
  let account = '',
    signature = '',
    loading = false,
    dirty = false;
  const shown = new Set();
  text.oninput = due.oninput = () => {
    dirty = true;
  };
  function open() {
    if (!menu.open) document.getElementById('collabButton').click();
    panel.scrollIntoView({ block: 'nearest' });
  }
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
    } catch {
      status.textContent = 'Connection status unavailable.';
    } finally {
      loading = false;
    }
  }
  setInterval(refresh, 2500);
  void refresh();
})().catch(() => {});
