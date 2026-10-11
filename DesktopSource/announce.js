'use strict';
// Go-live announcements (1.2.0), window side. When a relay broadcast starts, a message made from your template
// ({title}, {game}, {links}, {platforms}, {collaborators}) is posted to Discord (announce.cjs posts it), once per
// broadcast. By default a preview asks first, where the text can be changed or the post skipped. An optional
// "stream ended" post goes out when the broadcast ends. Tools → Go-live announcements has the settings.
(() => {
  const PLATFORMS = [
    ['twitch', 'Twitch'],
    ['youtube', 'YouTube'],
    ['kick', 'Kick']
  ];
  const DEFAULTS = {
    enabled: true,
    ask: true,
    live: '🔴 Live now: {title}{game}{collaborators}! Watch on {links}',
    endEnabled: false,
    end: 'Stream over, thanks for watching! 💜',
    ping: 'none',
    roleId: '',
    links: { twitch: '', youtube: '', kick: '' }
  };
  // Which platform an output (destination) is, from its id or name.
  const platformOf = o =>
    PLATFORMS.find(([id]) => new RegExp(id, 'i').test(`${o?.id} ${o?.name}`))?.[0] || '';
  // The text of a post: the template with its {placeholders} filled. Empty parts leave no gaps behind.
  function fill(template, d = {}) {
    const names = (d.collaborators || []).filter(Boolean);
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0] || '';
    const values = {
      title: d.title || 'the stream',
      game: d.game ? ' (' + d.game + ')' : '',
      collaborators: list ? ' with ' + list : '',
      platforms: (d.platforms || []).join(', '),
      links: (d.links || []).join(' · ') || (d.platforms || []).join(', ') || 'my channels'
    };
    return String(template || '')
      .replace(/\{(title|game|collaborators|platforms|links)\}/g, (m, k) => values[k])
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  // Platforms and links for this broadcast: the destinations being sent to, each with your channel link.
  function destinations(outputs, links = {}) {
    const seen = new Set(),
      platforms = [],
      list = [];
    for (const o of outputs || []) {
      const id = platformOf(o);
      const name = id ? PLATFORMS.find(p => p[0] === id)[1] : String(o?.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      platforms.push(name);
      // A platform without a saved link is still named, so viewers know where else to look.
      list.push(id && links[id] ? links[id] : name);
    }
    return { platforms, links: list };
  }
  // Once per broadcast: 'live' when it starts, 'end' when it ends. `was` is null until the first reading, so an
  // app started during a broadcast does not post.
  function step(was, live) {
    if (was === false && live) return 'live';
    if (was === true && !live) return 'end';
    return null;
  }
  const api = { DEFAULTS, fill, destinations, step, platformOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.goLiveAnnouncements = api;

  (async () => {
    await window.portalReady;
    if (!window.workspaceUI)
      await new Promise(r => window.addEventListener('studio-ready', r, { once: true }));
    const bridge = window.relayDesktop;
    if (!bridge?.announce) return;
    const $ = id => document.getElementById(id);
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const KEY = 'uc-announce';
    let settings;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      settings = { ...DEFAULTS, ...saved, links: { ...DEFAULTS.links, ...(saved.links || {}) } };
    } catch {
      settings = { ...DEFAULTS, links: { ...DEFAULTS.links } };
    }
    const persist = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {}
    };
    let discord = null;
    const refresh = async () => {
      const r = await bridge.announce({ op: 'status' }).catch(() => null);
      discord = r?.ok ? r.data.discord : null;
      paint();
    };
    const ping = () => ({ kind: settings.ping, roleId: settings.roleId });

    // What this broadcast is: from Create & prepare and the relay.
    function details() {
      const text = id => ($(id)?.value || '').trim();
      const game = $('productionGame')?.selectedOptions?.[0];
      const me = view?.me?.settings || {};
      const collaborators = (me.overlays || [])
        .map(o => o?.publisher)
        .filter(Boolean)
        .map(id => view?.peers?.find(p => p.id === id)?.displayName || id);
      return {
        title: text('productionTitle'),
        game: game && game.value ? game.textContent.trim() : '',
        collaborators: [...new Set(collaborators)],
        ...destinations(view?.status?.outputs || [], settings.links)
      };
    }
    const message = kind => fill(kind === 'end' ? settings.end : settings.live, details());

    async function post(text) {
      const r = await bridge.announce({ op: 'post', app: 'discord', text, ping: ping() });
      if (!r?.ok) throw Error(r?.error || 'Could not post to Discord.');
    }
    async function announce(kind) {
      if (!settings.enabled || !discord) return;
      if (kind === 'end' && !settings.endEnabled) return;
      const text = message(kind);
      if (settings.ask) return ask(kind, text);
      try {
        await post(text);
        note('Posted to Discord.');
      } catch (e) {
        note('Discord announcement failed: ' + e.message);
      }
    }

    // ---- The ask-first preview ----
    const preview = el('dialog');
    preview.id = 'announcePreview';
    preview.setAttribute('aria-label', 'Announce on Discord');
    const previewTitle = el('h2');
    const previewText = el('textarea');
    previewText.id = 'announcePreviewText';
    previewText.rows = 5;
    previewText.maxLength = 1900;
    const previewStatus = el('p', null, 'hint');
    previewStatus.setAttribute('role', 'status');
    const postNow = el('button', 'Post to Discord'),
      skip = el('button', 'Skip');
    postNow.type = skip.type = 'button';
    postNow.id = 'announcePost';
    skip.id = 'announceSkip';
    const previewRow = el('div', null, 'assist-actions');
    previewRow.append(skip, postNow);
    preview.append(previewTitle, previewText, previewStatus, previewRow);
    document.body.append(preview);
    function ask(kind, text) {
      previewTitle.textContent =
        kind === 'end' ? 'Stream ended: post on Discord?' : 'You are live: post on Discord?';
      previewText.value = text;
      previewStatus.textContent =
        settings.ping === 'none' ? 'Nobody is pinged.' : 'Pings ' + pingLabel() + '.';
      postNow.disabled = false;
      if (!preview.open) preview.showModal();
      previewText.focus();
    }
    postNow.onclick = async () => {
      postNow.disabled = true;
      previewStatus.textContent = 'Posting…';
      try {
        await post(previewText.value);
        preview.close();
        note('Posted to Discord.');
      } catch (e) {
        previewStatus.textContent = e.message;
        postNow.disabled = false;
      }
    };
    skip.onclick = () => {
      preview.close();
      note('Discord announcement skipped.');
    };

    // Broadcast start and end.
    let was = null;
    setInterval(() => {
      if (!connected || uncertain) return;
      const live = !!view?.status?.broadcast;
      const kind = step(was, live);
      was = live;
      if (kind) void announce(kind);
    }, 1000);

    // ---- Tools → Go-live announcements ----
    const dialog = el('dialog');
    dialog.id = 'announceWindow';
    dialog.setAttribute('aria-label', 'Go-live announcements');
    const field = (label, input) => {
      const l = el('label', label);
      l.append(input);
      return l;
    };
    const check = (id, text) => {
      const i = el('input');
      i.type = 'checkbox';
      i.id = id;
      const l = el('label', ' ' + text, 'check-row');
      l.prepend(i);
      return [i, l];
    };
    const btn = (text, fn, id) => {
      const b = el('button', text);
      b.type = 'button';
      if (id) b.id = id;
      b.onclick = fn;
      return b;
    };
    const status = el('p', null, 'hint');
    status.id = 'announceStatus';
    status.setAttribute('role', 'status');
    const say = (text, bad = false) => {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    };

    // Discord connection.
    const discordState = el('p');
    discordState.id = 'announceDiscordState';
    const webhook = el('input');
    webhook.id = 'announceWebhook';
    webhook.type = 'password';
    webhook.autocomplete = 'off';
    webhook.spellcheck = false;
    webhook.placeholder = 'https://discord.com/api/webhooks/…';
    const saveHook = btn(
      'Save webhook',
      async () => {
        const r = await bridge.announce({ op: 'save-discord', webhook: webhook.value });
        if (!r?.ok) return say(r?.error || 'Could not save the webhook.', true);
        webhook.value = '';
        discord = r.data.discord;
        paint();
        say('Discord webhook saved. Send a test post to check it.');
      },
      'announceSaveWebhook'
    );
    const removeHook = btn(
      'Remove',
      async () => {
        if (!confirm('Remove the Discord webhook from this PC?')) return;
        const r = await bridge.announce({ op: 'remove-discord' });
        discord = r?.ok ? r.data.discord : discord;
        paint();
        say('Discord webhook removed.');
      },
      'announceRemoveWebhook'
    );
    const test = btn(
      'Send test post',
      async () => {
        say('Posting a test…');
        try {
          await post(
            'Test from UniversalCollab: go-live announcements work. Next time you go live:\n\n' +
              message('live')
          );
          say('Test posted. Check your Discord channel.');
        } catch (e) {
          say(e.message, true);
        }
      },
      'announceTest'
    );
    const hookRow = el('div', null, 'assist-actions');
    hookRow.append(saveHook, removeHook, test);

    // Posting.
    const [enabled, enabledLabel] = check('announceEnabled', 'Announce when a relay broadcast starts');
    const [askFirst, askLabel] = check(
      'announceAsk',
      'Ask before posting (shows the message to edit or skip)'
    );
    const live = el('textarea');
    live.id = 'announceLiveText';
    live.rows = 3;
    live.maxLength = 1500;
    const [endEnabled, endLabel] = check('announceEndEnabled', 'Also post when the broadcast ends');
    const end = el('textarea');
    end.id = 'announceEndText';
    end.rows = 2;
    end.maxLength = 1500;
    const pingSelect = el('select');
    pingSelect.id = 'announcePing';
    for (const [v, t] of [
      ['none', 'Nobody'],
      ['here', '@here (people online)'],
      ['everyone', '@everyone'],
      ['role', 'A role…']
    ])
      pingSelect.add(new Option(t, v));
    const roleId = el('input');
    roleId.id = 'announceRoleId';
    roleId.inputMode = 'numeric';
    roleId.placeholder = 'Role ID, e.g. 123456789012345678';
    const roleLabel = field('Role ID', roleId);
    const pingLabel = () => (settings.ping === 'role' ? 'the role ' + settings.roleId : '@' + settings.ping);

    // Channel links for {links}.
    const linkInputs = {};
    const linkFields = PLATFORMS.map(([id, name]) => {
      const i = el('input');
      i.id = 'announceLink-' + id;
      i.type = 'url';
      i.maxLength = 300;
      i.placeholder =
        id === 'twitch'
          ? 'https://twitch.tv/yourname'
          : id === 'youtube'
            ? 'https://youtube.com/@yourname/live'
            : 'https://kick.com/yourname';
      linkInputs[id] = i;
      return field(name + ' link', i);
    });
    const sample = el('p', null, 'hint');
    sample.id = 'announceSample';

    function paint() {
      discordState.textContent = discord
        ? 'Discord: connected (webhook …' +
          discord.id.slice(-4) +
          (discord.thread ? ', posts in a thread' : '') +
          ').'
        : 'Discord: not set up. In Discord: Server Settings → Integrations → Webhooks → New Webhook → choose the channel → Copy Webhook URL, then paste it here.';
      removeHook.hidden = test.hidden = !discord;
      saveHook.textContent = discord ? 'Replace webhook' : 'Save webhook';
      roleLabel.hidden = settings.ping !== 'role';
      end.disabled = !settings.endEnabled;
      sample.textContent = 'Preview: ' + message('live');
    }
    function fillForm() {
      enabled.checked = settings.enabled;
      askFirst.checked = settings.ask;
      live.value = settings.live;
      endEnabled.checked = settings.endEnabled;
      end.value = settings.end;
      pingSelect.value = settings.ping;
      roleId.value = settings.roleId;
      for (const [id] of PLATFORMS) linkInputs[id].value = settings.links[id] || '';
    }
    function readForm() {
      const links = {};
      for (const [id] of PLATFORMS) {
        const v = linkInputs[id].value.trim();
        links[id] = /^https:\/\/\S+$/i.test(v) ? v : '';
      }
      settings = {
        ...settings,
        enabled: enabled.checked,
        ask: askFirst.checked,
        live: live.value.trim() || DEFAULTS.live,
        endEnabled: endEnabled.checked,
        end: end.value.trim() || DEFAULTS.end,
        ping: pingSelect.value,
        roleId: roleId.value.replace(/\D/g, ''),
        links
      };
      persist();
      paint();
    }
    for (const i of [
      enabled,
      askFirst,
      live,
      endEnabled,
      end,
      pingSelect,
      roleId,
      ...Object.values(linkInputs)
    ])
      i.addEventListener('change', readForm);
    live.addEventListener('input', readForm);

    dialog.append(
      el('h2', 'Go-live announcements'),
      el(
        'p',
        'Post to your Discord when you go live. More apps (X, Bluesky, Mastodon, Telegram) can be added later.',
        'hint'
      ),
      el('h3', 'Discord'),
      discordState,
      field('Webhook link', webhook),
      hookRow,
      el('h3', 'Message'),
      enabledLabel,
      askLabel,
      field('When you go live', live),
      el(
        'p',
        '{title} stream title · {game} game or category · {collaborators} who is in your layout · {links} your channel links for the platforms you stream to · {platforms} their names',
        'hint'
      ),
      sample,
      field('Ping', pingSelect),
      roleLabel,
      endLabel,
      field('When the broadcast ends', end),
      el('h3', 'Your channel links'),
      ...linkFields,
      status,
      el(
        'p',
        'The webhook link is saved encrypted on this PC and only sent to Discord. Anyone with it can post in that channel, so do not share it.',
        'hint'
      )
    );
    const bottom = el('div', null, 'assist-actions');
    bottom.append(btn('Close', () => dialog.close()));
    dialog.append(bottom);
    document.body.append(dialog);
    window.openAnnouncements = async () => {
      fillForm();
      say('');
      await refresh();
      if (!dialog.open) dialog.showModal();
    };
    window.announceNow = announce;
    await refresh();
  })().catch(() => {});
})();
