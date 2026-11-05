'use strict';
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const panel = window.workspaceUI.panels.get('chat');
  if (!panel) return;
  const original = [...panel.children].filter(
    n => !n.classList.contains('dock-handle') && n.tagName !== 'H2'
  );
  let hidden = [],
    active = '';
  const status = document.createElement('p');
  status.textContent = 'Start Stream Assist for combined chat and sending.';
  const frame = document.createElement('iframe');
  frame.title = 'UniversalCollab combined chat';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.referrerPolicy = 'no-referrer';
  frame.style.cssText = 'width:100%;height:100%;min-height:240px;flex:1;border:0;background:#160f25';
  frame.hidden = true;
  panel.append(status, frame);
  window.addEventListener('integrated-assist-state', event => {
    const url = event.detail?.chatUrl || '';
    if (url) {
      if (!/^http:\/\/127\.0\.0\.1:(18741|18743)\/dock#[a-f0-9]{64}\.[a-f0-9]{64}$/.test(url)) return;
      if (!active) hidden = original.map(n => n.hidden);
      original.forEach(n => (n.hidden = true));
      frame.hidden = false;
      if (url !== active) frame.src = url;
      active = url;
      status.hidden = true;
    } else {
      if (active) original.forEach((n, i) => (n.hidden = hidden[i]));
      active = '';
      frame.hidden = true;
      frame.removeAttribute('src');
      status.hidden = false;
    }
  });
})().catch(() => {});
