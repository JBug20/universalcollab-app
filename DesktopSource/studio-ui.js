'use strict';
(() => {
  const bridge = window.relayDesktop;
  let accountState = null,
    custom = [],
    doing = false,
    lastHistory = 0,
    lastServer = '',
    draftId = '',
    readyId = '',
    failedPlatform = '',
    needsReconnect = false;
  const call = (op, input = {}) => {
    if (!bridge?.studio) throw Error('Install the 0.7.0 desktop app to manage connections and streams.');
    return bridge.studio(op, input);
  };
  const say = text => {
    $('productionStatus').textContent = text;
    $('productionActionStatus').textContent = text;
  };
  bridge?.onStudioProgress?.(s => {
    if (doing) say(s.message);
  });
  function recovery(e) {
    failedPlatform = e.platform || '';
    needsReconnect = !!e.reconnect;
    $('productionRecovery').hidden = !failedPlatform;
    $('reconnectProduction').hidden = !needsReconnect;
    $('reconnectProduction').textContent =
      'Reconnect ' + (failedPlatform === 'twitch' ? 'Twitch' : 'YouTube');
    $('excludeFailed').textContent =
      'Prepare without ' + (failedPlatform === 'twitch' ? 'Twitch' : 'YouTube');
  }
  $('reconnectProduction').onclick = () =>
    act(async () => {
      const p = failedPlatform;
      if (!['twitch', 'youtube'].includes(p)) return;
      await bridge.platform('disconnect', { platform: p });
      await bridge.platform('connect', { platform: p });
      say('Finish sign-in in your browser, then retry Create & prepare. Your draft is kept.');
    });
  $('excludeFailed').onclick = () => {
    if (doing || active || uncertain) return;
    wanted.delete(failedPlatform);
    for (const input of $('productionDestinations').querySelectorAll('input'))
      if (input.value === failedPlatform) input.checked = false;
    saveDraft();
    $('productionForm').requestSubmit();
  };
  async function act(fn) {
    if (doing) return;
    doing = true;
    availability();
    try {
      await fn();
    } catch (e) {
      say(e.message || 'Action failed.');
      recovery(e);
    } finally {
      doing = false;
      availability();
    }
  }
  for (const p of ['twitch', 'youtube']) {
    const section = $('tab-' + p);
    $('connectionDetails').append(section);
    section.hidden = true;
    const close = button('Close ' + p + ' settings', () => (section.hidden = true));
    section.prepend(close);
  }
  // Keep all platform forms/handlers, with settings expanded only when selected.
  for (const [p, id] of [
    ['twitch', 'linkTwitch'],
    ['youtube', 'linkYoutube']
  ])
    $(id).onclick = () => {
      if (accountState?.accounts[p]) window.dispatchEvent(new CustomEvent('manage-platform', { detail: p }));
      else $(p + 'Connect').click();
    };
  $('connectionDetails').append($('platformNotice')); // login/API notices stay next to connections
  const storage = 'universalcollab-production-draft-v1';
  let wanted = new Set();
  let resolutions = {},
    qualities = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storage) || '{}');
    resolutions = saved.resolutions || {};
    qualities = saved.qualities || {};
  } catch {}
  function formData() {
    return {
      resolutions,
      qualities,
      id: draftId,
      title: $('productionTitle').value.trim(),
      description: $('productionDescription').value,
      sync: $('productionSync').checked,
      twitchTitle: $('productionTwitchTitle').value,
      youtubeTitle: $('productionYoutubeTitle').value,
      youtubeDescription: $('productionYoutubeDescription').value,
      selected: [...$('productionDestinations').querySelectorAll('input:checked')].map(x => x.value),
      gameId: $('productionGame').value,
      categoryId: $('productionCategory').value,
      privacy: $('productionPrivacy').value,
      audienceSet: !!$('productionKids').value,
      madeForKids: $('productionKids').value === 'yes',
      record: $('productionRecord').checked
    };
  }

  const profileKey = 'universalcollab-stream-profiles-v2';
  let streamProfiles = [];
  try {
    const v = JSON.parse(localStorage.getItem(profileKey) || '[]');
    if (Array.isArray(v)) streamProfiles = v.slice(0, 50);
  } catch {}
  const profiles = document.createElement('fieldset'),
    legend = document.createElement('legend'),
    profileSelect = document.createElement('select'),
    profileName = document.createElement('input');
  legend.textContent = 'Stream profiles';
  profileSelect.setAttribute('aria-label', 'Saved stream profile');
  profileName.placeholder = 'Profile name';
  profileName.maxLength = 60;
  profileName.setAttribute('aria-label', 'Profile name');
  profiles.append(legend, profileSelect, profileName);
  $('productionForm').prepend(profiles);
  function profileList() {
    profileSelect.replaceChildren(new Option('Choose a saved profile', ''));
    for (const p of streamProfiles)
      if (p.server === selected()?.key) profileSelect.append(new Option(p.name, p.key));
  }
  const saveProfileButton = button('Save profile', () => {
    const name = profileName.value.trim();
    if (!name || !selected()) {
      say('Enter a profile name and select a relay.');
      return;
    }
    const existing = streamProfiles.find(p => p.server === selected().key && p.name === name);
    if (existing && !confirm('Replace this saved stream profile?')) return;
    if (!existing && streamProfiles.length >= 50) {
      say('Remove a profile before adding another.');
      return;
    }
    const item = {
      key: existing?.key || crypto.randomUUID(),
      server: selected().key,
      name,
      draft: {
        ...formData(),
        gameName: $('productionGame').selectedOptions[0]?.textContent || '',
        categoryName: $('productionCategory').selectedOptions[0]?.textContent || '',
        id: '',
        readyId: ''
      }
    };
    streamProfiles = streamProfiles.filter(p => p.key !== item.key);
    streamProfiles.push(item);
    localStorage.setItem(profileKey, JSON.stringify(streamProfiles));
    profileList();
    profileSelect.value = item.key;
    say('Stream profile saved.');
  });
  const loadProfileButton = button('Load profile', () => {
    if (!connected || uncertain || view?.status?.broadcast || busy) {
      say('Connect to the relay and end the broadcast before loading a profile.');
      return;
    }
    const p = streamProfiles.find(p => p.key === profileSelect.value && p.server === selected()?.key);
    if (!p) return;
    const d = p.draft;
    draftId = crypto.randomUUID();
    readyId = '';
    resolutions = d.resolutions || {};
    qualities = d.qualities || {};
    wanted = new Set(d.selected || []);
    $('productionDestinations').replaceChildren();
    for (const [k, id] of [
      ['title', 'productionTitle'],
      ['description', 'productionDescription'],
      ['twitchTitle', 'productionTwitchTitle'],
      ['youtubeTitle', 'productionYoutubeTitle'],
      ['youtubeDescription', 'productionYoutubeDescription'],
      ['privacy', 'productionPrivacy']
    ])
      $(id).value = d[k] || '';
    $('productionSync').checked = d.sync !== false;
    $('productionOverrides').hidden = d.sync !== false;
    $('productionKids').value = d.audienceSet ? (d.madeForKids ? 'yes' : 'no') : '';
    $('productionRecord').checked = !!d.record;
    for (const [id, key, label] of [
      ['productionGame', 'gameId', 'gameName'],
      ['productionCategory', 'categoryId', 'categoryName']
    ]) {
      const select = $(id);
      if (d[key] && ![...select.options].some(o => o.value === d[key]))
        select.append(new Option(d[label] || d[key], d[key]));
      select.value = d[key] || '';
    }
    choices();
    saveDraft();
    profileName.value = p.name;
    say('Profile loaded. Review destinations and category, then Create & prepare.');
  });
  const deleteProfileButton = button('Delete profile', () => {
    if (!profileSelect.value || !confirm('Delete this saved profile?')) return;
    streamProfiles = streamProfiles.filter(p => p.key !== profileSelect.value);
    localStorage.setItem(profileKey, JSON.stringify(streamProfiles));
    profileList();
  });
  for (const b of [saveProfileButton, loadProfileButton, deleteProfileButton]) {
    b.type = 'button';
    profiles.append(b);
  }
  profileSelect.onchange = () => {
    profileName.value = streamProfiles.find(p => p.key === profileSelect.value)?.name || '';
  };
  setInterval(() => {
    const key = selected()?.key || '';
    if (profiles.dataset.server !== key) {
      profiles.dataset.server = key;
      profileList();
    }
  }, 1000);
  function saveDraft() {
    try {
      localStorage.setItem(storage, JSON.stringify({ ...formData(), readyId }));
    } catch {}
  }
  function choices() {
    const previous = new Set(
      [...$('productionDestinations').querySelectorAll('input:checked')].map(x => x.value)
    );
    for (const id of wanted) previous.add(id);
    $('productionDestinations').replaceChildren();
    for (const c of [
      ...['twitch', 'youtube'].map(id => ({
        id,
        name: id === 'twitch' ? 'Twitch' : 'YouTube',
        available: !!accountState?.accounts[id]
      })),
      ...custom.map(c => ({ ...c, available: true }))
    ]) {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = c.id;
      input.disabled = !c.available;
      input.checked = previous.has(c.id) && c.available;
      input.onchange = () => {
        wanted = new Set(
          [...$('productionDestinations').querySelectorAll('input:checked')].map(x => x.value)
        );
        saveDraft();
      };
      label.append(input, document.createTextNode(c.name + (c.available ? '' : ' · Connect first')));
      const pick = (name, list, value, onchange) => {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', c.name + ' ' + name);
        for (const [v, text] of list) {
          const option = document.createElement('option');
          option.value = v;
          option.textContent = text;
          sel.append(option);
        }
        sel.value = value;
        if (sel.value !== value) sel.value = list[0][0];
        sel.onchange = onchange;
        return sel;
      };
      const q = qualities[c.id] || {};
      const row = document.createElement('div');
      row.className = 'destination-quality';
      const note = document.createElement('small');
      note.className = 'destination-quality-note';
      const size = pick(
        'output resolution',
        [
          ['', 'Source size'],
          ['2560x1440', '1440p'],
          ['1920x1080', '1080p'],
          ['1600x900', '900p'],
          ['1280x720', '720p'],
          ['854x480', '480p'],
          ['640x360', '360p']
        ],
        resolutions[c.id] || '',
        () => {
          resolutions[c.id] = size.value;
          update();
        }
      );
      const rate = pick(
        'video bitrate',
        [
          ['', 'Auto bitrate'],
          ...[1500, 2500, 3500, 4500, 6000, 8000, 10000, 12000, 15000, 20000].map(k => [
            String(k),
            (k / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' Mbps'
          ])
        ],
        q.bitrateKbps ? String(q.bitrateKbps) : '',
        () => {
          qualities[c.id] = {
            ...(qualities[c.id] || {}),
            bitrateKbps: rate.value ? Number(rate.value) : null
          };
          update();
        }
      );
      const fps = pick(
        'frame rate',
        [
          ['', 'Source fps'],
          ['60', '60 fps'],
          ['50', '50 fps'],
          ['30', '30 fps'],
          ['25', '25 fps']
        ],
        q.fps ? String(q.fps) : '',
        () => {
          qualities[c.id] = { ...(qualities[c.id] || {}), fps: fps.value ? Number(fps.value) : null };
          update();
        }
      );
      function update() {
        const custom = !!(size.value || rate.value || fps.value);
        const warn = [];
        if (c.id === 'twitch' && (['2560x1440'].includes(size.value) || Number(rate.value) > 8000))
          warn.push(
            'Twitch guidelines recommend up to 1080p60 at about 6 Mbps; higher settings may be rejected or buffer for viewers.'
          );
        note.textContent =
          (custom
            ? 'Re-encoded on the relay for this destination (uses extra server CPU).'
            : 'Exact copy of the relay output (no extra server CPU).') +
          (warn.length ? ' ' + warn.join(' ') : '');
        saveDraft();
      }
      row.append(size, rate, fps, note);
      label.append(row);
      update();
      $('productionDestinations').append(label);
    }
  }
  function customPaint() {
    const root = $('customConnections');
    root.replaceChildren();
    for (const c of custom) {
      const row = document.createElement('div');
      row.className = 'custom-connection';
      const name = document.createElement('span');
      name.textContent = c.name + ' · RTMP';
      row.append(
        name,
        button('Remove', () =>
          act(async () => {
            const s = await call('remove-custom', { id: c.id });
            custom = s.custom;
            customPaint();
            choices();
          })
        )
      );
      root.append(row);
    }
  }
  for (const b of document.querySelectorAll('[data-custom-preset]'))
    b.onclick = () => {
      if (b.dataset.customPreset === 'Kick') {
        // Progress and errors also go under the Connections buttons, where the Kick button is.
        const feedback = $('linkFeedback');
        const tell = text => {
          say(text);
          feedback.textContent = text;
        };
        act(async () => {
          tell('Approve Kick in your browser. This may take a few minutes.');
          try {
            const result = await call('kick-connect');
            custom = result.custom;
            customPaint();
            choices();
            tell('Kick connected successfully. Select it when preparing your stream.');
          } catch (e) {
            feedback.textContent = 'Kick connection failed: ' + (e.message || 'no reason given.');
            throw e;
          }
        });
        return;
      }
      $('customConnectionForm').hidden = false;
      $('customName').value = b.dataset.customPreset === 'Custom' ? '' : b.dataset.customPreset;
      $('customUrl').value = '';
      $('customKey').value = '';
    };
  $('customCancel').onclick = () => {
    $('customConnectionForm').hidden = true;
    $('customUrl').value = $('customKey').value = '';
  };
  $('customConnectionForm').onsubmit = e => {
    e.preventDefault();
    act(async () => {
      const s = await call('custom', {
        name: $('customName').value,
        url: $('customUrl').value.trim(),
        key: $('customKey').value.trim()
      });
      custom = s.custom;
      customPaint();
      choices();
      $('customCancel').click();
      say('Custom connection saved on this device.');
    });
  };
  $('newStream').onclick = () => {
    draftId = crypto.randomUUID();
    readyId = '';
    $('productionForm').hidden = false;
    say('Choose destinations and metadata, then create the stream.');
    saveDraft();
  };
  $('productionSync').onchange = () => {
    $('productionOverrides').hidden = $('productionSync').checked;
    saveDraft();
  };
  $('productionForm').addEventListener('change', saveDraft);
  $('productionForm').onsubmit = e => {
    e.preventDefault();
    act(async () => {
      $('productionRecovery').hidden = true;
      const draft = formData();
      if (draft.selected.includes('youtube') && !$('productionKids').value)
        throw Error('Choose the YouTube audience first.');
      if (!connected || !selected()) throw Error('Connect to a relay server first.');
      busy = true;
      serverMenu();
      say('Preparing platforms and assigning destinations…');
      try {
        const result = await call('prepare', { serverKey: selected().key, draft });
        readyId = draftId;
        saveDraft();
        window.dispatchEvent(new Event('stream-prepared'));
        say(
          'Ready — server confirmed: ' +
            result.destinations.map(d => d.name).join(' + ') +
            '. Click Start Stream when you are ready to go live.'
        );
        if (result.broadcastId) {
          try {
            await window.selectCreatedBroadcast?.(result.broadcastId);
          } catch {
            say('Ready — destinations saved. YouTube chat details could not load; streaming is ready.');
          }
        }
      } finally {
        busy = false;
        serverMenu();
        await refresh();
      }
    });
  };
  $('updateStreamMetadata').onclick = () =>
    act(async () => {
      const result = await call('metadata', { ...formData(), id: readyId || draftId });
      say(
        result.results
          .map(r => (r.platform === 'twitch' ? 'Twitch' : 'YouTube') + ': ' + (r.ok ? 'updated' : r.error))
          .join(' · ')
      );
    });
  $('productionGameSearch').onclick = () =>
    act(async () => {
      const result = await bridge.platform('categories', { query: $('productionGameQuery').value });
      $('productionGame').replaceChildren(
        new Option('Keep current game', ''),
        ...result.map(r => new Option(r.name, r.id))
      );
    });
  $('productionCategories').onclick = () =>
    act(async () => {
      const old = $('productionCategory').value,
        items = await bridge.platform('youtube-categories');
      $('productionCategory').replaceChildren(...items.map(r => new Option(r.name, r.id)));
      $('productionCategory').value = old;
    });
  $('openYoutubeStudio').onclick = () => act(() => call('open-youtube'));
  async function history() {
    if (!connected) return;
    const original = profile;
    $('streamHistory').textContent = 'Loading…';
    try {
      const s = await api('/api/v3/recordings');
      if (profile !== original) return;
      const root = $('streamHistory');
      root.replaceChildren();
      if (!s.items.length) {
        root.textContent =
          'Your next stream will appear here. Older streams cannot be recorded retroactively.';
        return;
      }
      for (const item of s.items) {
        const row = document.createElement('article');
        row.className = 'history-item';
        const title = document.createElement('strong');
        title.textContent = item.title;
        const detail = document.createElement('small');
        detail.textContent =
          new Date(item.startedAt).toLocaleString() +
          ' · ' +
          item.state +
          ' · ' +
          (item.bytes ? (item.bytes / 1048576).toFixed(1) + ' MB' : 'No recording');
        row.append(title, detail);
        if (item.note) {
          const note = document.createElement('small');
          note.textContent = item.note;
          row.append(note);
        }
        const download = button('Download', () =>
          act(async () => {
            say('Downloading recording…');
            const r = await call('download', { serverKey: selected().key, id: item.id, title: item.title });
            say(r.cancelled ? 'Download cancelled.' : 'Recording downloaded.');
          })
        );
        download.disabled = !item.downloadable || !bridge?.studio;
        row.append(download);
        if (item.downloadable && view?.capabilities?.recordingManagement !== false) {
          const remove = button('Delete recording', () =>
            act(async () => {
              if (!confirm('Permanently delete this server recording?')) return;
              await api('/api/v3/recording-delete', { id: item.id });
              await history();
            })
          );
          row.append(remove);
        }
        root.append(row);
      }
    } catch {
      $('streamHistory').textContent = 'History unavailable. Update the relay server to 0.7.0 and reconnect.';
    }
    lastHistory = Date.now();
  }
  $('refreshRecordings').onclick = () => act(history);
  function availability() {
    const health = $('destinationHealth');
    health.replaceChildren();
    if (connected) {
      for (const output of view?.status?.outputs || []) {
        const line = document.createElement('p');
        line.className = 'hint';
        line.textContent = output.name + ' · ' + output.state;
        health.append(line);
      }
      const rec = view?.status?.recording;
      if (rec) {
        const line = document.createElement('p');
        line.className = 'hint';
        line.textContent = rec.note || (rec.recording ? 'Server recording active' : 'No server recording');
        health.append(line);
      }
    }
    const capable = connected && view?.capabilities?.verifiedProduction === 2;
    const plan = view?.me?.production;
    if (connected) {
      const line = document.createElement('p');
      line.className = 'hint';
      line.textContent = plan
        ? 'Server destinations: ' + plan.destinations.map(d => d.name).join(' + ')
        : view?.me?.destinationConfigured
          ? 'A previous single destination is saved. Prepare this stream to replace it.'
          : 'Not ready — prepare a stream before starting OBS.';
      health.append(line);
      if (!capable) {
        const warning = document.createElement('p');
        warning.textContent = 'Update the server to 0.7.1 to prepare streams.';
        health.append(warning);
      }
    }
    $('prepareStream').disabled = doing || !capable || active || uncertain;
    for (const input of $('productionForm').querySelectorAll('input,select,textarea')) input.disabled = doing;
    for (const input of $('productionDestinations').querySelectorAll('input'))
      input.disabled =
        doing || (['twitch', 'youtube'].includes(input.value) && !accountState?.accounts[input.value]);
    $('reconnectProduction').disabled = doing;
    $('excludeFailed').disabled = doing || active || uncertain;
    $('newStream').disabled = doing || active || uncertain || !bridge?.studio;
    $('updateStreamMetadata').disabled = doing || !bridge?.studio;
    $('refreshRecordings').disabled = doing || !capable;
    $('productionRecord').disabled = !capable || view?.capabilities?.recording !== true;
    $('recordingPolicy').textContent = !connected
      ? 'Connect to check recording availability.'
      : view?.capabilities?.recording
        ? 'Recording available; the host’s storage limit applies.'
        : 'Server recording is disabled by the host.';
    const server = connected ? selected()?.key : '';
    if (server !== lastServer) {
      lastServer = server;
      lastHistory = 0;
      $('streamHistory').textContent = connected
        ? 'Click Refresh to load streams from this server.'
        : 'Connect to see your stream history.';
    }
    if (capable && !doing && Date.now() - lastHistory > 30000) {
      lastHistory = Date.now();
      history();
    }
  }
  function accounts(s) {
    accountState = s;
    for (const [p, id] of [
      ['twitch', 'linkTwitch'],
      ['youtube', 'linkYoutube']
    ])
      $(id).textContent =
        (p === 'twitch' ? 'Twitch' : 'YouTube') + (s.accounts[p] ? ' · Connected' : ' · Connect');
    choices();
    availability();
  }
  window.streamStudio = { accounts, availability };
  (async () => {
    try {
      if (!bridge?.studio) {
        say('Stream studio requires the desktop app.');
        return;
      }
      const s = await call('state');
      custom = s.custom;
      customPaint();
      const state = await bridge.platform('state');
      accounts(state);
      const saved = JSON.parse(localStorage.getItem(storage) || 'null');
      if (saved) {
        wanted = new Set(saved.selected || []);
        draftId = saved.id || crypto.randomUUID();
        readyId = saved.readyId || '';
        for (const [k, id] of [
          ['title', 'productionTitle'],
          ['description', 'productionDescription'],
          ['twitchTitle', 'productionTwitchTitle'],
          ['youtubeTitle', 'productionYoutubeTitle'],
          ['youtubeDescription', 'productionYoutubeDescription']
        ])
          $(id).value = saved[k] || '';
        // An empty value would leave the privacy menu with nothing selected.
        if (saved.privacy) $('productionPrivacy').value = saved.privacy;
        $('productionSync').checked = saved.sync !== false;
        $('productionOverrides').hidden = saved.sync !== false;
        $('productionKids').value = saved.audienceSet ? (saved.madeForKids ? 'yes' : 'no') : '';
        for (const input of $('productionDestinations').querySelectorAll('input'))
          input.checked = !input.disabled && saved.selected?.includes(input.value);
      }
      $('productionRecord').checked = false;
    } catch (e) {
      say(e.message);
    } finally {
      availability();
    }
  })();
})();
