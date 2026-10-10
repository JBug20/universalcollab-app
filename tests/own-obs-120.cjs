// Start your own OBS with UniversalCollab, minimized to the tray (1.2.0): finding OBS, launching once,
// never twice, never while OBS is already running, and only ever an OBS program.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  own = require('../DesktopSource/own-obs.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-own-obs-'));
  try {
    const install = path.join(dir, 'Program Files', 'obs-studio');
    const exe = path.join(install, 'bin', '64bit', 'obs64.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    const other = path.join(dir, 'notepad.exe');
    fs.writeFileSync(other, '');

    // Only OBS itself counts as an OBS program.
    assert.equal(own.isOBS(exe), true);
    assert.equal(own.isOBS(other), false);
    assert.equal(own.isOBS('obs64.exe'), false, 'relative paths are refused');

    // Found through the path OBS's installer records in the registry.
    let tasks = '';
    const query = async (cmd, args) => {
      if (cmd === 'reg' && args[1] === 'HKLM\\SOFTWARE\\OBS Studio')
        return `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\OBS Studio\r\n    (Default)    REG_SZ    ${install}\r\n`;
      if (cmd === 'tasklist') return tasks;
      return '';
    };
    assert.equal(await own.find({ platform: 'win32', env: {}, query }), exe);
    // Or the usual install folder.
    assert.equal(
      await own.find({
        platform: 'win32',
        env: { ProgramFiles: path.join(dir, 'Program Files') },
        query: async () => ''
      }),
      exe
    );

    const spawned = [];
    const make = () =>
      own.create({
        app: { getPath: () => dir },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [other] }) },
        getWindow: () => null,
        platform: 'win32',
        query,
        spawnProcess: (file, args, opts) => {
          spawned.push({ file, args, opts });
          return { on() {}, unref() {} };
        }
      });
    let o = make();
    // Off by default: nothing starts.
    assert.equal((await o.handle('own-obs-autostart')).started, false);
    assert.equal(spawned.length, 0);
    assert.equal((await o.handle('own-obs-info')).path, exe);
    await assert.rejects(o.handle('own-obs-set', { enabled: 'yes' }), /Invalid/);
    await assert.rejects(o.handle('own-obs-browse'), /Choose OBS itself/, 'a non-OBS program is refused');
    assert.equal((await o.handle('own-obs-set', { enabled: true })).enabled, true);

    // A new app start: OBS starts minimized to the tray, detached so it outlives UniversalCollab; only once.
    o = make();
    let r = await o.handle('own-obs-autostart');
    assert.equal(r.started, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].file, exe);
    assert.deepEqual(spawned[0].args, ['--minimize-to-tray', '--disable-shutdown-check']);
    assert.equal(spawned[0].opts.cwd, path.dirname(exe), 'OBS needs its own folder as working directory');
    assert.equal(spawned[0].opts.detached, true);
    assert.equal((await o.handle('own-obs-autostart')).started, false);
    assert.equal(spawned.length, 1, 'only once per app start');

    // Already running (e.g. opened by hand): not started again.
    tasks = 'obs64.exe                    1234 Console    1    250,000 K';
    o = make();
    r = await o.handle('own-obs-autostart');
    assert.equal(r.alreadyRunning, true);
    assert.equal(spawned.length, 1);
    // Close my OBS when UniversalCollab closes: saved, then OBS is asked to close, and forced only if it stays.
    assert.equal(o.closeOnQuit, false);
    await assert.rejects(o.handle('own-obs-set', { closeOnQuit: 'yes' }), /Invalid/);
    assert.equal((await o.handle('own-obs-set', { closeOnQuit: true })).closeOnQuit, true);
    assert.equal(make().closeOnQuit, true, 'remembered after a restart');
    const asked = [];
    let alive = ['4321'];
    // The saved OBS program, as "Choose OBS program…" stores it.
    fs.writeFileSync(
      path.join(dir, 'own-obs.json'),
      JSON.stringify({ enabled: true, closeOnQuit: true, path: exe })
    );
    const closer2 = own.create({
      app: { getPath: () => dir },
      dialog: {},
      getWindow: () => null,
      platform: 'win32',
      query: async (cmd, args) => {
        asked.push([cmd, args]);
        if (cmd === 'powershell') return alive.join('\r\n');
        if (cmd === 'taskkill' && !args.includes('/F')) setTimeout(() => (alive = []), 30);
        return '';
      }
    });
    asked.length = 0;
    alive = ['4321'];
    let c = await closer2.close({ timeout: 2000, poll: 20 });
    assert.deepEqual(c, { closed: true, forced: false });
    const ps = asked.find(([cmd]) => cmd === 'powershell')[1].at(-1);
    assert(ps.includes(`$_.Path -eq '${exe}'`), 'only OBS running from this exact program is closed');
    assert.deepEqual(
      asked.find(([cmd]) => cmd === 'taskkill')[1],
      ['/PID', '4321', '/T'],
      'asked to close, not forced'
    );
    // An OBS that will not close is forced after the wait.
    const stubborn = own.create({
      app: { getPath: () => dir },
      dialog: {},
      getWindow: () => null,
      platform: 'win32',
      query: async (cmd, args) => {
        asked.push([cmd, args]);
        return cmd === 'powershell' ? '777' : '';
      }
    });
    asked.length = 0;
    c = await stubborn.close({ timeout: 100, poll: 20 });
    assert.deepEqual(c, { closed: true, forced: true });
    assert(asked.some(([cmd, args]) => cmd === 'taskkill' && args.includes('/F')));
    // Not running: nothing to close.
    const idle = own.create({
      app: { getPath: () => dir },
      dialog: {},
      getWindow: () => null,
      platform: 'win32',
      query: async () => ''
    });
    assert.deepEqual(await idle.close({ timeout: 100, poll: 20 }), { closed: false });
    console.log(
      'PASS own OBS: found, starts once in the tray, not when running, OBS only; closes on quit, gently then forced.'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
