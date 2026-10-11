// New OBS sources (1.2.0): the right OBS kind per platform, settings per type, files checked, a clear message for a
// name already in use, and the device list (cameras, screens, windows, microphones) from OBS with only device
// settings changeable.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { OBSControls } = require('../DesktopSource/obs-controls.cjs'),
  sources = require('../DesktopSource/obs-sources.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-src-'));
  try {
    const img = path.join(dir, 'logo.png');
    fs.writeFileSync(img, 'x');
    const windowsKinds = [
      'dshow_input',
      'monitor_capture',
      'window_capture',
      'game_capture',
      'wasapi_input_capture',
      'wasapi_output_capture',
      'image_source',
      'ffmpeg_source',
      'text_gdiplus_v3',
      'browser_source'
    ];
    assert.equal(sources.available(windowsKinds).length, 10);
    assert.equal(
      sources
        .available(['v4l2_input', 'pulse_input_capture'])
        .map(a => a.kind)
        .join(),
      'v4l2_input,pulse_input_capture',
      'Linux kinds'
    );

    const calls = [];
    const existing = new Set(['Mic/Aux']);
    const link = {
      ready: true,
      request: async (t, d) => {
        calls.push([t, d]);
        if (t === 'GetVersion')
          return {
            availableRequests: [
              'GetInputKindList',
              'CreateInput',
              'GetInputPropertiesListPropertyItems',
              'GetInputSettings',
              'SetInputSettings'
            ]
          };
        if (t === 'GetInputKindList') return { inputKinds: windowsKinds };
        if (t === 'CreateInput') {
          if (existing.has(d.inputName))
            throw Object.assign(Error('OBS rejected CreateInput.'), { obsCode: 601 });
          existing.add(d.inputName);
          return { inputUuid: 'u', sceneItemId: 7 };
        }
        if (t === 'GetInputPropertiesListPropertyItems') {
          if (d.propertyName === 'video_device_id')
            return {
              propertyItems: [
                { itemName: 'Logitech C920', itemValue: 'cam1', itemEnabled: true },
                { itemName: 'OBS Virtual Camera', itemValue: 'vcam', itemEnabled: true }
              ]
            };
          throw Error('no such property');
        }
        if (t === 'GetInputSettings') return { inputSettings: { video_device_id: 'cam1' } };
        if (t === 'SetInputSettings') return {};
        throw Error('unexpected ' + t);
      }
    };
    const obs = new OBSControls(link);
    const types = await obs.handle('source-types');
    assert.equal(types[0].type, 'webcam');
    assert.ok(types.some(t => t.type === 'browser'));
    // Webcam: created in the scene, then the camera list from OBS.
    let r = await obs.handle('source-create', { sceneName: 'Main', type: 'webcam', name: 'Facecam' });
    const create = calls.find(([t]) => t === 'CreateInput')[1];
    assert.deepEqual(create, {
      sceneName: 'Main',
      inputName: 'Facecam',
      inputKind: 'dshow_input',
      inputSettings: {},
      sceneItemEnabled: true
    });
    assert.equal(r.property, 'video_device_id');
    assert.deepEqual(
      r.items.map(i => i.name),
      ['Logitech C920', 'OBS Virtual Camera']
    );
    assert.equal(r.current, 'cam1');
    await obs.handle('source-choose', { inputName: 'Facecam', property: 'video_device_id', value: 'vcam' });
    assert.deepEqual(calls.at(-1), [
      'SetInputSettings',
      { inputName: 'Facecam', inputSettings: { video_device_id: 'vcam' } }
    ]);
    // Only device choices can be changed this way.
    await assert.rejects(
      obs.handle('source-choose', { inputName: 'Facecam', property: 'url', value: 'x' }),
      /cannot be changed here/
    );
    // Browser source: the address is checked; size kept in range.
    await assert.rejects(
      obs.handle('source-create', {
        sceneName: 'Main',
        type: 'browser',
        name: 'Page',
        url: 'javascript:alert(1)'
      }),
      /http or https/
    );
    await obs.handle('source-create', {
      sceneName: 'Main',
      type: 'browser',
      name: 'Credits',
      url: 'http://127.0.0.1:18752/o/t/credits',
      width: 1920,
      height: 99999
    });
    assert.deepEqual(calls.findLast(([t]) => t === 'CreateInput')[1].inputSettings, {
      url: 'http://127.0.0.1:18752/o/t/credits',
      width: 1920,
      height: 1080
    });
    // Game capture: any full-screen game.
    await obs.handle('source-create', { sceneName: 'Main', type: 'game', name: 'Game' });
    assert.deepEqual(calls.findLast(([t]) => t === 'CreateInput')[1].inputSettings, {
      capture_mode: 'any_fullscreen'
    });
    // Image: the file must exist and be a picture.
    await assert.rejects(
      obs.handle('source-create', {
        sceneName: 'Main',
        type: 'image',
        name: 'Logo',
        file: path.join(dir, 'missing.png')
      }),
      /Choose the file/
    );
    await assert.rejects(
      obs.handle('source-create', {
        sceneName: 'Main',
        type: 'image',
        name: 'Logo',
        file: path.join(dir, '..')
      }),
      /Choose the file/
    );
    await obs.handle('source-create', { sceneName: 'Main', type: 'image', name: 'Logo', file: img });
    assert.deepEqual(calls.findLast(([t]) => t === 'CreateInput')[1].inputSettings, { file: img });
    // A name OBS already has.
    await assert.rejects(
      obs.handle('source-create', { sceneName: 'Main', type: 'mic', name: 'Mic/Aux' }),
      /already has a source called "Mic\/Aux"/
    );
    await assert.rejects(
      obs.handle('source-create', { sceneName: 'Main', type: 'nope', name: 'x' }),
      /what kind of source/
    );
    console.log(
      'PASS new OBS sources: kinds per platform, settings, files checked, duplicate names, device list.'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
