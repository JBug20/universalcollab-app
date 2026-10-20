// Clip (1.2.0): the saved clip's path comes from OBS's ReplayBufferSaved event (or GetLastReplayBufferReplay), and a
// slow save (several seconds) is still picked up, so the vertical copy always knows which file to use.
const assert = require('node:assert/strict');
const { OBSControls } = require('../DesktopSource/obs-controls.cjs');

function fake({ eventAfter = null, pollAfter = null, last = 'C:\\Rec\\old.mp4' } = {}) {
  const link = { ready: true, lastReplaySaved: null };
  let saved = 0;
  link.request = async t => {
    if (t === 'GetVersion')
      return {
        availableRequests: [
          'GetReplayBufferStatus',
          'SaveReplayBuffer',
          'GetLastReplayBufferReplay',
          'GetProfileParameter'
        ]
      };
    if (t === 'GetReplayBufferStatus') return { outputActive: true };
    if (t === 'GetProfileParameter') return { parameterValue: '30' };
    if (t === 'SaveReplayBuffer') {
      saved = Date.now();
      if (eventAfter !== null)
        setTimeout(
          () => (link.lastReplaySaved = { path: 'C:\\Rec\\Replay new.mp4', at: Date.now() }),
          eventAfter
        );
      return {};
    }
    if (t === 'GetLastReplayBufferReplay')
      return {
        savedReplayPath:
          pollAfter !== null && saved && Date.now() - saved >= pollAfter ? 'C:\\Rec\\Replay polled.mp4' : last
      };
    return {};
  };
  return link;
}
(async () => {
  // The event: quick.
  let c = new OBSControls(fake({ eventAfter: 300 }));
  let r = await c.handle('clip');
  assert.equal(r.path, 'C:\\Rec\\Replay new.mp4');
  assert.deepEqual(c.clips, ['C:\\Rec\\Replay new.mp4']);
  // An event from an earlier clip does not count.
  const link = fake({ pollAfter: 600 });
  link.lastReplaySaved = { path: 'C:\\Rec\\earlier.mp4', at: Date.now() - 60000 };
  c = new OBSControls(link);
  r = await c.handle('clip');
  assert.equal(r.path, 'C:\\Rec\\Replay polled.mp4');
  // Slow save (12 s, longer than the old 10 s wait): still found.
  c = new OBSControls(fake({ eventAfter: 12000 }));
  const t0 = Date.now();
  r = await c.handle('clip');
  assert.equal(r.path, 'C:\\Rec\\Replay new.mp4');
  assert(Date.now() - t0 >= 11900);
  console.log('PASS clip path: from the saved event or the last replay, slow saves still found.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
