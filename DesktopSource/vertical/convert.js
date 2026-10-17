'use strict';
// Vertical clips (1.2.0): runs in a hidden window (vertical-clips.cjs). Plays the clip once, draws each frame into
// the 9:16 layout (layout.js) and records the result with its sound, then hands the file back. It takes as long as
// the clip. The clip and the result only travel over this window's private ucclip:// address.
(async () => {
  let job = {};
  try {
    job = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  } catch {}
  // ucclip://app/ in the app; the tests serve the same page over a local address.
  const base = /^http:\/\/127\.0\.0\.1:\d+\/$/.test(job.base || '') ? job.base : 'ucclip://app/';
  const post = (path, body) => fetch(base + path + '/' + job.token, { method: 'POST', body });
  const fail = text => post('fail', String(text).slice(0, 500));
  try {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(job.token || '')) throw Error('Invalid job.');
    const video = document.getElementById('clip');
    video.src = base + 'clip/' + job.token;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () =>
        reject(
          Error(
            'UniversalCollab cannot read this clip. In OBS: Settings → Output → Recording → Recording Format → MP4 or Hybrid MP4 (MKV clips cannot be made vertical).'
          )
        );
    });
    const p = window.verticalLayout.plan(job.layout, video.videoWidth, video.videoHeight, {
      facecam: job.facecam,
      share: job.share
    });
    const canvas = document.getElementById('out');
    canvas.width = p.width;
    canvas.height = p.height;
    const ctx = canvas.getContext('2d');
    // Sound: from the clip into the recording only, never to the speakers.
    const audio = new AudioContext();
    const dest = audio.createMediaStreamDestination();
    audio.createMediaElementSource(video).connect(dest);
    await audio.resume();
    const stream = new MediaStream([
      ...canvas.captureStream(job.fps || 30).getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);
    const types = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1,opus',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw Error('This computer cannot record video in the app.');
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 160_000
    });
    const chunks = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => (recorder.onstop = r));
    const draw = () => {
      for (const d of p.draws) {
        ctx.filter = d.blur ? 'blur(28px) brightness(0.55)' : 'none';
        ctx.drawImage(video, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      }
      ctx.filter = 'none';
    };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, p.width, p.height);
    recorder.start(1000);
    await video.play();
    // A steady frame rate from the playing clip (the window is hidden, so frame callbacks are not relied on).
    const timer = setInterval(draw, 1000 / (job.fps || 30));
    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = () => reject(Error('The clip stopped playing part way.'));
    });
    clearInterval(timer);
    draw();
    await new Promise(r => setTimeout(r, 300));
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (!blob.size) throw Error('Nothing was recorded.');
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const r = await fetch(base + 'out/' + job.token + '?ext=' + ext, { method: 'POST', body: blob });
    if (!r.ok) throw Error(await r.text());
  } catch (e) {
    await fail(e?.message || 'The vertical copy failed.').catch(() => {});
  }
})();
