'use strict';
// Chat voice (1.2.0): reads chat messages aloud. Chat settings → "Read chat aloud":
//   Off · On (streamer hears) · On (everyone hears).
// "Streamer hears" speaks with this computer's own voice, through the speakers or headphones. "Everyone hears" makes
// a speech file for each message (tts.cjs) that an OBS browser source plays into the stream (the source's link is
// copied from Chat settings); OBS then gives it its own volume, and the volume here sets how loud each message is.
// The "Chat voice" volume and Mute are in the audio panel. Messages from before it was turned on are not read.
(() => {
  const KEY = 'uc-chat-voice',
    MODES = [
      ['off', 'Off'],
      ['local', 'On (streamer hears)'],
      ['stream', 'On (everyone hears)']
    ],
    MAX_WAITING = 10,
    MAX_AGE = 120000;

  // What is spoken for a message: who said it, then what. Links are not read out.
  function sentence(message) {
    const text = String(message?.text ?? '')
      .replace(/https?:\/\/\S+/gi, ' link ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    const who = String(message?.author ?? '').trim();
    return (who ? who + ' says ' : '') + text;
  }
  const api = { sentence, MODES };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.chatVoiceFormat = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const $ = id => document.getElementById(id),
      bridge = window.relayDesktop,
      make = (tag, text, cls) => {
        const n = document.createElement(tag);
        if (text) n.textContent = text;
        if (cls) n.className = cls;
        return n;
      };
    let prefs = { mode: 'off', volume: 80, muted: false };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && MODES.some(([m]) => m === saved.mode)) prefs.mode = saved.mode;
      if (Number.isFinite(saved?.volume)) prefs.volume = Math.min(100, Math.max(0, saved.volume));
      if (typeof saved?.muted === 'boolean') prefs.muted = saved.muted;
    } catch {}
    const save = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
      } catch {}
    };
    const say = text => {
      status.textContent = text;
      if (text) window.dispatchEvent(new CustomEvent('chat-voice-note', { detail: text }));
    };

    // ---- Chat settings: the dropdown ----
    const dialog = $('chatSettingsWindow'),
      box = make('div', null, 'chat-voice-settings'),
      label = make('label', 'Read chat aloud'),
      select = make('select');
    select.id = 'chatVoiceMode';
    for (const [value, text] of MODES) select.append(new Option(text, value));
    label.append(select);
    const hint = make('p', null, 'hint'),
      status = make('p', null, 'hint'),
      row = make('div', null, 'buttons');
    status.id = 'chatVoiceStatus';
    status.setAttribute('role', 'status');
    const test = make('button', 'Hear a test'),
      copy = make('button', 'Copy OBS link for chat voice');
    test.type = copy.type = 'button';
    test.id = 'chatVoiceTest';
    copy.id = 'chatVoiceCopy';
    row.append(test, copy);
    box.append(label, hint, row, status);
    const options = dialog.querySelector('.chat-options');
    if (options) options.after(box);
    else dialog.append(box);

    // ---- Audio panel: the volume ----
    const volumeRow = make('div', null, 'obs-mixer-row chat-voice-row'),
      slider = make('input'),
      mute = make('button', 'Mute');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 100;
    slider.step = 1;
    slider.id = 'chatVoiceVolume';
    slider.setAttribute('aria-label', 'Chat voice volume');
    mute.type = 'button';
    mute.id = 'chatVoiceMute';
    volumeRow.append(make('strong', 'Chat voice'), slider, mute);
    const mixer = $('obsMixer');
    mixer.after(volumeRow);

    function paint() {
      select.value = prefs.mode;
      slider.value = String(prefs.volume);
      mute.textContent = prefs.muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(prefs.muted));
      copy.hidden = prefs.mode !== 'stream';
      hint.textContent =
        prefs.mode === 'stream'
          ? 'Everyone hears each message. In OBS add the copied link as a Browser source (it shows nothing), turn on “Control audio via OBS”, and set its Audio Monitoring to “Monitor and Output” if you want to hear it too.'
          : prefs.mode === 'local'
            ? 'Only you hear it, through your own speakers or headphones. It is not added to the stream.'
            : 'New chat messages are read out loud, with the name first. Links are read as “link”.';
    }

    // ---- Speaking ----
    const waiting = [];
    let speaking = false,
      skipped = 0;
    const volume = () => (prefs.muted ? 0 : prefs.volume / 100);
    function speakLocal(text) {
      return new Promise(resolve => {
        const synth = window.speechSynthesis;
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
          say('This computer has no speech voice the window can use.');
          return resolve();
        }
        const u = new SpeechSynthesisUtterance(text);
        u.volume = volume();
        u.onend = u.onerror = resolve;
        synth.speak(u);
      });
    }
    async function speakStream(text) {
      if (!bridge?.chatVoice) return say('Chat voice for the stream needs the desktop app.');
      const r = await bridge.chatVoice({ op: 'speak', text, volume: volume() });
      if (!r?.ok) say(r?.error || 'Chat voice failed.');
    }
    async function drain() {
      if (speaking) return;
      speaking = true;
      try {
        while (waiting.length && prefs.mode !== 'off') {
          const text = waiting.shift();
          if (volume() === 0) continue;
          try {
            if (prefs.mode === 'local') await speakLocal(text);
            else await speakStream(text);
          } catch (e) {
            say(e?.message || 'Chat voice failed.');
          }
        }
      } finally {
        speaking = false;
      }
    }
    function enqueue(text) {
      if (!text || prefs.mode === 'off') return;
      waiting.push(text);
      // Chat faster than the voice: keep the newest and say so once, instead of falling minutes behind.
      while (waiting.length > MAX_WAITING) {
        waiting.shift();
        skipped++;
      }
      if (skipped && !speaking) {
        say('Chat is faster than the voice: ' + skipped + ' older message(s) were skipped.');
        skipped = 0;
      }
      void drain();
    }
    function stopAll() {
      waiting.length = 0;
      skipped = 0;
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    }

    // ---- New chat messages (Twitch and YouTube chat in the app) ----
    let seen = null;
    const keyOf = m => String(m.key ?? m.platform + ':' + m.author + ':' + m.time + ':' + m.text);
    window.addEventListener('platform-state', e => {
      const messages = Array.isArray(e.detail?.messages) ? e.detail.messages : [];
      if (seen === null) {
        // What is already there was said before the voice started.
        seen = new Set(messages.map(keyOf));
        return;
      }
      const fresh = messages.filter(m => !seen.has(keyOf(m)));
      for (const m of fresh) seen.add(keyOf(m));
      if (seen.size > 2000) seen = new Set(messages.map(keyOf));
      if (prefs.mode === 'off') return;
      for (const m of fresh) {
        if (m.time && Date.now() - Number(m.time) > MAX_AGE) continue;
        enqueue(sentence(m));
      }
    });

    select.onchange = () => {
      prefs.mode = MODES.some(([m]) => m === select.value) ? select.value : 'off';
      save();
      stopAll();
      if (prefs.mode === 'off') say('');
      else say(prefs.mode === 'stream' ? 'Chat is now read to everyone.' : 'Chat is now read to you.');
      paint();
    };
    slider.oninput = () => {
      prefs.volume = Number(slider.value);
      if (prefs.muted && prefs.volume > 0) prefs.muted = false;
      save();
      paint();
    };
    mute.onclick = () => {
      prefs.muted = !prefs.muted;
      save();
      if (prefs.muted) stopAll();
      paint();
    };
    test.onclick = async () => {
      if (prefs.mode === 'off') return say('Choose On (streamer hears) or On (everyone hears) first.');
      if (volume() === 0) return say('Chat voice is muted or at zero volume.');
      say('');
      const sample = 'This is how chat will sound.';
      try {
        if (prefs.mode === 'local') await speakLocal(sample);
        else await speakStream(sample);
      } catch (e) {
        say(e?.message || 'Chat voice failed.');
      }
    };
    copy.onclick = async () => {
      const r = await bridge?.overlays?.({ op: 'copy', which: 'voice' });
      say(
        r?.ok
          ? 'Link copied. In OBS: Sources → + → Browser → paste it as the URL.'
          : r?.error || 'Could not copy the link.'
      );
    };
    window.chatVoice = {
      get mode() {
        return prefs.mode;
      },
      set: mode => {
        select.value = mode;
        select.onchange();
      }
    };
    paint();
  })().catch(() => {});
})();
