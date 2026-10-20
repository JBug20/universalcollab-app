// Vertical clips (1.2.0): the 9:16 layouts, finding the facecam in the OBS scene, and the main side: only clips
// OBS saved, MP4 only, byte ranges for playback, the result saved next to the clip, failures passed on.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { plan } = require('../DesktopSource/vertical/layout.js');
const { facecam } = require('../DesktopSource/vertical-clip-ui.js');
const { rect } = require('../DesktopSource/obs-editor.js');
const V = require('../DesktopSource/vertical-clips.cjs');
const near = (a, b, d = 0.5) => assert(Math.abs(a - b) <= d, `${a} is not about ${b}`);

(async () => {
  // Centre crop: the middle 607.5 × 1080 of a 1920 × 1080 clip, full frame.
  const c = plan('crop', 1920, 1080);
  assert.deepEqual([c.width, c.height], [1080, 1920]);
  near(c.draws[0].sx, 656.25);
  near(c.draws[0].sw, 607.5);
  // Blurred background + the whole picture across the middle.
  const b = plan('blur', 1920, 1080);
  assert.equal(b.draws[0].blur, true);
  assert.deepEqual([b.draws[1].sw, b.draws[1].dw], [1920, 1080]);
  near(b.draws[1].dy, 656.25);
  near(b.draws[1].dh, 607.5);
  // Facecam on top (35 %), gameplay below; the facecam area keeps the top's shape and stays in the picture.
  const s = plan('stack', 1920, 1080, { facecam: { x: 0.72, y: 0.65, w: 0.25, h: 0.3 } });
  const [top, game] = s.draws;
  assert.deepEqual([top.dy, top.dh, game.dy, game.dh], [0, 672, 672, 1248]);
  near(top.sw / top.sh, 1080 / 672, 0.01);
  near(top.sx + top.sw / 2, 0.845 * 1920, 1);
  assert(top.sx + top.sw <= 1920 && top.sy + top.sh <= 1080 && top.sx >= 0 && top.sy >= 0);
  near(game.sw / game.sh, 1080 / 1248, 0.01);
  // A facecam at the very edge is moved inside.
  const edge = plan('stack', 1920, 1080, { facecam: { x: 0.95, y: 0.9, w: 0.05, h: 0.1 } }).draws[0];
  assert(edge.sx + edge.sw <= 1920.001 && edge.sy + edge.sh <= 1080.001);
  // No facecam: blurred background instead.
  assert.equal(plan('stack', 1920, 1080).draws[0].blur, true);
  // Portrait or odd sizes still give 1080 × 1920.
  assert.deepEqual([plan('crop', 1280, 720).width, plan('blur', 720, 1280).height], [1080, 1920]);

  // Finding the facecam in the scene.
  const T = x => ({
    positionX: 0,
    positionY: 0,
    scaleX: 1,
    scaleY: 1,
    alignment: 5,
    sourceWidth: 1920,
    sourceHeight: 1080,
    ...x
  });
  const items = [
    { sourceName: 'Game', inputKind: 'game_capture', sceneItemEnabled: true, sceneItemTransform: T() },
    {
      sourceName: 'Cam',
      inputKind: 'dshow_input',
      sceneItemEnabled: true,
      sceneItemTransform: T({ positionX: 1440, positionY: 700, scaleX: 0.25, scaleY: 0.25 })
    },
    { sourceName: 'Hidden cam', inputKind: 'dshow_input', sceneItemEnabled: false, sceneItemTransform: T() }
  ];
  const base = { width: 1920, height: 1080 };
  const f = facecam(items, base, '', rect);
  assert.equal(f.name, 'Cam');
  near(f.x, 0.75, 0.001);
  near(f.w, 0.25, 0.001);
  assert.equal(facecam(items, base, 'Game', rect).name, 'Game', 'the chosen source');
  assert.equal(facecam(items, base, 'Hidden cam', rect), null, 'not a hidden one');
  assert.equal(facecam(items.slice(0, 1), base, '', rect), null, 'no camera');
  // Partly off screen: only the visible part.
  const off = facecam(
    [{ ...items[1], sceneItemTransform: T({ positionX: 1800, scaleX: 0.25, scaleY: 0.25 }) }],
    base,
    '',
    rect
  );
  near(off.x + off.w, 1, 0.001);

  // Main side helpers.
  assert.deepEqual(V.range('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(V.range('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(V.range('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(V.range('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.equal(V.range('', 1000), null);
  assert.equal(V.range('bytes=2000-', 1000).invalid, true);
  assert.equal(
    V.verticalName(path.join('D:', 'Rec', 'Replay 2026.mp4'), 'mp4'),
    path.join('D:', 'Rec', 'Replay 2026 (vertical).mp4')
  );
  assert.deepEqual(V.options({ layout: 'x', facecam: { x: 0.1, y: 0.1, w: 0, h: 1 } }), {
    layout: 'stack',
    facecam: null,
    share: 0.35
  });
  assert.deepEqual(V.options({ layout: 'crop', share: 5 }).share, 0.6);

  // The whole flow with a fake hidden window that behaves like the converter page.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-vertical-'));
  try {
    const clip = path.join(dir, 'Replay 1.mp4');
    fs.writeFileSync(clip, Buffer.from('0123456789'.repeat(100)));
    const mkv = path.join(dir, 'Replay 2.mkv');
    fs.writeFileSync(mkv, 'x');
    let handler = null,
      pageBehaviour = 'ok',
      loaded = [];
    const session = {
      fromPartition: name => {
        assert.equal(name, 'uc-vertical-clips');
        return {
          setPermissionRequestHandler() {},
          setPermissionCheckHandler() {},
          on() {},
          protocol: { handle: (scheme, fn) => (assert.equal(scheme, 'ucclip'), (handler = fn)) }
        };
      }
    };
    class FakeWindow {
      constructor(o) {
        assert.equal(o.show, false);
        assert.equal(o.webPreferences.nodeIntegration, false);
        assert.equal(o.webPreferences.sandbox, true);
        this.destroyed = false;
        this.webContents = { setWindowOpenHandler() {}, on() {} };
      }
      isDestroyed() {
        return this.destroyed;
      }
      destroy() {
        this.destroyed = true;
      }
      async loadURL(u) {
        loaded.push(u);
        const job = JSON.parse(decodeURIComponent(u.split('#')[1]));
        const page = await handler(new Request('ucclip://app/convert.html'));
        assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
        // The page reads part of the clip, as a video element does.
        const part = await handler(
          new Request('ucclip://app/clip/' + job.token, { headers: { range: 'bytes=10-19' } })
        );
        assert.equal(part.status, 206);
        assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
        assert.equal(part.headers.get('content-type'), 'video/mp4');
        assert.equal(await part.text(), '0123456789');
        assert.equal((await handler(new Request('ucclip://app/clip/wrongtoken12345678'))).status, 404);
        if (pageBehaviour === 'stall') return; // never plays: the watchdog gives up
        if (pageBehaviour === 'fail') {
          await handler(
            new Request('ucclip://app/fail/' + job.token, {
              method: 'POST',
              body: 'UniversalCollab cannot read this clip.'
            })
          );
          return;
        }
        await handler(new Request('ucclip://app/progress/' + job.token + '?t=1.0&d=2.0', { method: 'POST' }));
        if (pageBehaviour === 'slow') await new Promise(r => setTimeout(r, 150));
        await handler(
          new Request('ucclip://app/out/' + job.token + '?ext=mp4', { method: 'POST', body: 'VERTICAL' })
        );
      }
    }
    const handlers = {},
      added = [],
      told = [];
    const logFile = path.join(dir, 'vertical-clips.log');
    V.start({
      ipcMain: { handle: (n, fn) => (handlers[n] = fn) },
      guard: () => {},
      BrowserWindow: FakeWindow,
      session,
      isClip: f => f === clip || f === mkv,
      addClip: f => added.push(f),
      getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, d) => told.push([ch, d]) } }),
      logFile,
      stallMs: 400
    });
    const call = i => handlers['vertical-clip']({}, i);
    const r = await call({ file: clip, layout: 'stack', facecam: { x: 0.7, y: 0.6, w: 0.25, h: 0.3 } });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.file, 'Replay 1 (vertical).mp4');
    assert.equal(fs.readFileSync(path.join(dir, 'Replay 1 (vertical).mp4'), 'utf8'), 'VERTICAL');
    assert.deepEqual(added, [path.join(dir, 'Replay 1 (vertical).mp4')]);
    const job = JSON.parse(decodeURIComponent(loaded[0].split('#')[1]));
    assert.deepEqual([job.layout, job.facecam.w, job.fps], ['stack', 0.25, 30]);
    assert.equal(job.base, undefined, 'the app always uses its private address');
    // What the window was told, and the log.
    const states = told.filter(([ch]) => ch === 'vertical-clip').map(([, d]) => d.state);
    assert.deepEqual(states, ['queued', 'making', 'progress', 'done']);
    assert.deepEqual(told.find(([, d]) => d.state === 'progress')[1], {
      state: 'progress',
      file: clip,
      t: 1,
      d: 2,
      waiting: 0
    });
    assert.equal(told.at(-1)[1].name, 'Replay 1 (vertical).mp4');
    assert.match(
      fs.readFileSync(logFile, 'utf8'),
      /queued Replay 1\.mp4\n.*making Replay 1\.mp4\n.*saved Replay 1 \(vertical\)\.mp4\n$/
    );
    // Two clips in a row: the second waits for the first, both are made, the window hears "1 ahead".
    told.length = 0;
    pageBehaviour = 'slow';
    const both = await Promise.all([call({ file: clip }), call({ file: clip })]);
    assert(
      both.every(r => r.ok),
      JSON.stringify(both)
    );
    assert.equal(told.filter(([, d]) => d.state === 'queued')[1][1].waiting, 1);
    assert.equal(told.filter(([, d]) => d.state === 'done').length, 2);
    // A clip that never plays: given up after the stall time, and the next one is not held up.
    told.length = 0;
    pageBehaviour = 'stall';
    const stalled = call({ file: clip });
    await new Promise(r => setTimeout(r, 50));
    pageBehaviour = 'ok';
    const after = call({ file: clip });
    assert.match((await stalled).error, /stopped playing part way/);
    assert.equal((await after).ok, true, 'the next clip is still made');
    assert(told.find(([, d]) => d.state === 'failed')[1].error.includes('stopped playing'));
    assert.match(fs.readFileSync(logFile, 'utf8'), /failed Replay 1\.mp4: The clip stopped playing/);
    // The page could not read it: its message comes back.
    pageBehaviour = 'fail';
    assert.match((await call({ file: clip })).error, /cannot read this clip/);
    // Not a clip from this session, or MKV.
    assert.match((await call({ file: path.join(dir, 'other.mp4') })).error, /not available/);
    assert.match((await call({ file: mkv })).error, /This clip is MKV\. Vertical copies need MP4/);
    assert.match(fs.readFileSync(logFile, 'utf8'), /not made: This clip is MKV/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    'PASS vertical clips: layouts, facecam, ranges, only session clips, saved next to the clip, failures.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
