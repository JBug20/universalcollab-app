// Vertical clips (1.2.0): the converter page really makes a 1080 × 1920 copy with sound. A 2-second test clip
// (red left half, blue right half, a green "facecam" bottom right, a tone) is converted with the facecam layout:
// the top of the result shows the green facecam, the bottom the gameplay (red and blue), and it has sound.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = new URL('../DesktopSource/vertical/', import.meta.url).pathname;
const files = {};
const token = 'testtoken_0123456789abcdef';
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = async () => {
    const parts = [];
    for await (const c of req) parts.push(c);
    return Buffer.concat(parts);
  };
  if (req.method === 'GET' && ['/convert.html', '/convert.js', '/layout.js'].includes(u.pathname)) {
    res.writeHead(200, { 'content-type': u.pathname.endsWith('.html') ? 'text/html' : 'text/javascript' });
    return res.end(fs.readFileSync(path.join(dir, u.pathname.slice(1))));
  }
  if (req.method === 'GET' && u.pathname === '/blank.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>x</title>');
  }
  if (req.method === 'POST' && u.pathname === '/source') {
    files.source = await body();
    res.writeHead(200);
    return res.end('ok');
  }
  const send = (buf, type) => {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = +range[1],
        end = range[2] ? +range[2] : buf.length - 1;
      res.writeHead(206, {
        'content-type': type,
        'content-range': `bytes ${start}-${end}/${buf.length}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1
      });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length });
    res.end(buf);
  };
  if (req.method === 'GET' && u.pathname === '/clip/' + token) return send(files.source, 'video/webm');
  if (req.method === 'GET' && u.pathname === '/result') return send(files.out, files.outType);
  if (req.method === 'POST' && u.pathname === '/out/' + token) {
    files.out = await body();
    files.outType = u.searchParams.get('ext') === 'webm' ? 'video/webm' : 'video/mp4';
    res.writeHead(200);
    return res.end('ok');
  }
  if (req.method === 'POST' && u.pathname === '/fail/' + token) {
    files.fail = String(await body());
    res.writeHead(200);
    return res.end('ok');
  }
  res.writeHead(404);
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
});
try {
  const page = await browser.newPage();
  // 1. A 2-second 1280 × 720 test clip with a tone.
  await page.goto(base + 'blank.html');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = '#ff0000';
      g.fillRect(0, 0, 640, 720);
      g.fillStyle = '#0000ff';
      g.fillRect(640, 0, 640, 720);
      g.fillStyle = '#00ff00';
      g.fillRect(920, 470, 320, 216); // facecam: x 0.72–0.97, y 0.65–0.95
    };
    paint();
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const stream = new MediaStream([
      ...c.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const timer = setInterval(paint, 33);
    rec.start(250);
    await new Promise(r => setTimeout(r, 2000));
    rec.stop();
    await new Promise(r => (rec.onstop = r));
    clearInterval(timer);
    await fetch('/source', { method: 'POST', body: new Blob(chunks, { type: 'video/webm' }) });
  });
  assert(files.source?.length > 1000, 'test clip made');

  // 2. Convert with the facecam layout.
  const job = {
    token,
    base,
    layout: 'stack',
    facecam: { x: 0.72, y: 0.65, w: 0.25, h: 0.3 },
    share: 0.35,
    fps: 30
  };
  await page.goto(base + 'convert.html#' + encodeURIComponent(JSON.stringify(job)));
  for (let i = 0; i < 300 && !files.out && !files.fail; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(files.fail, undefined, files.fail);
  assert(files.out?.length > 1000, 'vertical copy received');

  // 3. Check the result: size, picture and sound.
  await page.goto(base + 'blank.html');
  const r = await page.evaluate(async () => {
    const v = document.createElement('video');
    v.src = '/result';
    v.muted = false;
    document.body.append(v);
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('result does not play'));
    });
    await v.play();
    await new Promise(r => setTimeout(r, 1200));
    v.pause();
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return {
      w: v.videoWidth,
      h: v.videoHeight,
      top: px(540, 330),
      bottomLeft: px(150, 1500),
      bottomRight: px(930, 1500),
      audioBytes: v.webkitAudioDecodedByteCount
    };
  });
  assert.deepEqual([r.w, r.h], [1080, 1920]);
  const is = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i]) < 70);
  assert(is(r.top, [0, 255, 0]), 'facecam on top: ' + r.top);
  assert(is(r.bottomLeft, [255, 0, 0]), 'gameplay left: ' + r.bottomLeft);
  assert(is(r.bottomRight, [0, 0, 255]), 'gameplay right: ' + r.bottomRight);
  assert(r.audioBytes > 0, 'it has sound');

  // 4. A clip that cannot be read: a clear message.
  files.source = Buffer.from('not a video');
  delete files.out;
  delete files.fail;
  await page.goto(base + 'convert.html#' + encodeURIComponent(JSON.stringify({ ...job, layout: 'crop' })));
  for (let i = 0; i < 300 && !files.fail; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(files.out, undefined, 'nothing made from an unreadable clip');
  assert.match(String(files.fail), /cannot read this clip[\s\S]*MP4 or Hybrid MP4/, 'message: ' + files.fail);
  console.log(
    'PASS vertical clip conversion: 1080 × 1920, facecam on top, gameplay below, sound, unreadable clip.'
  );
} finally {
  await browser.close();
  server.close();
}
