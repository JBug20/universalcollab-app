// Stream markers and pause / split (1.2.0): marker times and lines; recording chapters in OBS's recording and the
// OBS's recording; pause / resume (paused time not counted); a new file for both; clear
// messages when OBS cannot.
const assert = require('node:assert/strict');
const { clock, recordingSeconds, line } = require('../DesktopSource/markers.js');
const { OBSControls } = require('../DesktopSource/obs-controls.cjs');

(async () => {
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3725.9), '1:02:05');
  assert.equal(clock(-1), '');
  assert.equal(recordingSeconds({ outputActive: true, outputDuration: 10000 }, 1000, 3000), 12);
  assert.equal(
    recordingSeconds({ outputActive: true, outputDuration: 10000, outputPaused: true }, 1000, 3000),
    10
  );
  assert.equal(recordingSeconds({ outputActive: false }, 0), null);
  assert.equal(
    line({ n: 2, label: '', stream: 65, recording: 3725, at: 0, twitch: true, chapter: true }).replace(
      / · [^·]*\(/,
      ' · TIME ('
    ),
    '#2 · Marker · stream 1:05 · recording 1:02:05 · TIME (Twitch marker, recording chapter)'
  );
  assert.match(
    line({ n: 1, label: 'Clutch', stream: null, recording: 5, at: 0 }),
    /^#1 · Clutch · recording 0:05 · /
  );

  function fake({
    available = ['CreateRecordChapter', 'PauseRecord', 'ResumeRecord', 'SplitRecordFile'],
    fail = []
  } = {}) {
    const calls = [];
    const st = { active: true, paused: false };
    const link = {
      ready: true,
      request: async (t, d) => {
        calls.push([t, d]);
        if (fail.includes(t)) throw Object.assign(Error('OBS refused'), { obsCode: 500 });
        if (t === 'GetVersion')
          return { availableRequests: ['GetRecordStatus', 'GetSourceFilter', ...available] };
        if (t === 'GetRecordStatus')
          return { outputActive: st.active, outputPaused: st.paused, outputDuration: 60000 };
        if (t === 'PauseRecord') st.paused = true;
        if (t === 'ResumeRecord') st.paused = false;
        if (t === 'GetSourceFilter')
          return {
            filterKind: 'source_record_filter',
            filterEnabled: true,
            filterSettings: { record_mode: 1 }
          };
        return {};
      }
    };
    return { link, calls, st };
  }
  // Chapters: OBS's recording and the recording scene.
  {
    const o = fake();
    const c = new OBSControls(o.link);
    await c.init();
    assert.deepEqual(await c.handle('record-chapter', { name: 'Marker 1' }), { program: true });
    assert.deepEqual(o.calls.find(x => x[0] === 'CreateRecordChapter')[1], { chapterName: 'Marker 1' });
    // Not Hybrid MP4: OBS refuses, the marker still counts in the list.
    const o2 = fake({ fail: ['CreateRecordChapter'] });
    const c2 = new OBSControls(o2.link);
    assert.deepEqual(await c2.handle('record-chapter', { name: 'x' }), { program: false });
  }
  // Pause / resume both.
  {
    const o = fake();
    const c = new OBSControls(o.link);
    await c.init();
    const r = await c.handle('record-pause', {});
    assert.equal(r.paused, true);
    assert.equal(o.st.paused, true);
    assert.equal((await c.handle('record-pause', {})).paused, false);
    o.st.active = false;
    await assert.rejects(c.handle('record-pause', {}), /Nothing is recording/);
  }
  // Encoder shared with the stream: OBS cannot pause; it says how to fix it.
  {
    const o = fake({ fail: ['PauseRecord'] });
    const c = new OBSControls(o.link);
    await assert.rejects(c.handle('record-pause', {}), /its own encoder/);
  }
  // Split.
  {
    const o = fake();
    const c = new OBSControls(o.link);
    await c.init();
    assert.deepEqual(await c.handle('record-split', {}), { program: true });
    assert(o.calls.some(x => x[0] === 'SplitRecordFile'));
    const o2 = fake({ fail: ['SplitRecordFile'] });
    await assert.rejects(new OBSControls(o2.link).handle('record-split', {}), /Automatic File Splitting/);
    const o3 = fake({ available: [] });
    await assert.rejects(new OBSControls(o3.link).handle('record-split', {}), /OBS 30 or newer/);
  }
  console.log(
    'PASS markers, pause and split: times, chapters, pause both, paused time, split, OBS refusals.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
