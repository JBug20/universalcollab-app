'use strict';
// App updates (1.2.0), window side. Help → Check for updates shows the version, checks GitHub Releases and
// offers Restart to update once a signed update is downloaded; an "Update ready" button appears in the menu bar.
// The update itself is checked and installed by app-update.cjs.
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const bridge = window.relayDesktop;
  if (!bridge?.appUpdate) return;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const dialog = el('dialog');
  dialog.id = 'appUpdateWindow';
  dialog.setAttribute('aria-label', 'Updates');
  const version = el('p'),
    status = el('p'),
    notes = el('pre');
  status.setAttribute('role', 'status');
  notes.className = 'app-update-notes';
  const auto = el('input');
  auto.type = 'checkbox';
  auto.id = 'appUpdateAuto';
  const autoLabel = el('label', ' Check for updates automatically');
  autoLabel.prepend(auto);
  const check = el('button', 'Check now'),
    restart = el('button', 'Restart to update'),
    page = el('button', 'Open release page'),
    close = el('button', 'Close');
  for (const b of [check, restart, page, close]) b.type = 'button';
  restart.className = 'primary';
  const row = el('div');
  row.className = 'assist-actions';
  row.append(check, restart, page, close);
  const hint = el(
    'p',
    'Updates come from the UniversalCollab releases on GitHub and are only installed when they carry the UniversalCollab signature. A downloaded update is installed when you close UniversalCollab. Closing the app does not stop a relay broadcast.'
  );
  hint.className = 'hint';
  dialog.append(el('h2', 'Updates'), version, status, notes, autoLabel, row, hint);
  document.body.append(dialog);

  const notice = el('button', 'Update ready');
  notice.type = 'button';
  notice.id = 'appUpdateNotice';
  notice.hidden = true;
  notice.title = 'A new version of UniversalCollab is ready to install';
  document.getElementById('settingsGear')?.before(notice);

  let info = null;
  function paint() {
    if (!info) return;
    version.textContent = 'This version: ' + info.version;
    const v = info.latest?.version;
    status.textContent =
      {
        checking: 'Checking for updates…',
        downloading: `Downloading ${v}…`,
        latest: 'UniversalCollab is up to date.',
        ready: `Version ${v} is downloaded. It installs when you close UniversalCollab, or now with Restart to update.`,
        available: `Version ${v} is available. ${info.message || ''}`,
        installer: `Version ${v} is available. ${info.message || ''}`,
        error: 'Could not check for updates: ' + (info.error || 'unknown problem')
      }[info.state] || (info.repo ? '' : 'Updates are not set up in this build.');
    notes.textContent = v && info.state !== 'latest' ? info.latest.notes || '' : '';
    notes.hidden = !notes.textContent;
    auto.checked = !!info.auto;
    check.disabled = !info.repo || ['checking', 'downloading'].includes(info.state);
    restart.hidden = info.state !== 'ready';
    page.hidden = !info.latest?.page || info.state === 'latest';
    notice.hidden = info.state !== 'ready';
  }
  async function request(input) {
    const r = await bridge.appUpdate(input);
    if (!r.ok) {
      status.textContent = r.error;
      return;
    }
    info = r.data;
    paint();
  }
  bridge.onAppUpdate(data => {
    info = data;
    paint();
  });
  check.onclick = () => request({ op: 'check' });
  auto.onchange = () => request({ op: 'set-auto', auto: auto.checked });
  page.onclick = () => request({ op: 'open-page' });
  restart.onclick = () => {
    if (
      confirm(
        'Restart UniversalCollab now to install the update? A relay broadcast keeps running; OBS asks first if it is streaming or recording.'
      )
    )
      void request({ op: 'restart' });
  };
  close.onclick = () => dialog.close();
  window.openAppUpdates = async () => {
    if (!dialog.open) dialog.showModal();
    await request({ op: 'status' });
  };
  notice.onclick = () => window.openAppUpdates();
  await request({ op: 'status' });
})().catch(() => {});
