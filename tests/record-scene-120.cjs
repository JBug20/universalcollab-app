// Recording scene (1.2.0): with the Source Record plugin, Start Recording records a chosen scene on its own (or as
// well as the normal recording) through one "UniversalCollab recording" filter, switched between record modes
// Always and None. A missing plugin gives a clear message, Stop stops everything, and the recording state and
// readiness include the recording scene.
const assert = require('node:assert/strict'),
  { OBSControls, SCENE_FILTER, recording } = require('../DesktopSource/obs-controls.cjs');

function fakeOBS({ kinds = ['source_record_filter'], kindList = true } = {}) {
  const calls = [];
  const filters = new Map(); // scene -> { filterKind, filterEnabled, filterSettings }
  let recordActive = false;
  const err = (code, msg) => Object.assign(Error(msg), { obsCode: code });
  const link = {
    ready: true,
    request: async (t, d = {}) => {
      calls.push([t, d]);
      switch (t) {
        case 'GetVersion':
          return {
            availableRequests: [
              'GetSceneList',
              'GetRecordStatus',
              'StartRecord',
              'StopRecord',
              'GetRecordDirectory',
              'GetSourceFilter',
              'CreateSourceFilter',
              'SetSourceFilterSettings',
              'SetSourceFilterEnabled',
              ...(kindList ? ['GetSourceFilterKindList'] : [])
            ]
          };
        case 'GetSceneList':
          return {
            scenes: [{ sceneName: 'Stream' }, { sceneName: 'Recording' }],
            currentProgramSceneName: 'Stream'
          };
        case 'GetRecordStatus':
          return { outputActive: recordActive, outputDuration: recordActive ? 5000 : 0, outputPaused: false };
        case 'StartRecord':
          recordActive = true;
          return {};
        case 'StopRecord':
          recordActive = false;
          return {};
        case 'GetRecordDirectory':
          return { recordDirectory: 'D:\\Recordings' };
        case 'GetSourceFilterKindList':
          return { sourceFilterKinds: ['color_filter', ...kinds] };
        case 'GetSourceFilter': {
          const f = d.filterName === SCENE_FILTER && filters.get(d.sourceName);
          if (!f) throw err(600, 'No source filter was found by the name.');
          return { ...f, filterIndex: 0 };
        }
        case 'CreateSourceFilter':
          if (!kinds.includes(d.filterKind))
            throw err(607, 'Your specified filter kind is not supported by OBS.');
          filters.set(d.sourceName, {
            filterKind: d.filterKind,
            filterEnabled: true,
            filterSettings: d.filterSettings
          });
          return {};
        case 'SetSourceFilterSettings': {
          const f = filters.get(d.sourceName);
          f.filterSettings = d.overlay ? { ...f.filterSettings, ...d.filterSettings } : d.filterSettings;
          return {};
        }
        case 'SetSourceFilterEnabled':
          filters.get(d.sourceName).filterEnabled = d.filterEnabled;
          return {};
      }
      throw Error('unexpected ' + t);
    }
  };
  return { link, calls, filters, isRecording: () => recordActive };
}

(async () => {
  // What Record records.
  assert.deepEqual(recording({}), { scene: '', program: true });
  assert.deepEqual(recording({ recordScene: 'Recording', recordWhat: 'scene' }), {
    scene: 'Recording',
    program: false
  });
  assert.deepEqual(recording({ recordScene: 'Recording', recordWhat: 'both' }), {
    scene: 'Recording',
    program: true
  });
  assert.deepEqual(
    recording({ recordScene: '', recordWhat: 'scene' }),
    { scene: '', program: true },
    'no scene'
  );
  assert.deepEqual(recording({ recordScene: 'Recording', recordWhat: 'program' }), {
    scene: '',
    program: true
  });

  // Recording scene only: the filter is made on the scene, records into OBS's recordings folder; OBS's own
  // recording does not start.
  {
    const o = fakeOBS();
    const c = new OBSControls(o.link);
    const i = { recordScene: 'Recording', recordWhat: 'scene' };
    const r = await c.handle('record-start', i);
    const f = o.filters.get('Recording');
    assert.equal(f.filterKind, 'source_record_filter');
    assert.equal(f.filterSettings.record_mode, 1);
    assert.equal(f.filterSettings.path, 'D:\\Recordings');
    assert.equal(f.filterEnabled, true);
    assert.equal(o.isRecording(), false, 'normal recording untouched');
    assert.equal(r.outputActive, true);
    assert.equal(r.programActive, false);
    assert.equal(r.scene.scene, 'Recording');
    assert(Number.isFinite(r.outputDuration));
    // The snapshot shows it as recording (status bar timer, Stream Deck key, Record button).
    const snap = await c.recordState(i);
    assert.equal(snap.outputActive, true);
    // Stop switches the filter back to None.
    const s = await c.handle('record-stop', i);
    assert.equal(f.filterSettings.record_mode, 0);
    assert.equal(s.outputActive, false);
    assert.equal(c.sceneRec, null);
    // Starting again reuses the same filter.
    o.filters.get('Recording').filterEnabled = false;
    await c.handle('record-start', i);
    assert.equal(o.calls.filter(([t]) => t === 'CreateSourceFilter').length, 1);
    assert.equal(f.filterEnabled, true, 'a disabled filter is switched on');
    assert.equal(f.filterSettings.record_mode, 1);
  }

  // Both: two files, one stop ends both.
  {
    const o = fakeOBS();
    const c = new OBSControls(o.link);
    const i = { recordScene: 'Recording', recordWhat: 'both' };
    await c.handle('record-start', i);
    assert.equal(o.isRecording(), true);
    assert.equal(o.filters.get('Recording').filterSettings.record_mode, 1);
    const r = await c.recordState(i);
    assert.equal(r.programActive, true);
    assert.equal(r.outputDuration, 5000, 'timer follows the OBS recording');
    await c.handle('record-stop', i);
    assert.equal(o.isRecording(), false);
    assert.equal(o.filters.get('Recording').filterSettings.record_mode, 0);
  }

  // Normal recording: no filter is touched. A recording scene left running from before is still stopped.
  {
    const o = fakeOBS();
    const c = new OBSControls(o.link);
    await c.handle('record-start', {});
    assert.equal(o.isRecording(), true);
    assert(!o.calls.some(([t]) => t === 'CreateSourceFilter'));
    await c.handle('record-stop', {});
    await c.handle('record-start', { recordScene: 'Recording', recordWhat: 'scene' });
    await c.handle('record-stop', { recordScene: 'Recording', recordWhat: 'program' });
    assert.equal(o.filters.get('Recording').filterSettings.record_mode, 0, 'the old recording scene stopped');
  }

  // Source Record missing: a clear message, nothing recording.
  for (const kindList of [true, false]) {
    const o = fakeOBS({ kinds: [], kindList });
    const c = new OBSControls(o.link);
    await assert.rejects(
      c.handle('record-start', { recordScene: 'Recording', recordWhat: 'both' }),
      /Source Record plugin is not installed/
    );
    assert.equal(o.isRecording(), false);
    const info = await c.handle('scene-record-info', { recordScene: 'Recording' });
    assert.equal(info.installed, kindList ? false : null);
  }

  // A scene that is not in OBS.
  {
    const c = new OBSControls(fakeOBS().link);
    await assert.rejects(
      c.handle('record-start', { recordScene: 'Gone', recordWhat: 'scene' }),
      /no scene called "Gone"/
    );
  }

  // A filter of another kind with the same name is left alone.
  {
    const o = fakeOBS();
    o.filters.set('Recording', { filterKind: 'color_filter', filterEnabled: true, filterSettings: {} });
    const c = new OBSControls(o.link);
    await assert.rejects(
      c.handle('record-start', { recordScene: 'Recording', recordWhat: 'scene' }),
      /not a Source Record filter/
    );
    assert.deepEqual(o.filters.get('Recording').filterSettings, {});
  }

  // Readiness and the settings info.
  {
    const o = fakeOBS();
    const c = new OBSControls(o.link);
    const info = await c.handle('scene-record-info', { recordScene: 'Recording' });
    assert.equal(info.installed, true);
    assert.equal(info.active, false);
    assert.match(info.page, /^https:\/\/obsproject\.com\//);
    o.link.request = (orig => async (t, d) =>
      t === 'GetProfileParameter' ||
      t === 'GetVideoSettings' ||
      t === 'GetStreamStatus' ||
      t === 'GetReplayBufferStatus'
        ? {}
        : orig(t, d))(o.link.request);
    const rd = await c.readiness({ recordScene: 'Recording', recordWhat: 'scene' });
    assert.deepEqual(rd.sceneRecord, { scene: 'Recording', exists: true, installed: true, program: false });
    assert.equal((await c.readiness({})).sceneRecord, null);
  }

  // readiness.js turns that into checks.
  const { evaluate } = require('../DesktopSource/readiness.js');
  const base = { relay: { connected: true }, obs: { connected: true, readiness: { encoder: 'x264' } } };
  const texts = sr =>
    evaluate({ ...base, obs: { connected: true, readiness: { encoder: 'x264', sceneRecord: sr } } });
  assert(
    texts({ scene: 'R', exists: false, installed: true }).some(
      i => i.level === 'warn' && /not in OBS/.test(i.text)
    )
  );
  assert(
    texts({ scene: 'R', exists: true, installed: false }).some(
      i => i.level === 'warn' && /Source Record/.test(i.text)
    )
  );
  assert(
    texts({ scene: 'R', exists: true, installed: true, program: true }).some(
      i => i.level === 'ok' && /"R" and what is on stream/.test(i.text)
    )
  );
  assert(!evaluate(base).some(i => /recording scene/i.test(i.text)));

  console.log('PASS recording scene: Source Record filter start/stop, both, missing plugin, readiness.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
