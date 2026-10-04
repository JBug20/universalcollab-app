'use strict';
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const box = document.createElement('section');
  box.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = 'Destination health';
  const rows = document.createElement('div');
  box.append(heading, rows);
  document.getElementById('streamsPanel').append(box);
  let signature = '',
    pending = false;
  setInterval(() => {
    const outputs = connected && !uncertain ? view?.status?.outputs || [] : [];
    const value = JSON.stringify([outputs, connected, uncertain, pending]);
    if (value === signature) return;
    signature = value;
    rows.replaceChildren();
    if (!outputs.length) {
      rows.textContent =
        connected && !uncertain
          ? 'Start a broadcast to monitor each destination.'
          : 'Connect to the relay to see output health.';
      return;
    }
    for (const output of outputs) {
      const row = document.createElement('div'),
        name = document.createElement('strong'),
        status = document.createElement('p');
      name.textContent = output.name;
      status.textContent =
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
      row.append(name, status);
      if (view.capabilities?.outputControl) {
        for (const [operation, label] of [
          ['restart', 'Restart output'],
          [
            output.state === 'paused' ? 'resume' : 'pause',
            output.state === 'paused' ? 'Resume output' : 'Pause output'
          ]
        ]) {
          const b = document.createElement('button');
          b.textContent = label;
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
          row.append(b);
        }
      } else {
        const hint = document.createElement('p');
        hint.textContent = 'Update the relay to enable individual output controls.';
        row.append(hint);
      }
      rows.append(row);
    }
  }, 1000);
})().catch(() => {});
