'use strict';
// One-click relay ownership and in-app relay updates (Tools → Relay Admin).
(() => {
  const panel = document.getElementById('hostPanel');
  if (!panel) return;
  const make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const btn = (text, fn) => {
    const b = make('button', text);
    b.type = 'button';
    b.onclick = fn;
    return b;
  };
  const box = make('section', null, 'relay-owner');
  box.id = 'relayOwnership';
  const ownerTitle = make('h3', 'Ownership'),
    ownerText = make('p'),
    claimButton = btn('Make me the owner', () => claim('')),
    codeBox = make('details'),
    codeInput = make('input');
  codeBox.append(make('summary', 'Use the setup code instead'));
  codeInput.type = 'password';
  codeInput.autocomplete = 'off';
  codeInput.setAttribute('aria-label', 'Host setup code');
  codeBox.append(
    make(
      'p',
      'Only needed if someone else created the first account on this relay. The code is in data/host-setup-code.txt on the server.',
      'hint'
    ),
    codeInput,
    btn('Claim with code', () => claim(codeInput.value.trim()))
  );
  const softwareTitle = make('h3', 'Relay software'),
    softwareText = make('p'),
    updateButton = btn('Update relay', () => update()),
    status = make('p', null, 'hint');
  status.setAttribute('role', 'status');
  box.append(ownerTitle, ownerText, claimButton, codeBox, softwareTitle, softwareText, updateButton, status);
  panel.querySelector('#hostFeedback')?.after(box);
  let info = null,
    bundled = null,
    busy = false,
    lastAddress = '';
  const say = t => {
    status.textContent = t;
  };
  const shortBuild = b => (b && b !== 'unknown' ? b.slice(0, 8) : 'unknown');
  async function refresh() {
    if (busy) return;
    if (!connected || !profile) {
      info = null;
      window.relayDeviceClaim = false;
      paint();
      return;
    }
    if (profile.address !== lastAddress) {
      lastAddress = profile.address;
      info = null;
    }
    try {
      info = await api('/api/v3/info');
    } catch {
      info = null;
    }
    if (bundled === null && desktop?.relayUpdate) {
      try {
        bundled = (await desktop.relayUpdate({ op: 'bundled' })) || false;
      } catch {
        bundled = false;
      }
    }
    window.relayDeviceClaim = !!info?.capabilities?.ownerDeviceClaim;
    paint();
  }
  function paint() {
    const isHost = !!view?.me?.isHost,
      claimed = !!info?.hostClaimed,
      device = !!info?.capabilities?.ownerDeviceClaim;
    claimButton.hidden = codeBox.hidden = true;
    softwareTitle.hidden = softwareText.hidden = updateButton.hidden = true;
    if (!connected) {
      ownerText.textContent = 'Connect to your relay first.';
      return;
    }
    if (!info) {
      ownerText.textContent = 'Checking the relay…';
      return;
    }
    if (!claimed && device) {
      ownerText.textContent =
        'This relay has no owner yet. If you set it up, claim it with one click. This PC keeps a private owner key, so owner tools and updates work safely over http://.';
      claimButton.hidden = codeBox.hidden = false;
    } else if (!claimed) {
      ownerText.textContent =
        'This relay has no owner yet. One-click ownership needs the relay 1.2.0 update; until then claim it with the setup code over an HTTPS address.';
    } else if (isHost) ownerText.textContent = 'You own this relay.';
    else ownerText.textContent = 'This relay has an owner. Owner tools are available to them only.';
    if (!isHost) return;
    softwareTitle.hidden = softwareText.hidden = false;
    const here = `Relay ${info.version} (build ${shortBuild(info.build)})`,
      app = bundled ? ` · this app includes build ${shortBuild(bundled.build)}` : '';
    if (!info.capabilities?.hostUpdate) {
      softwareText.textContent =
        here + app + '. In-app updates need a one-time manual upload of the relay update files.';
      return;
    }
    if (!bundled) {
      softwareText.textContent = here + '.';
      return;
    }
    const last =
      info.lastUpdate && Date.now() - info.lastUpdate.at < 86400000 && info.lastUpdate.ok === false
        ? ' Last update failed to start and was rolled back.'
        : '';
    if (info.build === bundled.build) {
      softwareText.textContent = here + '. Up to date.' + last;
      return;
    }
    softwareText.textContent = here + app + '. An update is available.' + last;
    updateButton.hidden = false;
  }
  async function claim(code) {
    if (busy) return;
    busy = true;
    claimButton.disabled = true;
    try {
      await api('/api/v3/host-claim-device', code ? { code } : {});
      codeInput.value = '';
      say('You are now the owner of this relay.');
      busy = false;
      await window.refreshRelayView?.();
      await refresh();
      document.getElementById('hostLoad')?.click();
    } catch (e) {
      say(e.message);
    } finally {
      busy = false;
      claimButton.disabled = false;
    }
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function update() {
    if (busy || !bundled || !info) return;
    if (
      !confirm(
        `Update the relay to build ${shortBuild(bundled.build)}?\n\nThe relay restarts (about 10–30 seconds). End all broadcasts first. Your settings, passwords and keys are kept, and the previous version is restored automatically if the new one fails to start.`
      )
    )
      return;
    busy = true;
    updateButton.disabled = true;
    try {
      say('Uploading the update…');
      await desktop.relayUpdate({
        op: 'install',
        address: profile.address,
        token: profile.id + ':' + profile.token
      });
      say('Update installed. The relay is restarting…');
      const end = Date.now() + 150000;
      while (Date.now() < end) {
        await wait(1500);
        let i;
        try {
          i = await api('/api/v3/info');
        } catch {
          continue;
        }
        if (i.build === bundled.build && i.lastUpdate?.ok && i.lastUpdate.build === bundled.build) {
          say('Relay updated and running.');
          info = i;
          break;
        }
        if (
          i.lastUpdate?.ok === false &&
          i.lastUpdate.build === bundled.build &&
          Date.now() - i.lastUpdate.at < 300000
        ) {
          say('The new relay version did not start, so the previous version was restored. Nothing was lost.');
          info = i;
          break;
        }
        if (i.build === bundled.build) say('The relay restarted on the new version. Confirming it stays up…');
      }
      if (Date.now() >= end) say('The relay has not come back yet. Check the server console.');
    } catch (e) {
      say(e.message);
    } finally {
      busy = false;
      updateButton.disabled = false;
      await refresh();
    }
  }
  setInterval(() => {
    if (!document.hidden && !document.getElementById('adminPage')?.hidden) void refresh();
  }, 4000);
  window.addEventListener('focus', () => void refresh());
  void refresh();
})();
