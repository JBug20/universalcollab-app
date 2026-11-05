// OBS scene editor (1.2.0): the boxes follow OBS's own geometry (alignment, scale, crop, bounding box, rotation and
// flip), resize/crop/snap/menu actions give the transform OBS needs, and only checked transform fields go to OBS.
const assert = require('node:assert/strict');
const g = require('../DesktopSource/obs-editor.js');
const { itemTransform, OBSControls } = require('../DesktopSource/obs-controls.cjs');
const near = (a, b, d = 0.01) => assert(Math.abs(a - b) <= d, `${a} is not about ${b}`);
const nearRect = (r, l, t, rt, b) =>
  [r.left, r.top, r.right, r.bottom].forEach((v, i) => near(v, [l, t, rt, b][i]));
const T = x => ({
  positionX: 100,
  positionY: 50,
  rotation: 0,
  scaleX: 0.5,
  scaleY: 0.5,
  alignment: 5,
  boundsType: 'OBS_BOUNDS_NONE',
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  sourceWidth: 1920,
  sourceHeight: 1080,
  ...x
});
const base = { width: 1920, height: 1080 };
(async () => {
  // Where OBS draws it.
  nearRect(g.rect(T()), 100, 50, 1060, 590);
  nearRect(g.rect(T({ alignment: 0 })), -380, -220, 580, 320); // centre
  nearRect(g.rect(T({ alignment: 10 })), -860, -490, 100, 50); // bottom-right
  nearRect(g.rect(T({ cropLeft: 200, cropTop: 80 })), 100, 50, 960, 550);
  nearRect(g.rect(T({ scaleX: -0.5 })), -860, 50, 100, 590); // flipped grows left of its anchor
  nearRect(
    g.rect(T({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 800, boundsHeight: 600 })),
    100,
    50,
    900,
    650
  );
  nearRect(g.rect(T({ rotation: 90 })), -440, 50, 100, 1010); // rotated about its top-left anchor
  assert.equal(g.straight(T({ rotation: 360 })), true);
  assert.equal(g.straight(T({ rotation: 90 })), false);

  // Resize: corners keep the shape, Shift (free) does not, edges stretch one side.
  const t = T();
  nearRect(g.rect({ ...t, ...g.resize(t, 'se', 96, 0) }), 100, 50, 1156, 644);
  nearRect(g.rect({ ...t, ...g.resize(t, 'se', 96, 0, true) }), 100, 50, 1156, 590);
  nearRect(g.rect({ ...t, ...g.resize(t, 'nw', -96, 0) }), 4, -4, 1060, 590);
  nearRect(g.rect({ ...t, ...g.resize(t, 'e', 40, 999) }), 100, 50, 1100, 590);
  nearRect(g.rect({ ...t, ...g.resize(t, 'w', 5000, 0, true) }), 1058, 50, 1060, 590); // never inside out
  // Centre-aligned and flipped sources resize around the same box.
  const c = T({ alignment: 0, positionX: 960, positionY: 540 });
  nearRect(g.rect({ ...c, ...g.resize(c, 'e', 100, 0, true) }), 480, 270, 1540, 810);
  const f = T({ scaleX: -0.5, positionX: 1060 });
  nearRect(g.rect(f), 100, 50, 1060, 590);
  const fr = g.resize(f, 'e', 100, 0, true);
  assert(fr.scaleX < 0, 'stays flipped');
  nearRect(g.rect({ ...f, ...fr }), 100, 50, 1160, 590);
  // A bounding box is resized, not the scale.
  const b = T({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 800, boundsHeight: 600 });
  assert.deepEqual(Object.keys(g.resize(b, 'e', 100, 0, true)).sort(), [
    'boundsHeight',
    'boundsWidth',
    'positionX',
    'positionY'
  ]);

  // Crop: the dragged side moves, the rest of the picture stays; flipped sources crop the side you see.
  const cr = g.crop(t, 'w', 100, 0);
  assert.equal(cr.cropLeft, 200);
  nearRect(g.rect({ ...t, ...cr }), 200, 50, 1060, 590);
  const cs = g.crop(t, 'se', -50, -25);
  assert.deepEqual([cs.cropRight, cs.cropBottom], [100, 50]);
  nearRect(g.rect({ ...t, ...cs }), 100, 50, 1010, 565);
  const cf = g.crop(f, 'w', 100, 0);
  assert.equal(cf.cropRight, 200);
  nearRect(g.rect({ ...f, ...cf }), 200, 50, 1060, 590);
  assert.equal(g.crop(t, 'w', 99999, 0).cropLeft, 1918, 'never crops it all away');
  assert.equal(g.crop(t, 'w', -500, 0).cropLeft, 0, 'no negative crop');

  // Snapping to the screen and other sources.
  const items = [
    { sceneItemId: 1, sceneItemEnabled: true, sceneItemTransform: T() },
    {
      sceneItemId: 2,
      sceneItemEnabled: true,
      sceneItemTransform: T({ positionX: 1500, positionY: 700, scaleX: 0.1, scaleY: 0.1 })
    },
    { sceneItemId: 3, sceneItemEnabled: false, sceneItemTransform: T({ positionX: 7, positionY: 7 }) }
  ];
  const l = g.lines(items, base, 1);
  assert(l.xs.includes(1500) && !l.xs.includes(7), 'other visible sources, not hidden ones');
  const s = g.snapMove({ left: 5, top: 300, right: 965, bottom: 840 }, l, 8);
  assert.deepEqual([s.dx, s.guides.x], [-5, [0]]);
  assert.equal(g.snapMove({ left: 50, top: 300, right: 60, bottom: 310 }, l, 8).dx, 0, 'too far: no snap');

  // Menu actions.
  // Fit keeps the shape: a 480 × 540 box fills the height, centred.
  const narrow = T({ scaleX: 0.25, scaleY: 0.5 });
  nearRect(g.rect({ ...narrow, ...g.ACTIONS.fit(narrow, base) }), 480, 0, 1440, 1080);
  nearRect(g.rect({ ...t, ...g.ACTIONS.fit(t, base) }), 0, 0, 1920, 1080);
  const portrait = T({ sourceWidth: 1080, sourceHeight: 1920 });
  nearRect(g.rect({ ...portrait, ...g.ACTIONS.fit(portrait, base) }), 656.25, 0, 1263.75, 1080);
  nearRect(g.rect({ ...t, ...g.ACTIONS.stretch(t, base) }), 0, 0, 1920, 1080);
  nearRect(g.rect({ ...t, ...g.ACTIONS.centre(t, base) }), 480, 270, 1440, 810);
  nearRect(g.rect({ ...t, ...g.ACTIONS.centreH(t, base) }), 480, 50, 1440, 590);
  const r90 = { ...t, ...g.ACTIONS.rotate(t, base, 90) };
  assert.equal(r90.rotation, 90);
  nearRect(g.rect(r90), 310, -160, 850, 800); // same centre
  assert.equal(g.ACTIONS.rotate(r90, base, -90).rotation, 0);
  assert.equal(g.ACTIONS.rotate(r90, base, 270).rotation, 0);
  const fh = { ...t, ...g.ACTIONS.flipH(t) };
  assert.equal(fh.scaleX, -0.5);
  nearRect(g.rect(fh), 100, 50, 1060, 590);
  assert.deepEqual(g.ACTIONS.reset(), {
    positionX: 0,
    positionY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    cropLeft: 0,
    cropRight: 0,
    cropTop: 0,
    cropBottom: 0,
    alignment: 5,
    boundsType: 'OBS_BOUNDS_NONE'
  });
  // Undo sends back only what OBS accepts.
  const e = g.editable({ ...t, width: 960, height: 540, boundsWidth: 0, boundsHeight: 0 });
  assert(!('sourceWidth' in e) && !('width' in e) && !('boundsWidth' in e));
  assert.equal(e.positionX, 100);

  // OBS side: checked fields only.
  assert.deepEqual(
    itemTransform({
      positionX: 1.5,
      scaleX: -0.5,
      cropLeft: 10.4,
      alignment: 0,
      boundsType: 'OBS_BOUNDS_NONE'
    }),
    {
      positionX: 1.5,
      scaleX: -0.5,
      cropLeft: 10,
      alignment: 0,
      boundsType: 'OBS_BOUNDS_NONE'
    }
  );
  for (const bad of [
    null,
    {},
    { positionX: 'x' },
    { positionX: Infinity },
    { scaleX: 0 },
    { scaleX: 5000 },
    { cropLeft: -1 },
    { alignment: 3 },
    { boundsType: 'x' },
    { boundsWidth: 0 },
    { rotation: 720 }
  ])
    assert.throws(() => itemTransform(bad), Error, JSON.stringify(bad));
  assert.deepEqual(
    itemTransform({ sourceWidth: 5, positionY: 2 }),
    { positionY: 2 },
    'unknown fields are dropped'
  );

  // The editor's OBS requests.
  const calls = [];
  let locked = false;
  const link = {
    ready: true,
    request: async (type, data) => {
      calls.push([type, data]);
      if (type === 'GetVersion')
        return {
          availableRequests: [
            'GetSceneItemList',
            'GetVideoSettings',
            'GetSourceScreenshot',
            'GetSceneItemLocked',
            'SetSceneItemTransform'
          ]
        };
      if (type === 'GetSceneItemList') return { sceneItems: [{ sceneItemId: 7, sourceName: 'Cam' }] };
      if (type === 'GetVideoSettings') return { baseWidth: 2560, baseHeight: 1440 };
      if (type === 'GetSourceScreenshot') return { imageData: 'data:image/jpeg;base64,AA' };
      if (type === 'GetSceneItemLocked') return { sceneItemLocked: locked };
      return {};
    }
  };
  const o = new OBSControls(link);
  assert.deepEqual(await o.handle('editor-state', { sceneName: 'Main' }), {
    sceneName: 'Main',
    items: [{ sceneItemId: 7, sourceName: 'Cam' }],
    base: { width: 2560, height: 1440 }
  });
  assert.deepEqual(await o.handle('scene-image', { sceneName: 'BRB', width: 1280 }), {
    image: 'data:image/jpeg;base64,AA'
  });
  assert.equal(
    calls.find(c => c[0] === 'GetSourceScreenshot')[1].sourceName,
    'BRB',
    'the scene being edited, not the program'
  );
  await o.handle('item-transform', {
    sceneName: 'Main',
    id: 7,
    transform: { positionX: 10, sourceWidth: 1 }
  });
  assert.deepEqual(calls.at(-1), [
    'SetSceneItemTransform',
    { sceneName: 'Main', sceneItemId: 7, sceneItemTransform: { positionX: 10 } }
  ]);
  locked = true;
  await assert.rejects(
    o.handle('item-transform', { sceneName: 'Main', id: 7, transform: { positionX: 10 } }),
    /locked/
  );
  await assert.rejects(
    o.handle('item-transform', { sceneName: 'Main', id: 1.5, transform: { positionX: 10 } }),
    /Invalid source/
  );
  console.log(
    'PASS OBS scene editor geometry: OBS boxes, resize, crop, snap, menu actions, checked transforms.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
