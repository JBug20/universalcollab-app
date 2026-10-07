// Live OBS preview through the OBS Virtual Camera, with a fake camera. Covers: live video appears and
// snapshots stop; switching to snapshots releases the camera; stopping the camera in OBS and a camera that
// fails both fall back to snapshots; losing OBS removes the video.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

// Runs in the page before the app starts: a fake "OBS Virtual Camera" drawing a changing picture.
const fakeCamera = ({ failing }) => {
  window.cameraRequests = [];
  const devices = [{ kind: 'videoinput', label: 'OBS Virtual Camera', deviceId: 'obs-cam' }];
  const media = {
    enumerateDevices: async () => devices,
    getUserMedia: async constraints => {
      window.cameraRequests.push(constraints);
      if (window.cameraFailing) throw new DOMException('Permission denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      let n = 0;
      setInterval(() => {
        ctx.fillStyle = `hsl(${(n += 20) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 640, 360);
      }, 50);
      return canvas.captureStream(30);
    }
  };
  window.cameraFailing = failing;
  Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
};

const snapshotCalls = page => page.evaluate(() => calls.filter(c => c.obs === 'preview').length);
const cameraCalls = page =>
  page.evaluate(() => calls.filter(c => c.obs === 'virtualcam').map(c => c.input.enabled));
async function open(failing = false) {
  const studio = await openStudio({ initScript: fakeCamera, initArg: { failing } });
  await studio.page.evaluate(() => document.getElementById('serverConnect').click());
  return studio;
}
const mainTile = '#layoutPreview [data-item="main"]';

// 1. Live video: the camera is started, a video fills the main tile, and snapshots stop.
{
  const { browser, page, errors } = await open();
  try {
    await page.waitForSelector(mainTile + ' video.obs-live-video', { timeout: 20000 });
    assert.deepEqual(
      (await cameraCalls(page)).slice(0, 1),
      [true],
      'the app asks OBS to start its virtual camera'
    );
    const request = await page.evaluate(() => window.cameraRequests[0]);
    assert.equal(request.audio, false, 'video only, never audio');
    assert.deepEqual(request.video.deviceId, { exact: 'obs-cam' });
    await page.waitForFunction(
      sel => document.querySelector(sel)?.videoWidth === 640,
      mainTile + ' video.obs-live-video',
      { timeout: 10000 }
    );
    assert(/Live OBS preview/.test(await page.locator('#obsPreviewStatus').innerText()));
    // No snapshot images are requested while the video runs.
    const before = await snapshotCalls(page);
    await page.waitForTimeout(1500);
    assert.equal(await snapshotCalls(page), before, 'snapshots stop while live video runs');
    assert.equal(await page.locator(mainTile + ' img.obs-preview-image').count(), 0);

    // 2. Switching to snapshots releases the camera and brings the images back.
    await page.evaluate(() => {
      const mode = document.getElementById('obsPreviewMode');
      mode.value = 'snapshots';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector(mainTile + ' img.obs-preview-image', { timeout: 10000 });
    assert.equal(await page.locator(mainTile + ' video').count(), 0);
    assert.equal((await cameraCalls(page)).at(-1), false, 'the camera is released');

    // Back to live.
    await page.evaluate(() => {
      const mode = document.getElementById('obsPreviewMode');
      mode.value = 'live';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector(mainTile + ' video.obs-live-video', { timeout: 20000 });

    // 3. The camera is stopped in OBS: after two polls the preview falls back to snapshots and says why.
    await page.evaluate(() => (window.obsVirtualCam = false));
    await page.waitForSelector(mainTile + ' img.obs-preview-image', { timeout: 15000 });
    assert(/Virtual Camera was stopped in OBS/.test(await page.locator('#obsControlStatus').innerText()));

    // 5. Losing OBS removes any video.
    await page.evaluate(() => {
      window.obsDown = true;
      emitOBS({ type: 'connection', connected: false });
    });
    await page.waitForFunction(sel => !document.querySelector(sel + ' video'), mainTile, { timeout: 8000 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

// 4. A camera that cannot be opened: snapshots keep working and the reason is shown.
{
  const { browser, page, errors } = await open(true);
  try {
    await page.waitForSelector(mainTile + ' img.obs-preview-image', { timeout: 20000 });
    await page.waitForFunction(() =>
      /Live OBS preview unavailable/.test(document.getElementById('obsControlStatus').innerText)
    );
    assert.equal(await page.locator(mainTile + ' video').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
console.log(
  'PASS live OBS preview: video replaces snapshots, camera released on request, fallbacks when OBS stops the camera or it cannot open.'
);
