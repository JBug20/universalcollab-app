'use strict';
// Keyboard shortcuts (1.2.0), main process. System-wide shortcuts (they work while a game has focus) for Clip,
// Start/Stop Recording, AFK (switch viewers to a collaborator's stream and back), Studio Mode, Transition and
// muting one audio source. Off until turned on in Tools → Keyboard shortcuts. Stream start/stop and End Relay are
// deliberately not available as shortcuts. A shortcut another program already uses is reported, not taken.
// Presses are sent to the window, which runs them through the same code as the buttons (keyboard-shortcuts.js).
const fs = require('node:fs'),
  path = require('node:path');

const ACTIONS = ['clip', 'record', 'afk', 'studio-mode', 'transition', 'mute'];
const DEFAULTS = {
  clip: 'Ctrl+Alt+C',
  record: 'Ctrl+Alt+R',
  afk: 'Ctrl+Alt+A',
  'studio-mode': '',
  transition: 'Ctrl+Alt+T',
  mute: 'Ctrl+Alt+M'
};
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const KEY =
  /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Num[0-9]|Plus|-|=|\[|\]|;|'|,|\.|\/|\\|`)$/;

// "Ctrl+Alt+C": at least one of Ctrl, Alt or Super (Shift alone would take ordinary typing), then one key.
// F13–F24 may be used alone (they are never typed).
function valid(accel) {
  if (accel === '') return true;
  if (typeof accel !== 'string' || accel.length > 40) return false;
  const parts = accel.split('+');
  const key = parts.pop();
  if (!KEY.test(key)) return false;
  if (new Set(parts).size !== parts.length || parts.some(p => !MODIFIERS.includes(p))) return false;
  return parts.some(p => p !== 'Shift') || /^F(1[3-9]|2[0-4])$/.test(key);
}

exports.ACTIONS = ACTIONS;
exports.DEFAULTS = DEFAULTS;
exports.valid = valid;
exports.start = ({ app, ipcMain, guard, getWindow, globalShortcut }) => {
  const file = path.join(app.getPath('userData'), 'hotkeys.json');
  let settings = { enabled: false, keys: { ...DEFAULTS }, muteSource: '' };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.enabled = saved.enabled === true;
    for (const a of ACTIONS) if (valid(saved.keys?.[a])) settings.keys[a] = saved.keys[a];
    if (typeof saved.muteSource === 'string') settings.muteSource = saved.muteSource.slice(0, 256);
  } catch {}
  let failed = [],
    paused = false;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(settings));
    fs.renameSync(file + '.tmp', file);
  };
  function apply() {
    globalShortcut.unregisterAll();
    failed = [];
    if (!settings.enabled || paused) return;
    for (const action of ACTIONS) {
      const accel = settings.keys[action];
      if (!accel) continue;
      let ok = false;
      try {
        ok = globalShortcut.register(accel, () => {
          const w = getWindow();
          if (w && !w.isDestroyed())
            w.webContents.send('hotkey', {
              action,
              ...(action === 'mute' ? { name: settings.muteSource } : {})
            });
        });
      } catch {}
      if (!ok) failed.push(action);
    }
  }
  const status = () => ({ ...settings, keys: { ...settings.keys }, failed: [...failed], actions: ACTIONS });
  ipcMain.handle('hotkeys', (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'status') return { ok: true, data: status() };
      if (input.op === 'set') {
        const next = { ...settings, keys: { ...settings.keys } };
        if ('enabled' in input) {
          if (typeof input.enabled !== 'boolean') throw Error('Invalid setting.');
          next.enabled = input.enabled;
        }
        if (input.keys) {
          for (const [a, k] of Object.entries(input.keys)) {
            if (!ACTIONS.includes(a)) throw Error('Unknown shortcut.');
            if (!valid(k))
              throw Error(
                'Use Ctrl, Alt or Win with a key, for example Ctrl+Alt+C. Shift alone is not enough.'
              );
            next.keys[a] = k;
          }
          const used = ACTIONS.map(a => next.keys[a]).filter(Boolean);
          if (new Set(used).size !== used.length) throw Error('Two actions have the same shortcut.');
        }
        if ('muteSource' in input) {
          if (typeof input.muteSource !== 'string' || input.muteSource.length > 256)
            throw Error('Invalid setting.');
          next.muteSource = input.muteSource;
        }
        settings = next;
        save();
        apply();
        return { ok: true, data: status() };
      }
      // While a new shortcut is being typed in, the current ones are switched off so they do not fire.
      if (input.op === 'pause' || input.op === 'resume') {
        paused = input.op === 'pause';
        apply();
        return { ok: true, data: status() };
      }
      throw Error('Unknown request.');
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  apply();
  app.on('will-quit', () => globalShortcut.unregisterAll());
};
