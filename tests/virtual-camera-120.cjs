// OBS Virtual Camera control for the live preview: the app only stops a camera it started itself, steps
// aside while OBS video settings change, and says so when OBS is too old to have a virtual camera.
const assert = require('node:assert/strict'),
  { OBSControls } = require('../DesktopSource/obs-controls.cjs');

function setup({ withCamera = true, camera = false, streaming = false, startFails = false } = {}) {
  const calls = [];
  const state = { camera, streaming };
  const available = [
    'GetVersion',
    'GetSceneList',
    'GetSceneItemList',
    'GetInputList',
    'GetInputVolume',
    'GetInputMute',
    'GetStreamStatus',
    'GetRecordStatus',
    'GetVideoSettings',
    'SetVideoSettings',
    'GetCurrentProgramScene',
    'GetSourceScreenshot',
    ...(withCamera ? ['GetVirtualCamStatus', 'StartVirtualCam', 'StopVirtualCam'] : [])
  ];
  const link = {
    ready: true,
    subscribe() {},
    request: async (type, data) => {
      calls.push(type);
      if (type === 'GetVersion') return { availableRequests: available };
      if (type === 'GetVirtualCamStatus') return { outputActive: state.camera };
      if (type === 'StartVirtualCam') {
        if (startFails) throw Error('refused');
        state.camera = true;
        return {};
      }
      if (type === 'StopVirtualCam') {
        state.camera = false;
        return {};
      }
      if (type === 'GetStreamStatus') return { outputActive: state.streaming };
      if (type === 'GetRecordStatus') return { outputActive: false };
      if (type === 'GetSceneList') return { scenes: [{ sceneName: 'One' }], currentProgramSceneName: 'One' };
      if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: 'One' };
      if (type === 'GetSourceScreenshot') return { imageData: 'data:image/jpeg;base64,AAAA' };
      if (type === 'GetInputList') return { inputs: [] };
      if (type === 'GetSceneItemList') return { sceneItems: [] };
      return {};
    }
  };
  return { controls: new OBSControls(link), calls, state };
}
const video = {
  baseWidth: 1920,
  baseHeight: 1080,
  outputWidth: 1920,
  outputHeight: 1080,
  fpsNumerator: 60,
  fpsDenominator: 1
};

(async () => {
  // The app starts the camera, and a second request does not restart it.
  {
    const { controls, calls, state } = setup();
    await controls.init();
    assert.deepEqual(await controls.handle('virtualcam', { enabled: true }), {
      active: true,
      startedByApp: true
    });
    assert.equal(state.camera, true);
    await controls.handle('virtualcam', { enabled: true });
    assert.equal(calls.filter(c => c === 'StartVirtualCam').length, 1);
    // Turning it off stops what the app started.
    assert.deepEqual(await controls.handle('virtualcam', { enabled: false }), { active: false });
    assert.equal(state.camera, false);
    assert.equal(controls.ownVirtualCam, false);
  }

  // A camera that was already running in OBS belongs to the user: never stopped by the app.
  {
    const { controls, calls, state } = setup({ camera: true });
    await controls.init();
    assert.deepEqual(await controls.handle('virtualcam', { enabled: true }), {
      active: true,
      startedByApp: false
    });
    await controls.handle('virtualcam', { enabled: false });
    assert.equal(state.camera, true);
    assert(!calls.includes('StopVirtualCam'));
  }

  // OBS without a virtual camera, and OBS refusing to start it, give clear messages.
  {
    const { controls } = setup({ withCamera: false });
    await controls.init();
    await assert.rejects(controls.handle('virtualcam', { enabled: true }), /OBS 28 or newer/);
    const failing = setup({ startFails: true });
    await failing.controls.init();
    await assert.rejects(
      failing.controls.handle('virtualcam', { enabled: true }),
      /could not start its virtual camera/
    );
    assert.equal(failing.controls.ownVirtualCam, false);
  }

  // Changing video settings steps the app's camera aside and brings it back, in that order.
  {
    const { controls, calls, state } = setup();
    await controls.init();
    await controls.handle('virtualcam', { enabled: true });
    calls.length = 0;
    await controls.handle('video', video);
    const order = calls.filter(c => ['StopVirtualCam', 'SetVideoSettings', 'StartVirtualCam'].includes(c));
    assert.deepEqual(order, ['StopVirtualCam', 'SetVideoSettings', 'StartVirtualCam']);
    assert.equal(state.camera, true, 'the camera is running again afterwards');
    assert.equal(controls.ownVirtualCam, true, 'and still belongs to the app');
  }

  // A stream that is running still blocks the change, and the camera comes back.
  {
    const { controls, calls, state } = setup({ streaming: true });
    await controls.init();
    await controls.handle('virtualcam', { enabled: true });
    await assert.rejects(controls.handle('video', video), /Stop streaming/);
    assert(!calls.includes('SetVideoSettings'));
    assert.equal(state.camera, true);
  }

  // Bad numbers are rejected before the camera is touched.
  {
    const { controls, calls } = setup();
    await controls.init();
    await controls.handle('virtualcam', { enabled: true });
    calls.length = 0;
    await assert.rejects(controls.handle('video', { ...video, outputWidth: 1920.5 }), /whole numbers/);
    assert(!calls.includes('StopVirtualCam') && !calls.includes('SetVideoSettings'));
  }

  // A user camera that is running blocks the change (the app does not own it).
  {
    const { controls, calls } = setup({ camera: true });
    await controls.init();
    await assert.rejects(controls.handle('video', video), /Stop streaming, recording/);
    assert(!calls.includes('StopVirtualCam'));
  }

  // The snapshot reports the camera, or null when OBS has none.
  {
    const on = setup({ camera: true });
    await on.controls.init();
    assert.equal((await on.controls.handle('snapshot')).virtualCam, true);
    const off = setup();
    await off.controls.init();
    assert.equal((await off.controls.handle('snapshot')).virtualCam, false);
    const none = setup({ withCamera: false });
    await none.controls.init();
    assert.equal((await none.controls.handle('snapshot')).virtualCam, null);
  }

  // Preview images can be requested up to 2560 pixels wide, no wider.
  {
    const { controls, calls } = setup();
    await controls.init();
    assert((await controls.handle('preview', { width: 2560 })).image.startsWith('data:image/jpeg'));
    await assert.rejects(controls.handle('preview', { width: 2561 }), /range/);
    await assert.rejects(controls.handle('virtualcam', { enabled: 'yes' }), /checkbox/);
  }
  console.log(
    'PASS virtual camera: started and stopped only by the app that started it, stepped aside for video settings, old OBS and refusals explained.'
  );
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
