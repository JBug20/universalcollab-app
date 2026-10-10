'use strict';
// Start the user's own OBS (not the bundled copy) when UniversalCollab opens, minimized to the system tray.
// Off unless chosen in Connect OBS. OBS is only started if it is not already running, and it keeps running when
// UniversalCollab quits (the user owns it). Only an OBS program (obs64.exe / obs) can be set as the path.
const fs = require('node:fs'),
  path = require('node:path'),
  { spawn, execFile } = require('node:child_process');

// --minimize-to-tray needs OBS's "Enable system tray icon" (on by default). --disable-shutdown-check skips the
// "OBS did not shut down properly" prompt, which would otherwise wait unseen in the tray.
const ARGS = ['--minimize-to-tray', '--disable-shutdown-check'];
const NAMES = new Set(['obs64.exe', 'obs.exe', 'obs']);
const isOBS = file =>
  typeof file === 'string' &&
  path.isAbsolute(file) &&
  NAMES.has(path.basename(file).toLowerCase()) &&
  (() => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  })();
const run = (cmd, args) =>
  new Promise(resolve =>
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (e, out) => resolve(e ? '' : String(out)))
  );

// Where OBS is installed: the path OBS's installer records in the registry, then the usual folders.
async function find({ env = process.env, platform = process.platform, query = run } = {}) {
  const candidates = [];
  if (platform === 'win32') {
    for (const key of ['HKLM\\SOFTWARE\\OBS Studio', 'HKLM\\SOFTWARE\\WOW6432Node\\OBS Studio']) {
      const m = /REG_SZ\s+(.+)\s*$/m.exec(await query('reg', ['query', key, '/ve']));
      if (m) candidates.push(path.join(m[1].trim(), 'bin', '64bit', 'obs64.exe'));
    }
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean)) {
      candidates.push(path.join(base, 'obs-studio', 'bin', '64bit', 'obs64.exe'));
      candidates.push(
        path.join(base, 'Steam', 'steamapps', 'common', 'OBS Studio', 'bin', '64bit', 'obs64.exe')
      );
    }
  } else candidates.push('/usr/bin/obs', '/usr/local/bin/obs');
  return candidates.find(isOBS) || '';
}

async function running({ platform = process.platform, query = run } = {}) {
  if (platform === 'win32')
    return /obs64\.exe/i.test(await query('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH']));
  return (await query('pgrep', ['-x', 'obs'])).trim() !== '';
}

exports.ARGS = ARGS;
exports.isOBS = isOBS;
exports.find = find;
exports.running = running;
exports.create = ({
  app,
  dialog,
  getWindow,
  spawnProcess = spawn,
  platform = process.platform,
  query = run
}) => {
  const file = path.join(app.getPath('userData'), 'own-obs.json');
  let settings = { enabled: false, path: '' };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings = { enabled: saved.enabled === true, path: isOBS(saved.path) ? saved.path : '' };
  } catch {}
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(settings));
    fs.renameSync(file + '.tmp', file);
  };
  let launched = false;
  const exe = async () => (isOBS(settings.path) ? settings.path : await find({ platform, query }));
  const info = async () => {
    const found = await exe();
    return { enabled: settings.enabled, path: found, chosen: !!settings.path, found: !!found, launched };
  };
  return {
    async handle(op, input = {}) {
      if (op === 'own-obs-info') return info();
      if (op === 'own-obs-set') {
        if (typeof input.enabled !== 'boolean') throw Error('Invalid setting.');
        settings.enabled = input.enabled;
        save();
        return info();
      }
      if (op === 'own-obs-browse') {
        const r = await dialog.showOpenDialog(getWindow(), {
          title: 'Choose your OBS program',
          properties: ['openFile'],
          filters: platform === 'win32' ? [{ name: 'OBS Studio', extensions: ['exe'] }] : []
        });
        if (r.canceled || !r.filePaths[0]) return info();
        if (!isOBS(r.filePaths[0])) throw Error('Choose OBS itself: obs64.exe in OBS’s bin\\64bit folder.');
        settings.path = r.filePaths[0];
        save();
        return info();
      }
      // Once per app start, and only when switched on and OBS is not already running.
      if (op === 'own-obs-autostart') {
        if (!settings.enabled || launched) return { started: false, ...(await info()) };
        launched = true;
        const target = await exe();
        if (!target) throw Error('Your OBS was not found. Choose obs64.exe in Connect OBS.');
        if (await running({ platform, query }))
          return { started: false, alreadyRunning: true, ...(await info()) };
        const child = spawnProcess(target, ARGS, {
          cwd: path.dirname(target),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.on?.('error', () => {});
        child.unref?.();
        return { started: true, ...(await info()) };
      }
      return null;
    }
  };
};
