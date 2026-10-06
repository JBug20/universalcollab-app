// Clip button (1.2.0): OBS replay buffer start/save, the saved path, and the bundled OBS default.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { OBSControls } = require('../DesktopSource/obs-controls.cjs'),
  { prepare } = require('../DesktopSource/bundled-obs.cjs');
(async () => {
  const fake = ({ enabled = true, available } = {}) => {
    let active = false,
      last = '',
      saves = 0;
    const calls = [];
    const link = {
      ready: true,
      request: async (t, d) => {
        calls.push(t);
        if (t === 'GetVersion')
          return {
            obsVersion: '32.0.0',
            availableRequests: available || [
              'GetReplayBufferStatus',
              'StartReplayBuffer',
              'SaveReplayBuffer',
              'GetLastReplayBufferReplay',
              'GetProfileParameter'
            ]
          };
        if (t === 'GetReplayBufferStatus') return { outputActive: active };
        if (t === 'StartReplayBuffer') {
          if (!enabled) throw Error('OutputDisabled');
          active = true;
          return {};
        }
        if (t === 'SaveReplayBuffer') {
          saves++;
          // OBS reports the new file a moment later.
          setTimeout(() => (last = 'C:\\Videos\\Replay ' + saves + '.mkv'), 300);
          return {};
        }
        if (t === 'GetLastReplayBufferReplay') {
          if (!last) throw Error('No replay saved yet');
          return { savedReplayPath: last };
        }
        if (t === 'GetProfileParameter')
          return d.parameterName === 'Mode' ? { parameterValue: 'Simple' } : { parameterValue: '45' };
        throw Error('unexpected ' + t);
      }
    };
    return { obs: new OBSControls(link), calls };
  };

  // First press starts the buffer; later presses save clips and report each file.
  let { obs, calls } = fake();
  let r = await obs.handle('clip');
  assert.equal(r.started, true);
  assert.equal(r.seconds, 45);
  assert(!calls.includes('SaveReplayBuffer'), 'a just-started buffer is not saved');
  r = await obs.handle('clip');
  assert.equal(r.path, 'C:\\Videos\\Replay 1.mkv');
  r = await obs.handle('clip');
  assert.equal(r.path, 'C:\\Videos\\Replay 2.mkv');
  assert.deepEqual(
    obs.clips,
    ['C:\\Videos\\Replay 2.mkv', 'C:\\Videos\\Replay 1.mkv'],
    'only saved clips can be shown'
  );

  // Replay buffer turned off in OBS: a clear message on how to turn it on.
  ({ obs } = fake({ enabled: false }));
  await assert.rejects(obs.handle('clip'), /Settings → Output → Replay Buffer/);

  // OBS without a replay buffer.
  ({ obs } = fake({ available: ['GetReplayBufferStatus'] }));
  assert.deepEqual(await obs.handle('replay-status'), { supported: false });
  await assert.rejects(obs.handle('clip'), /no replay buffer/);

  // Bundled OBS: replay buffer on by default; a profile where it was turned off stays off.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-clip-'));
  try {
    prepare({ root });
    const first = fs.readFileSync(
      path.join(root, 'config/obs-studio/basic/profiles/Untitled/basic.ini'),
      'utf8'
    );
    assert.match(first, /\[SimpleOutput\][^[]*RecRB=true/);
    assert.match(first, /\[AdvOut\][^[]*RecRBTime=60/);
    const mine = path.join(root, 'config/obs-studio/basic/profiles/Mine/basic.ini');
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, '[SimpleOutput]\r\nRecRB=false\r\n');
    prepare({ root });
    assert.match(fs.readFileSync(mine, 'utf8'), /RecRB=false/);
    assert.doesNotMatch(fs.readFileSync(mine, 'utf8'), /RecRB=true/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(
    'PASS clip: replay buffer starts then saves, paths tracked, clear errors, bundled OBS default.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
