'use strict';
const crypto = require('node:crypto');
const ORIGIN = 'https://assist-beta.universalcollab.stream';
// The Twitch client ID comes from the app's release-oauth.json, which stays blank in git; the owner fills it in
// for local release builds. Without it, Twitch sign-in reports that the build is not configured.
const TWITCH = (() => {
  try {
    const id = require('../release-oauth.json').twitch?.clientId;
    return typeof id === 'string' && /^[a-z0-9]{20,40}$/.test(id) ? id : '';
  } catch {
    return '';
  }
})();
// Requested at sign-in (includes chat sending). Alerts only need REQUIRED_SCOPES, so earlier sign-ins keep working.
const SCOPES = 'moderator:read:followers channel:read:subscriptions bits:read user:read:chat user:write:chat';
const REQUIRED_SCOPES = 'moderator:read:followers channel:read:subscriptions bits:read user:read:chat';
const random = () => crypto.randomBytes(32).toString('hex');
const challenge = x => crypto.createHash('sha256').update(x).digest('base64url');
const sleep = (ms, signal) => require('node:timers/promises').setTimeout(ms, undefined, { signal });
async function request(url, { signal, token, form, json, headers = {}, method, ...rest } = {}) {
  const r = await fetch(url, {
    ...rest,
    redirect: 'error',
    method: method || (form || json ? 'POST' : 'GET'),
    headers: {
      ...headers,
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(form
        ? { 'content-type': 'application/x-www-form-urlencoded' }
        : json
          ? { 'content-type': 'application/json' }
          : {})
    },
    body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  });
  const data = await r.json();
  if (!r.ok) {
    const code = data.error?.errors?.[0]?.reason || data.error || data.message || 'request_failed';
    const e = new Error('Service request failed (HTTP ' + r.status + ').');
    e.status = r.status;
    e.code = typeof code === 'string' ? code : 'request_failed';
    throw e;
  }
  return data;
}
function make(platform, kind, name, detail, time) {
  return {
    id: random(),
    platform,
    kind,
    name: name || 'Anonymous',
    detail: String(detail || ''),
    time: time || new Date().toISOString()
  };
}
function chat(platform, name, detail, time, emotes = {}) {
  return { ...make(platform, 'Chat', name, String(detail || '').slice(0, 4000), time), emotes };
}
function kick(e) {
  if (e.type === 'chat.message.sent') {
    const d = e.data || {},
      emotes = {};
    const text = String(d.content || '').replace(/\[emote:(\d+):([^\]\r\n]+)\]/g, (_, id, name) => {
      emotes[name] = 'https://files.kick.com/emotes/' + id + '/fullsize';
      return ' ' + name + ' ';
    });
    return chat('Kick', d.sender?.username, text, d.created_at || e.time, emotes);
  }
  const d = e.data || {},
    kind = {
      'channel.followed': 'Follow',
      'channel.subscription.new': 'Subscription',
      'channel.subscription.renewal': 'Resubscription',
      'channel.subscription.gifts': 'GiftSubscription',
      'kicks.gifted': 'KicksGifted'
    }[e.type];
  if (!kind) return null;
  return make(
    'Kick',
    kind,
    (d.follower || d.subscriber || d.gifter || d.sender || {}).username,
    d.gift?.message ||
      d.message ||
      (d.giftees
        ? d.giftees.length + ' gifted subscriptions'
        : d.gift?.amount
          ? d.gift.amount + ' Kicks'
          : kind),
    e.time
  );
}
function twitch(m) {
  if (m.metadata?.subscription_type === 'channel.chat.message') {
    const e = m.payload?.event || {},
      emotes = {};
    for (const f of e.message?.fragments || [])
      if (/^(?:[0-9]+|emotesv2_[a-fA-F0-9]+)$/.test(f.emote?.id || ''))
        emotes[f.text] = 'https://static-cdn.jtvnw.net/emoticons/v2/' + f.emote.id + '/default/dark/2.0';
    return chat(
      'Twitch',
      e.chatter_user_name || e.chatter_user_login,
      e.message?.text,
      m.metadata?.message_timestamp,
      emotes
    );
  }
  const e = m.payload?.event || {},
    type = m.metadata?.subscription_type;
  const kind = {
    'channel.follow': 'Follow',
    'channel.subscribe': 'Subscription',
    'channel.subscription.gift': 'GiftSubscription',
    'channel.subscription.message': 'Resubscription',
    'channel.cheer': 'Cheer',
    'channel.raid': 'Raid'
  }[type];
  if (!kind || (type === 'channel.subscribe' && e.is_gift)) return null;
  return make(
    'Twitch',
    kind,
    e.user_name || e.from_broadcaster_user_name,
    e.message?.text ||
      e.message ||
      (e.bits
        ? e.bits + ' bits'
        : e.total
          ? e.total + ' gifted subscriptions'
          : e.viewers
            ? e.viewers + ' viewers'
            : kind),
    m.metadata?.message_timestamp
  );
}
function youtube(item) {
  if (item.snippet?.type === 'textMessageEvent')
    return chat(
      'YouTube',
      item.authorDetails?.displayName,
      item.snippet.textMessageDetails?.messageText || item.snippet.displayMessage,
      item.snippet.publishedAt
    );
  const s = item.snippet || {},
    kind = {
      superChatEvent: 'SuperChat',
      superStickerEvent: 'SuperSticker',
      newSponsorEvent: 'NewSponsor',
      memberMilestoneChatEvent: 'MemberMileStone',
      membershipGiftingEvent: 'MembershipGift'
    }[s.type];
  if (!kind) return null;
  const d =
    s.superChatDetails ||
    s.superStickerDetails ||
    s.newSponsorDetails ||
    s.memberMilestoneChatDetails ||
    s.membershipGiftingDetails ||
    {};
  return make(
    'YouTube',
    kind,
    item.authorDetails?.displayName,
    [
      d.amountDisplayString,
      d.userComment,
      d.memberLevelName,
      d.superStickerMetadata?.altText,
      d.giftMembershipsCount ? d.giftMembershipsCount + ' memberships' : ''
    ]
      .filter(Boolean)
      .join(' '),
    s.publishedAt
  );
}
function safeBrowser(url, host) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password)
    throw Error('Invalid sign-in destination.');
  return u.href;
}
module.exports = {
  ORIGIN,
  TWITCH,
  SCOPES,
  REQUIRED_SCOPES,
  random,
  challenge,
  sleep,
  request,
  make,
  kick,
  twitch,
  youtube,
  safeBrowser
};
