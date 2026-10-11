'use strict';
// Go-live announcements (1.2.0), main side. Posts the message the window prepares (announce.js) to a Discord channel
// through a webhook. The webhook link is a secret (anyone with it can post in that channel): it is kept encrypted on
// this PC with the system keychain (safeStorage), never shown again in full, never sent to the window, and only ever
// sent to Discord. Built so more apps (X, Bluesky, Mastodon, Telegram, Zapier/Make webhooks) can be added later.
const fs = require('node:fs'),
  path = require('node:path');

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);
// https://discord.com/api/webhooks/<id>/<token>, optionally ?thread_id=<id> for a forum post or thread.
function discordWebhook(value) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    throw Error(
      'Paste the Discord webhook link (Server Settings → Integrations → Webhooks → Copy Webhook URL).'
    );
  }
  const m = /^\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})\/?$/.exec(u.pathname);
  if (u.protocol !== 'https:' || !DISCORD_HOSTS.has(u.hostname) || u.username || u.password || u.port || !m)
    throw Error('That is not a Discord webhook link. It starts with https://discord.com/api/webhooks/.');
  const thread = u.searchParams.get('thread_id');
  if (thread && !/^\d{5,25}$/.test(thread)) throw Error('The thread in that webhook link is not valid.');
  return {
    url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}`,
    id: m[1],
    thread: thread || ''
  };
}

// Who the post may ping: nobody, @here, @everyone or one role. Discord only pings what allowed_mentions permits, so
// names typed in the message (or a collaborator called "everyone") never ping anyone by accident.
function discordBody(text, ping = {}) {
  const body = String(text || '').trim();
  if (!body) throw Error('The message is empty.');
  let prefix = '',
    allowed = { parse: [] };
  if (ping.kind === 'everyone' || ping.kind === 'here') {
    prefix = '@' + ping.kind + ' ';
    allowed = { parse: ['everyone'] };
  } else if (ping.kind === 'role') {
    if (!/^\d{5,25}$/.test(String(ping.roleId || '')))
      throw Error('Enter the role ID to ping (Discord: Server Settings → Roles → ⋯ → Copy Role ID).');
    prefix = `<@&${ping.roleId}> `;
    allowed = { parse: [], roles: [String(ping.roleId)] };
  }
  return { content: (prefix + body).slice(0, 2000), allowed_mentions: allowed };
}

async function postDiscord(fetch, hook, text, ping) {
  const body = discordBody(text, ping);
  const url = hook.url + '?wait=true' + (hook.thread ? '&thread_id=' + hook.thread : '');
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw Error('Could not reach Discord. Check the internet connection.');
  }
  if (r.ok) return { posted: true };
  if (r.status === 401 || r.status === 404)
    throw Error('Discord says this webhook no longer exists. Make a new one and paste its link again.');
  if (r.status === 429) throw Error('Discord asks to slow down. Try again in a minute.');
  if (r.status === 400) {
    let detail = '';
    try {
      detail = (await r.json())?.message || '';
    } catch {}
    throw Error('Discord did not accept the message' + (detail ? ': ' + detail : '.'));
  }
  throw Error('Discord answered with error ' + r.status + '. Try again later.');
}

exports.discordWebhook = discordWebhook;
exports.discordBody = discordBody;
exports.postDiscord = postDiscord;
exports.start = ({
  app,
  ipcMain,
  guard,
  safeStorage,
  fetch = globalThis.fetch,
  platform = process.platform
}) => {
  const file = path.join(app.getPath('userData'), 'announcements.bin');
  const secure = () =>
    safeStorage.isEncryptionAvailable() &&
    !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
  const load = () => {
    try {
      if (fs.existsSync(file)) return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch {}
    return {};
  };
  const save = data => {
    if (!secure())
      throw Error('This PC cannot store the webhook securely (the system keychain is locked or missing).');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  let data = load();
  // What the window may know: whether Discord is set up, and which webhook (its id), never the link itself.
  const status = () => ({
    discord: data.discord ? { configured: true, id: data.discord.id, thread: !!data.discord.thread } : null
  });
  ipcMain.handle('announce', async (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'status') return { ok: true, data: status() };
      if (input.op === 'save-discord') {
        const hook = discordWebhook(input.webhook);
        save({ ...data, discord: hook });
        data = load();
        return { ok: true, data: status() };
      }
      if (input.op === 'remove-discord') {
        const next = { ...data };
        delete next.discord;
        if (Object.keys(next).length) save(next);
        else fs.rmSync(file, { force: true });
        data = next;
        return { ok: true, data: status() };
      }
      if (input.op === 'post') {
        if (input.app !== 'discord') throw Error('Unknown app.');
        if (!data.discord) throw Error('Set up Discord in Tools → Go-live announcements first.');
        return { ok: true, data: await postDiscord(fetch, data.discord, input.text, input.ping) };
      }
      return { ok: false, error: 'Unknown request.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  return { status };
};
