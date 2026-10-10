'use strict';
// Keyboard shortcuts and AFK (1.2.0), window side.
// - AFK: during a live relay broadcast, switches what viewers see to your first fallback collaborator's stream
//   (End Relay ⚙ → fallback; your reconnect image if none is chosen) and back. It uses the relay's "Show fallback
//   now". A banner shows while viewers are watching someone else, with I'm back.
// - Tools → Keyboard shortcuts: turn system-wide shortcuts on, set a key for each action (press the keys), and choose
//   which audio source the Mute shortcut mutes. Presses come from hotkeys.cjs and run through the same code as the
//   buttons and Stream Deck keys (window.runControlAction in remote-control.js).
(() => {
  const NAMES = {
    clip: 'Clip',
    record: 'Start / stop recording',
    afk: 'AFK: switch to a collaborator and back',
    'studio-mode': 'Studio Mode on / off',
    transition: 'Transition (Studio Mode)',
    mute: 'Mute / unmute an audio source'
  };
  // KeyboardEvent → Electron accelerator ("Ctrl+Alt+C"). Null while only modifiers are held.
  function accelerator(e) {
    const c = e.code || '';
    let key = null;
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
    else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
    else if (/^Numpad[0-9]$/.test(c)) key = 'Num' + c.slice(6);
    else
      key =
        {
          Space: 'Space',
          Tab: 'Tab',
          Backspace: 'Backspace',
          Delete: 'Delete',
          Insert: 'Insert',
          Home: 'Home',
          End: 'End',
          PageUp: 'PageUp',
          PageDown: 'PageDown',
          ArrowUp: 'Up',
          ArrowDown: 'Down',
          ArrowLeft: 'Left',
          ArrowRight: 'Right',
          Minus: '-',
          Equal: '=',
          BracketLeft: '[',
          BracketRight: ']',
          Semicolon: ';',
          Quote: "'",
          Comma: ',',
          Period: '.',
          Slash: '/',
          Backslash: '\\',
          Backquote: '`'
        }[c] || null;
    if (!key) return null;
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key]
      .filter(Boolean)
      .join('+');
  }
  const display = a => (a || '').replace('Super', 'Win');
  const api = { accelerator, NAMES };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.keyboardShortcuts = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };

    // ---- AFK ----
    const target = () => view?.me?.settings?.fallback?.[0] || '';
    const afkActive = () => !!(connected && view?.status?.forcedFallback);
    async function toggle() {
      if (!connected || uncertain) throw Error('Connect to the relay first.');
      if (!view?.status?.broadcast) throw Error('AFK works during a live relay broadcast.');
      if (view?.capabilities?.manualFallback === false)
        throw Error('This relay does not support switching to fallback.');
      const going = !afkActive();
      if (!(await change('/api/' + (going ? 'force-fallback' : 'restore-primary'))))
        throw Error('The relay did not confirm the switch.');
      const msg = going
        ? target()
          ? `AFK: viewers now see ${target()}'s stream. Press the AFK shortcut or I'm back to return.`
          : 'AFK: viewers now see your reconnect image (choose a collaborator in End Relay ⚙ → fallback to show their stream instead).'
        : 'Welcome back: viewers see your stream again.';
      note(msg);
      paintBanner();
      return msg;
    }
    window.afkMode = {
      toggle,
      get active() {
        return afkActive();
      }
    };
    const banner = el('div', null, 'afk-banner');
    banner.id = 'afkBanner';
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    const bannerText = el('span');
    const back = el('button', "I'm back");
    back.type = 'button';
    back.onclick = () => toggle().catch(e => note(e.message));
    banner.append(bannerText, back);
    document.body.append(banner);
    function paintBanner() {
      const on = afkActive();
      banner.hidden = !on;
      if (on)
        bannerText.textContent = target()
          ? `AFK · viewers are watching ${target()}'s stream`
          : 'AFK · viewers see your reconnect image';
    }
    setInterval(paintBanner, 1000);

    // ---- shortcut presses ----
    bridge?.onHotkey?.(async ({ action, name }) => {
      try {
        if (!window.runControlAction) throw Error('UniversalCollab is still starting.');
        if (action === 'mute' && !name)
          throw Error('Choose which audio source to mute in Tools → Keyboard shortcuts.');
        const r = await window.runControlAction(action, { name });
        if (action !== 'afk' && typeof r === 'string' && r) note(r);
        else if (action === 'clip' || action === 'record' || action === 'mute' || action === 'transition')
          note(NAMES[action] + ': done.');
      } catch (e) {
        note(NAMES[action] + ': ' + (e?.message || 'failed.'));
      }
    });
    if (!bridge?.hotkeys) return;

    // ---- Tools → Keyboard shortcuts ----
    const dialog = el('dialog');
    dialog.id = 'keyboardShortcutsWindow';
    dialog.setAttribute('aria-label', 'Keyboard shortcuts');
    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.id = 'hotkeysEnabled';
    const enabledLabel = el('label', ' Keyboard shortcuts on (they also work while a game or OBS has focus)');
    enabledLabel.prepend(enabled);
    const table = el('div', null, 'hotkey-rows');
    const muteSource = el('select');
    muteSource.id = 'hotkeyMuteSource';
    const muteLabel = el('label', 'Mute shortcut mutes ');
    muteLabel.append(muteSource);
    const status = el('p', null, 'hint');
    status.setAttribute('role', 'status');
    const hint = el(
      'p',
      'Click a shortcut, then press the keys (Ctrl, Alt or Win with a key). Backspace clears it, Esc cancels. Starting or stopping the stream and ending the relay are not available as shortcuts, so they cannot happen by accident. A shortcut another program already uses is shown in red and does nothing until you choose a different one.',
      'hint'
    );
    const reset = el('button', 'Reset to defaults'),
      close = el('button', 'Close');
    reset.type = close.type = 'button';
    const row = el('div', null, 'assist-actions');
    row.append(reset, close);
    dialog.append(el('h2', 'Keyboard shortcuts'), enabledLabel, table, muteLabel, status, row, hint);
    document.body.append(dialog);

    let info = null,
      capturing = null;
    async function request(input) {
      const r = await bridge.hotkeys(input);
      if (!r?.ok) {
        status.textContent = r?.error || 'Could not save.';
        return false;
      }
      info = r.data;
      paint();
      return true;
    }
    function paint() {
      if (!info) return;
      enabled.checked = info.enabled;
      table.replaceChildren(
        ...info.actions.map(action => {
          const r = el('div', null, 'hotkey-row');
          const name = el('span', NAMES[action]);
          const key = el('button', null, 'hotkey-key');
          key.type = 'button';
          key.dataset.action = action;
          const bad = info.enabled && info.failed.includes(action);
          key.classList.toggle('in-use', bad);
          key.textContent = capturing === action ? 'Press keys…' : display(info.keys[action]) || 'Not set';
          key.title = bad ? 'Another program already uses this shortcut' : 'Click to change';
          key.onclick = () => startCapture(action);
          r.append(name, key);
          return r;
        })
      );
      const names = (window.streamControls?.state()?.inputs || []).map(i => i.name);
      if (info.muteSource && !names.includes(info.muteSource)) names.unshift(info.muteSource);
      muteSource.replaceChildren(
        new Option('Choose an audio source', ''),
        ...names.map(n => new Option(n, n))
      );
      muteSource.value = info.muteSource || '';
      const bad = info.enabled ? info.failed.map(a => NAMES[a]) : [];
      if (!capturing)
        status.textContent = !info.enabled
          ? 'Shortcuts are off.'
          : bad.length
            ? 'In use by another program: ' + bad.join(', ') + '. Choose different keys.'
            : 'Shortcuts are on.';
    }
    async function startCapture(action) {
      capturing = action;
      await request({ op: 'pause' });
      status.textContent = 'Press the new shortcut for ' + NAMES[action] + '.';
      paint();
    }
    async function endCapture(keys) {
      const action = capturing;
      capturing = null;
      if (keys !== undefined) await request({ op: 'set', keys: { [action]: keys } });
      await request({ op: 'resume' });
    }
    // Listened for on the whole window: redrawing the list moves keyboard focus off the clicked button.
    window.addEventListener(
      'keydown',
      e => {
        if (!capturing || !dialog.open) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) return void endCapture();
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey)
          return void endCapture('');
        const a = accelerator(e);
        if (a) void endCapture(a);
      },
      true
    );
    // Esc while typing a shortcut cancels it instead of closing the window.
    dialog.addEventListener('cancel', e => {
      if (capturing) e.preventDefault();
    });
    dialog.addEventListener('close', () => {
      if (capturing) void endCapture();
    });
    enabled.onchange = () => request({ op: 'set', enabled: enabled.checked });
    muteSource.onchange = () => request({ op: 'set', muteSource: muteSource.value });
    reset.onclick = () =>
      request({
        op: 'set',
        keys: {
          clip: 'Ctrl+Alt+C',
          record: 'Ctrl+Alt+R',
          afk: 'Ctrl+Alt+A',
          'studio-mode': '',
          transition: 'Ctrl+Alt+T',
          mute: 'Ctrl+Alt+M'
        }
      });
    close.onclick = () => dialog.close();
    window.openKeyboardShortcuts = async () => {
      if (!dialog.open) dialog.showModal();
      await request({ op: 'status' });
    };
  })().catch(() => {});
})();
