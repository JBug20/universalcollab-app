// Clip button (1.2.0): OBS replay buffer start/save, the saved path and clear errors.
const assert = require('node:assert/strict'),
  { OBSControls } = require('../DesktopSource/obs-controls.cjs');
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
  console.log('PASS clip: replay buffer starts then saves, paths tracked, clear errors.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
