// OBS open but not connecting (1.2.0): the reason is read from what OBS reports (its log, crash reports, windows,
// the connection error), not guessed; each reason gets its own message and the buttons that help.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  net = require('node:net');
const D = require('../DesktopSource/obs-diagnose.cjs');
const { OBSLink } = require('../DesktopSource/obs-link.cjs');
const WebSocket = require('../DesktopSource/vendor/ws');

const LOG = {
  ok: `10:00:01.000: [obs-websocket] [WebSocketServer::Start] Server started successfully on port 4466. Possible connect address: 192.168.1.2
10:00:02.000: ==== Startup complete ===============================================`,
  safe: `10:00:00.100: Skipping module 'source-record', not on safe list
10:00:00.200: Skipping module 'obs-websocket', not on safe list
10:00:02.000: ==== Startup complete ===============================================`,
  listen: `10:00:00.500: [obs-websocket] [Config::Load] (FirstLoad) Not generating new password since one is already configured.
10:00:01.000: [obs-websocket] [WebSocketServer::Start] Listen failed: Only one usage of each socket address is normally permitted.
10:00:02.000: ==== Startup complete ===============================================`,
  starting: `10:00:00.100: Loading module: source-record.dll
10:00:00.200: Failed to load module file 'C:/OBS/obs-plugins/64bit/source-record.dll': 126`,
  serverOff: `10:00:00.500: [obs-websocket] [Config::Load] (FirstLoad) Not generating new password since one is already configured.
10:00:02.000: ==== Startup complete ===============================================`
};
(async () => {
  assert.deepEqual(D.analyseLog(LOG.ok), {
    safeMode: false,
    wsPort: 4466,
    wsFailed: '',
    wsLoaded: true,
    modulesFailed: [],
    loaded: true,
    shutDown: false
  });
  assert.equal(D.analyseLog(LOG.safe).safeMode, true);
  assert.match(D.analyseLog(LOG.listen).wsFailed, /Only one usage/);
  assert.deepEqual(D.analyseLog(LOG.starting).modulesFailed, ['source-record.dll']);

  const ex = (log, more = {}) =>
    D.explain({
      ...D.analyseLog(log),
      logFile: 'x.txt',
      bundled: true,
      expectedPort: 4466,
      windows: [],
      ...more
    });
  let e = ex(LOG.safe);
  assert.equal(e.reason, 'safe-mode');
  assert.match(e.text, /Safe Mode, which turns its connection to UniversalCollab off\. Restart OBS/);
  assert.deepEqual(e.actions, ['restart']);
  assert.match(ex(LOG.safe, { bundled: false }).text, /choosing Run Normally/);
  assert.deepEqual(ex(LOG.safe, { bundled: false }).actions, []);
  e = ex(LOG.ok, { windows: ['OBS 32.2.2 - Profile: Untitled - Scenes: Untitled', 'Safe Mode?'] });
  assert.equal(e.reason, 'dialog');
  assert.match(e.text, /waiting for an answer: "Safe Mode\?"\. Show OBS to answer it/);
  assert.deepEqual(e.actions, ['show', 'restart']);
  e = ex(LOG.listen);
  assert.equal(e.reason, 'listen-failed');
  assert.match(e.text, /could not open its connection: Only one usage.*port 4466/);
  assert.equal(ex(LOG.ok, { failure: 'auth' }).reason, 'password');
  assert.match(
    ex(LOG.ok, { failure: 'auth', bundled: false }).text,
    /Show Connect Info, and copy the password/
  );
  e = ex(LOG.ok, { bundled: false, expectedPort: 4455 });
  assert.equal(e.reason, 'port');
  assert.match(e.text, /on port 4466, but UniversalCollab is set to 4455/);
  assert.equal(ex(LOG.serverOff, { bundled: false, expectedPort: 4455 }).reason, 'server-off');
  e = ex(LOG.starting, { crashedRecently: true });
  assert.equal(e.reason, 'crashed');
  assert.match(e.text, /crashed while starting \(it could not load source-record\.dll\)/);
  e = ex(LOG.starting);
  assert.equal(e.reason, 'starting');
  assert.deepEqual(e.actions, ['show', 'restart']);
  assert.equal(ex(LOG.ok, { failure: 'timeout' }).reason, 'busy');
  e = D.explain({ ...D.analyseLog(''), bundled: false, windows: [] });
  assert.equal(e.reason, 'unknown');
  assert.match(e.text, /choose Run Normally/);

  // Reading the newest log and a recent crash report from OBS's folder.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-obsdiag-'));
  try {
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.mkdirSync(path.join(dir, 'crashes'));
    fs.writeFileSync(path.join(dir, 'logs', '2026-10-31 20-00-00.txt'), LOG.ok);
    fs.utimesSync(
      path.join(dir, 'logs', '2026-10-31 20-00-00.txt'),
      new Date(Date.now() - 86400000),
      new Date(Date.now() - 86400000)
    );
    fs.writeFileSync(path.join(dir, 'logs', '2026-11-01 10-00-00.txt'), LOG.starting);
    fs.writeFileSync(path.join(dir, 'crashes', 'Crash 2026-11-01 10-00-05.txt'), 'crash');
    const f = D.readFacts(dir);
    assert.equal(path.basename(f.logFile), '2026-11-01 10-00-00.txt', 'the newest run');
    assert.equal(f.crashedRecently, true);
    assert.deepEqual(f.modulesFailed, ['source-record.dll']);
    assert.equal(
      D.configDir({ bundledRoot: 'C:\\UC\\obs-studio', platform: 'win32' }),
      path.join('C:\\UC\\obs-studio', 'config', 'obs-studio')
    );
    assert.equal(
      D.configDir({ env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32' }),
      path.join('C:\\Users\\a\\AppData\\Roaming', 'obs-studio')
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The connection error is kept: nothing listening, then a wrong password.
  const free = await new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  const link = new OBSLink(() => {});
  await assert.rejects(link.connect({ port: free, password: 'x' }));
  assert.equal(link.lastFailure, 'refused');
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.on('listening', r));
  server.on('connection', ws => {
    ws.send(
      JSON.stringify({
        op: 0,
        d: { obsWebSocketVersion: '5.6.0', rpcVersion: 1, authentication: { challenge: 'c', salt: 's' } }
      })
    );
    ws.on('message', () => ws.close(4009, 'Authentication failed.'));
  });
  await assert.rejects(link.connect({ port: server.address().port, password: 'wrong' }));
  assert.equal(link.lastFailure, 'auth');
  link.close();
  server.close();
  console.log(
    'PASS OBS not connecting, explained: log, Safe Mode, dialog, port, password, crash, starting, errors.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
