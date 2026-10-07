'use strict';
// Destination health: one icon per platform, green when sending, yellow when it has issues, grey when
// disconnected. Hovering (or focusing) an icon shows its kbps and fps; clicking it shows its output controls.
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const SVG = 'http://www.w3.org/2000/svg';
  const PLATFORMS = [
    {
      key: 'youtube',
      label: 'YouTube',
      path: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z'
    },
    {
      key: 'twitch',
      label: 'Twitch',
      path: 'M4.3 2 3 5.4V19h4.6v3h2.6l3-3h3.7L22 13.9V2zm16 11.1-3 3h-4.6l-2.9 2.9v-2.9H5.9V3.7h14.4zM15.7 6.6h1.7v5h-1.7zm-4.6 0h1.7v5h-1.7z'
    },
    {
      key: 'kick',
      label: 'Kick',
      path: 'M3 3h6v5h2V6h2V4h2V3h6v6h-2v2h-2v2h2v2h2v6h-6v-1h-2v-2h-2v-2H9v5H3z'
    }
  ];
  // Relay output states: sending is healthy; connecting, reconnecting, stalled and paused need attention.
  const HEALTH = {
    healthy: { colour: '#3ecf6e', text: 'Healthy' },
    issues: { colour: '#f2c230', text: 'Issues' },
    disconnected: { colour: '#7d7889', text: 'Disconnected' }
  };
  const health = output => (!output ? 'disconnected' : output.state === 'sending' ? 'healthy' : 'issues');
  const platformOf = output => {
    const text = (output.id + ' ' + output.name).toLowerCase();
    return PLATFORMS.find(p => text.includes(p.key))?.key || '';
  };
  const describe = output =>
    output.name +
    ' · ' +
    output.state +
    (Number.isFinite(output.bitrateKbps)
      ? ' · ' +
        Math.round(output.bitrateKbps) +
        ' kbps · ' +
        output.fps +
        ' fps · ' +
        output.reconnects +
        ' reconnects'
      : '');

  const box = document.createElement('section');
  box.className = 'card';
  box.id = 'destinationHealthCard';
  const heading = document.createElement('h3');
  heading.textContent = 'Destination health';
  const icons = document.createElement('div');
  icons.className = 'destination-icons';
  const message = document.createElement('p');
  message.className = 'hint';
  const tip = document.createElement('div');
  tip.className = 'destination-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const controls = document.createElement('div');
  controls.className = 'destination-controls';
  box.append(heading, icons, message, controls);
  document.body.append(tip);
  document.getElementById('streamsPanel').append(box);

  // Styles are in portal.css: the page's Content-Security-Policy blocks inline <style> blocks.

  let signature = '',
    pending = false,
    selected = '',
    hovered = '';
  const tips = new Map();
  function showTip(anchor, text) {
    tip.textContent = text;
    tip.hidden = false;
    const r = anchor.getBoundingClientRect(),
      t = tip.getBoundingClientRect();
    tip.style.left =
      Math.max(4, Math.min(innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2)) + 'px';
    tip.style.top = (r.top - t.height - 8 < 4 ? r.bottom + 8 : r.top - t.height - 8) + 'px';
  }
  const hideTip = () => {
    tip.hidden = true;
  };
  function icon({ key, label, path, outputs }) {
    const state = outputs.length
      ? outputs
          .map(health)
          .sort((a, b) => ['issues', 'healthy'].indexOf(a) - ['issues', 'healthy'].indexOf(b))[0]
      : 'disconnected';
    const b = document.createElement('button');
    b.type = 'button';
    b.style.setProperty('--health', HEALTH[state].colour);
    b.dataset.platform = key;
    b.dataset.health = state;
    const text =
      label +
      ': ' +
      HEALTH[state].text +
      '\n' +
      (outputs.length ? outputs.map(describe).join('\n') : 'Not part of this broadcast');
    tips.set(key, text);
    b.setAttribute('aria-label', text.replaceAll('\n', '. '));
    b.setAttribute('aria-pressed', String(selected === key));
    if (path) {
      const svg = document.createElementNS(SVG, 'svg'),
        p = document.createElementNS(SVG, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      p.setAttribute('d', path);
      p.setAttribute('fill-rule', 'evenodd');
      svg.append(p);
      b.append(svg);
    } else {
      const s = document.createElement('span');
      s.className = 'other';
      s.textContent = label.slice(0, 2).toUpperCase();
      b.append(s);
    }
    b.onpointerenter = b.onfocus = () => {
      hovered = key;
      showTip(b, text);
    };
    b.onpointerleave = b.onblur = () => {
      if (hovered === key) hovered = '';
      hideTip();
    };
    b.onclick = () => {
      selected = selected === key || !outputs.length ? '' : key;
      signature = '';
      paint();
    };
    return b;
  }
  function controlsFor(output) {
    if (!view.capabilities?.outputControl) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Update the relay to enable individual output controls.';
      return [hint];
    }
    return [
      ['restart', 'Restart output'],
      [
        output.state === 'paused' ? 'resume' : 'pause',
        output.state === 'paused' ? 'Resume output' : 'Pause output'
      ]
    ].map(([operation, label]) => {
      const b = document.createElement('button');
      b.textContent = label + (selectedOutputs().length > 1 ? ' · ' + output.name : '');
      b.disabled = pending;
      b.onclick = async () => {
        if (!confirm(label + ' for ' + output.name + '? Other destinations will continue.')) return;
        pending = true;
        try {
          render(await api('/api/v3/output-control', { id: output.id, operation }));
          note(label + ' requested.');
        } catch (e) {
          note(e.message);
        } finally {
          pending = false;
          signature = '';
        }
      };
      return b;
    });
  }
  let current = [];
  const selectedOutputs = () => current.filter(o => (platformOf(o) || 'other:' + o.id) === selected);
  function paint() {
    const live = connected && !uncertain;
    current = live ? view?.status?.outputs || [] : [];
    const value = JSON.stringify([current, live, pending, selected, view?.status?.mode]);
    if (value === signature) return;
    signature = value;
    const entries = PLATFORMS.map(p => ({ ...p, outputs: current.filter(o => platformOf(o) === p.key) }));
    // Destinations that are not YouTube, Twitch or Kick keep a lettered icon of their own.
    for (const o of current.filter(o => !platformOf(o)))
      entries.push({ key: 'other:' + o.id, label: o.name, path: '', outputs: [o] });
    if (selected && !selectedOutputs().length) selected = '';
    const focused = icons.contains(document.activeElement) ? document.activeElement.dataset.platform : '';
    tips.clear();
    icons.replaceChildren(...entries.map(icon));
    const find = key => [...icons.children].find(b => b.dataset.platform === key);
    if (focused) find(focused)?.focus();
    message.textContent = current.length
      ? 'Hover over an icon for kbps and fps. Click it for output controls.'
      : !live
        ? 'Connect to the relay to see output health.'
        : view?.status?.mode === 'test'
          ? 'The relay is in TEST mode, so nothing is sent to platforms and the icons stay grey.'
          : 'Icons light up when a broadcast is live.';
    controls.replaceChildren(...selectedOutputs().flatMap(controlsFor));
    // Icons are rebuilt when anything changes; keep the hover box on the same platform with fresh numbers.
    const anchor = hovered && find(hovered);
    if (anchor) showTip(anchor, tips.get(hovered));
    else {
      hovered = '';
      hideTip();
    }
  }
  paint();
  setInterval(paint, 1000);
})().catch(() => {});
