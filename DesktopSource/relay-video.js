'use strict';
(async () => {
  await window.portalReady;
  if (!window.workspaceUI) await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
  const api = window.relayDesktop?.relayVideo;
  if (!api) return;
  const root = document.getElementById('layoutPreview');
  const button = document.createElement('button');
  button.textContent = 'Edit layout';
  button.type = 'button';
  const message = document.createElement('p');
  message.className = 'hint';
  message.setAttribute('role', 'status');
  const video = document.createElement('video');
  video.id = 'relayCanvasVideo';
  video.setAttribute('aria-label', 'Live relay output');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.hidden = true;
  root.append(video);
  root.after(button, message);
  // Studio mode: the relay video is the Program view; the editor stays usable as Preview.
  const studio = () => !!(window.studioMode?.enabled && window.studioMode.programBox);
  function host() {
    const box = studio() ? window.studioMode.programBox : root;
    if (video.parentElement !== box) box.prepend(video);
    root.classList.toggle('relay-video-playing', running && !studio());
  }
  window.addEventListener('studio-mode', () => {
    host();
    retryAt = 0;
    void update();
  });
  let running = false,
    identity = '',
    starting = false,
    editing = false,
    generation = 0,
    retryAt = 0;
  function stop() {
    generation++;
    running = false;
    video.playbackRate = 1;
    window.relayVideoActive = false;
    identity = '';
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    root.classList.remove('relay-video-playing');
    void api({ op: 'stop' });
  }
  button.onclick = () => {
    editing = !editing;
    button.textContent = editing ? 'Show live video' : 'Edit layout';
    stop();
    retryAt = 0;
    void update();
  };
  async function update() {
    button.hidden = studio();
    const wanted =
      connected &&
      profile?.token &&
      view?.status?.broadcast &&
      !document.hidden &&
      !document.getElementById('studioPage').hidden &&
      !document.getElementById('canvasPanel').hidden &&
      (!editing || studio());
    const next = profile?.address + '|' + profile?.id;
    if (!wanted) {
      if (running || starting) stop();
      message.textContent =
        editing && !studio()
          ? 'Layout editing · switch back to live video when finished.'
          : 'Live video appears here when your relay broadcast is running.';
      return;
    }
    if (running && identity !== next) stop();
    if (running || starting || Date.now() < retryAt) return;
    starting = true;
    const ticket = ++generation;
    message.textContent = 'Connecting to live relay video…';
    try {
      const r = await api({ op: 'start', address: profile.address, token: profile.id + ':' + profile.token });
      if (ticket !== generation) return;
      if (!r.ok) throw Error();
      identity = next;
      running = true;
      window.relayVideoActive = true;
      video.hidden = false;
      host();
      video.src = r.url;
      await video.play();
    } catch {
      if (ticket === generation) {
        stop();
        const current = view?.capabilities?.relayVideoPreview === 1;
        retryAt = Date.now() + (current ? 15000 : 60000);
        message.textContent = current
          ? 'Live video unavailable. Retrying…'
          : 'Live video unavailable. This relay may need the 1.2.0 server update. Retrying every minute…';
      }
    } finally {
      starting = false;
    }
  }
  video.onplaying = () => {
    message.textContent = 'Live relay output · muted · source quality · short playback delay.';
  };
  // A relay restart, slow-viewer cut-off or proxy close can end the stream without
  // a media error. Treat ended/stalled/no-progress as interruptions and reconnect.
  function interrupted(text, delay) {
    if (!running) return;
    stop();
    retryAt = Date.now() + delay;
    message.textContent = text;
  }
  video.onerror = () => interrupted('Live video interrupted. Retrying…', 15000);
  video.onended = () => interrupted('Live video stream ended. Reconnecting…', 2000);
  let lastTime = -1,
    lastProgress = 0;
  setInterval(() => {
    if (!running || (video.paused && video.readyState < 2)) {
      lastTime = -1;
      lastProgress = Date.now();
      return;
    }
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress > 8000) {
      interrupted('Live video stalled. Reconnecting…', 2000);
      return;
    }
    // Stay near the live edge: progressive MP4 otherwise drifts further behind.
    const b = video.buffered;
    if (b.length) {
      const end = b.end(b.length - 1),
        behind = end - video.currentTime;
      if (behind > 4) video.currentTime = Math.max(b.start(b.length - 1), end - 0.75);
      else video.playbackRate = behind > 1.5 ? 1.05 : 1;
    }
  }, 1000);
  setInterval(() => void update(), 1000);
  void update();
  window.addEventListener('beforeunload', stop);
})();
