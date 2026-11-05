'use strict';
// Chat voice (1.2.0): reads chat messages aloud. Chat settings → "Read chat aloud":
//   Off · On (streamer hears) · On (everyone hears).
// "Streamer hears" speaks with this computer's own voice, through the speakers or headphones. "Everyone hears" makes
// a speech file for each message (tts.cjs) that an OBS browser source plays into the stream (the source's link is
// copied from Chat settings); OBS then gives it its own volume, and the volume here sets how loud each message is.
// The volume and Mute are in Chat settings, under the dropdown. Messages from before it was turned on are not read.
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
  // ---- Blocklist and links: what is never read out ----
  // A voice on the stream can say something that gets the streamer banned, so the check is cautious: letters
  // are lined up the way people disguise them (accents, 0→o, 1→i, 3→e, 4→a, 5→s, @→a, $→s, 7→t), spaces and
  // symbols between letters are ignored, and repeated letters count once. A listed word of four letters or more
  // matches anywhere in what is left; a shorter one only as a whole word. A message that is skipped by mistake
  // is only not read; a message read by mistake could cost the channel.
  const SUBSTITUTE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '+': 't' };
  const fold = text =>
    String(text ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[0134578@$!+]/g, c => SUBSTITUTE[c] || c);
  const wordsOf = text =>
    fold(text)
      .split(/[^a-z]+/)
      .filter(Boolean);
  const squash = text =>
    fold(text)
      .replace(/[^a-z]/g, '')
      .replace(/(.)\1+/g, '$1');
  function parseBlocklist(text) {
    return [
      ...new Set(
        String(text ?? '')
          .split(/[\n,;]+/)
          .map(w => w.trim())
          .filter(Boolean)
          .slice(0, 500)
      )
    ];
  }
  function blocked(text, list) {
    if (!list?.length) return false;
    const spaced = ' ' + wordsOf(text).join(' ') + ' ',
      tight = squash(text);
    for (const entry of list) {
      const words = wordsOf(entry),
        tightEntry = squash(entry);
      if (!words.length) continue;
      if (spaced.includes(' ' + words.join(' ') + ' ')) return true;
      if (tightEntry.length >= 4 && tight.includes(tightEntry)) return true;
    }
    return false;
  }
  // A web address, with or without http(s):// (www.…, discord.gg/…, example.com/…).
  const TLD =
    'com|net|org|gg|tv|io|me|ly|co|uk|de|fr|es|it|nl|be|ru|cn|jp|br|in|au|ca|us|eu|app|dev|xyz|info|biz|link|click|site|online|shop|store|top|live|fm|to|ws|cc|tk|ml|ga|cf|gq|pw|vip|club|win|bid|icu|cam|page|world|today|stream|chat|social|zip|mov';
  const LINK = new RegExp(
    '(?:https?:\\/\\/|www\\.)\\S+|\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:' + TLD + ')\\b(?:\\/\\S*)?',
    'i'
  );
  const hasLink = text => LINK.test(String(text ?? ''));
  // What to tell Linux users: the package names differ by distribution.
  const LINUX_HELP =
    'Linux: reading chat aloud needs speech voices installed, then restart UniversalCollab. ' +
    'Arch / Garuda: sudo pacman -S speech-dispatcher espeak-ng · ' +
    'Debian / Ubuntu: sudo apt install speech-dispatcher espeak-ng · ' +
    'Fedora: sudo dnf install speech-dispatcher espeak-ng. ' +
    '“On (streamer hears)” uses speech-dispatcher; “On (everyone hears)” uses espeak-ng.';
  const api = { sentence, MODES, parseBlocklist, blocked, hasLink, fold, LINUX_HELP };
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
    let prefs = { mode: 'off', volume: 80, muted: false, skipLinks: true, blocklist: '' };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && MODES.some(([m]) => m === saved.mode)) prefs.mode = saved.mode;
      if (Number.isFinite(saved?.volume)) prefs.volume = Math.min(100, Math.max(0, saved.volume));
      if (typeof saved?.muted === 'boolean') prefs.muted = saved.muted;
      if (typeof saved?.skipLinks === 'boolean') prefs.skipLinks = saved.skipLinks;
      if (typeof saved?.blocklist === 'string') prefs.blocklist = saved.blocklist.slice(0, 20000);
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
    const linux = make('p', LINUX_HELP, 'hint');
    linux.id = 'chatVoiceLinux';
    linux.hidden = !/Linux/.test(navigator.userAgent) || /Android/.test(navigator.userAgent);
    const skipLabel = make('label', null, 'check'),
      skipLinks = make('input');
    skipLinks.type = 'checkbox';
    skipLinks.id = 'chatVoiceSkipLinks';
    skipLabel.append(skipLinks, document.createTextNode(' Never read messages that contain links'));
    const blockLabel = make('label', 'Never read messages with these words (one per line)'),
      blockText = make('textarea');
    blockText.id = 'chatVoiceBlocklist';
    blockText.rows = 4;
    blockText.maxLength = 20000;
    blockText.setAttribute('autocomplete', 'off');
    blockText.setAttribute('spellcheck', 'false');
    blockLabel.append(blockText);
    const blockHint = make(
      'p',
      'For words that could get someone banned. Letters people swap (a→@, e→3, o→0) and spaces between letters are caught too, so a listed word is skipped in disguise as well. It only stops the voice: the message still shows in chat, so keep Twitch’s own AutoMod and blocked terms on as well.',
      'hint'
    );
    const test = make('button', 'Hear a test'),
      copy = make('button', 'Copy OBS link for chat voice');
    test.type = copy.type = 'button';
    test.id = 'chatVoiceTest';
    copy.id = 'chatVoiceCopy';
    // ---- The volume, under the dropdown ----
    const volumeRow = make('div', null, 'chat-voice-row'),
      slider = make('input'),
      percent = make('span', null, 'chat-voice-percent'),
      mute = make('button', 'Mute');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 100;
    slider.step = 1;
    slider.id = 'chatVoiceVolume';
    slider.setAttribute('aria-label', 'Chat voice volume');
    percent.id = 'chatVoicePercent';
    mute.type = 'button';
    mute.id = 'chatVoiceMute';
    volumeRow.append(make('strong', 'Volume'), slider, percent, mute);
    row.append(test, copy);
    box.append(label, linux, hint, volumeRow, row, status, skipLabel, blockLabel, blockHint);
    const options = dialog.querySelector('.chat-options');
    if (options) options.after(box);
    else dialog.append(box);

    function paint() {
      select.value = prefs.mode;
      slider.value = String(prefs.volume);
      percent.textContent = prefs.muted ? 'Muted' : prefs.volume + '%';
      mute.textContent = prefs.muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(prefs.muted));
      copy.hidden = prefs.mode !== 'stream';
      skipLinks.checked = prefs.skipLinks;
      if (document.activeElement !== blockText) blockText.value = prefs.blocklist;
      hint.textContent =
        prefs.mode === 'stream'
          ? 'Everyone hears each message. In OBS add the copied link as a Browser source (it shows nothing), turn on “Control audio via OBS”, and set its Audio Monitoring to “Monitor and Output” if you want to hear it too.'
          : prefs.mode === 'local'
            ? 'Only you hear it, through your own speakers or headphones. It is not added to the stream.'
            : 'New chat messages are read out loud, with the name first. Links are read as “link”.';
    }

    // ---- Speaking ----
    const waiting = [];
    let held = 0;
    const list = () => parseBlocklist(prefs.blocklist);
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
        if (prefs.skipLinks && hasLink(m.text)) continue;
        if (blocked((m.author ?? '') + ' ' + (m.text ?? ''), list())) {
          held++;
          say(held + ' message' + (held === 1 ? ' was' : 's were') + ' not read because of the blocklist.');
          continue;
        }
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
    skipLinks.onchange = () => {
      prefs.skipLinks = skipLinks.checked;
      save();
    };
    blockText.oninput = () => {
      prefs.blocklist = blockText.value.slice(0, 20000);
      save();
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
