'use strict';
// Vertical clips (1.2.0): runs in a hidden window (vertical-clips.cjs). Plays the clip once, draws each frame into
// the 9:16 layout (layout.js) and records the result with its sound, then hands the file back. It takes as long as
// the clip. Before handing it back it checks the result has a picture, and records again once if not. The clip and
// the result only travel over this window's private ucclip:// address.
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
    const draw = () => {
      for (const d of p.draws) {
        ctx.filter = d.blur ? 'blur(28px) brightness(0.55)' : 'none';
        ctx.drawImage(video, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      }
      ctx.filter = 'none';
    };

    async function recordOnce() {
      const stream = new MediaStream([
        ...canvas.captureStream(job.fps || 30).getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 160_000
      });
      const chunks = [];
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      const stopped = new Promise(r => (recorder.onstop = r));
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, p.width, p.height);
      if (video.currentTime > 0) {
        video.currentTime = 0;
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
      }
      await video.play();
      // The first picture is drawn before recording starts, so the file starts with video as well as sound.
      await new Promise(r =>
        video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })
      );
      draw();
      await new Promise(r => requestAnimationFrame(() => r()));
      recorder.start(1000);
      // A steady frame rate from the playing clip (the window is hidden, so frame callbacks are not relied on).
      const timer = setInterval(draw, 1000 / (job.fps || 30));
      // How far it is, once a second (the app shows it, and gives up if it stops moving).
      const progress = setInterval(() => {
        fetch(
          base +
            'progress/' +
            job.token +
            '?t=' +
            video.currentTime.toFixed(1) +
            '&d=' +
            (Number.isFinite(video.duration) ? video.duration : 0).toFixed(1),
          { method: 'POST' }
        ).catch(() => {});
      }, 1000);
      try {
        await new Promise((resolve, reject) => {
          video.onended = resolve;
          video.onerror = () => reject(Error('The clip stopped playing part way.'));
        });
      } finally {
        clearInterval(timer);
        clearInterval(progress);
      }
      draw();
      await new Promise(r => setTimeout(r, 300));
      recorder.stop();
      await stopped;
      for (const t of stream.getVideoTracks()) t.stop();
      return new Blob(chunks, { type: mimeType.split(';')[0] });
    }
    // Does the result have a picture? (Checked by loading it, as a player would.)
    async function hasPicture(blob) {
      const v = document.createElement('video');
      v.muted = true;
      const url = URL.createObjectURL(blob);
      try {
        v.src = url;
        return await new Promise(resolve => {
          const t = setTimeout(() => resolve(false), 10000);
          v.onloadeddata = () => {
            clearTimeout(t);
            resolve(v.videoWidth > 0 && v.videoHeight > 0);
          };
          v.onerror = () => {
            clearTimeout(t);
            resolve(false);
          };
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    let blob = await recordOnce();
    if (!blob.size || !(await hasPicture(blob))) blob = await recordOnce();
    if (!blob.size) throw Error('Nothing was recorded.');
    if (!(await hasPicture(blob)))
      throw Error('The vertical copy came out without a picture. Try Clip again.');
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const r = await fetch(base + 'out/' + job.token + '?ext=' + ext, { method: 'POST', body: blob });
    if (!r.ok) throw Error(await r.text());
  } catch (e) {
    await fail(e?.message || 'The vertical copy failed.').catch(() => {});
  }
})();
