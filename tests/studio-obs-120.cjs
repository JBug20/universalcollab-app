// OBS studio mode commands: the state reports it, the preview scene is chosen separately from the program
// scene, Transition triggers OBS's own transition, and screenshots follow the preview scene when asked.
const assert = require('node:assert/strict'),
  { OBSControls } = require('../DesktopSource/obs-controls.cjs');
(async () => {
  const calls = [];
  let studio = true;
  const available = [
    'GetVersion',
    'GetSceneList',
    'GetSceneItemList',
    'GetInputList',
    'GetStreamStatus',
    'GetRecordStatus',
    'GetVirtualCamStatus',
    'GetReplayBufferStatus',
    'GetCurrentProgramScene',
    'GetCurrentPreviewScene',
    'GetStudioModeEnabled',
    'SetStudioModeEnabled',
    'SetCurrentPreviewScene',
    'TriggerStudioModeTransition',
    'GetSourceScreenshot'
  ];
  const link = {
    ready: true,
    subscribe() {},
    request: async (t, d) => {
      calls.push([t, d]);
      if (t === 'GetVersion') return { availableRequests: available };
      if (t.endsWith('Status')) return { outputActive: false };
      if (t === 'GetStudioModeEnabled') return { studioModeEnabled: studio };
      if (t === 'GetSceneList')
        return {
          scenes: [{ sceneName: 'Live' }, { sceneName: 'Next' }],
          currentProgramSceneName: 'Live',
          currentPreviewSceneName: studio ? 'Next' : undefined
        };
      if (t === 'GetCurrentProgramScene') return { currentProgramSceneName: 'Live' };
      if (t === 'GetCurrentPreviewScene') return { currentPreviewSceneName: 'Next' };
      if (t === 'GetInputList') return { inputs: [] };
      if (t === 'GetSceneItemList') return { sceneItems: [] };
      if (t === 'GetSourceScreenshot') return { imageData: 'data:image/jpeg;base64,AAAA' };
      return {};
    }
  };
  const c = new OBSControls(link);
  await c.init();
  let s = await c.handle('snapshot', {});
  assert.equal(s.studioMode, true);
  assert.equal(s.preview, 'Next');
  assert.equal(s.current, 'Live');
  assert.equal(s.sceneName, 'Next', 'the editor follows the preview scene in studio mode');
  assert(
    calls.some(([t, d]) => t === 'GetSceneItemList' && d.sceneName === 'Next'),
    'the preview scene items are listed'
  );
  studio = false;
  s = await c.handle('snapshot', {});
  assert.equal(s.studioMode, false);
  assert.equal(s.preview, null);
  assert.equal(s.sceneName, 'Live');

  calls.length = 0;
  assert.deepEqual(await c.handle('studio-mode', { enabled: true }), { studioMode: true });
  assert.deepEqual(calls.at(-1), ['SetStudioModeEnabled', { studioModeEnabled: true }]);
  await assert.rejects(c.handle('studio-mode', { enabled: 'yes' }), /checkbox/);
  await c.handle('preview-scene', { sceneName: 'Next' });
  assert.deepEqual(calls.at(-1), ['SetCurrentPreviewScene', { sceneName: 'Next' }]);
  await assert.rejects(c.handle('preview-scene', { sceneName: '' }));
  await c.handle('transition', {});
  assert.equal(calls.at(-1)[0], 'TriggerStudioModeTransition');

  await c.handle('preview', { width: 640 });
  assert.equal(calls.find(([t]) => t === 'GetSourceScreenshot')[1].sourceName, 'Live');
  calls.length = 0;
  await c.handle('preview', { width: 640, scene: 'preview' });
  assert.equal(calls.find(([t]) => t === 'GetSourceScreenshot')[1].sourceName, 'Next');

  // An OBS without studio mode requests still works.
  available.splice(available.indexOf('GetStudioModeEnabled'), 1);
  const old = new OBSControls(link);
  await old.init();
  s = await old.handle('snapshot', {});
  assert.equal(s.studioMode, false);
  console.log('PASS OBS studio mode: state, preview scene, transition and preview screenshots.');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
