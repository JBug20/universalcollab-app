'use strict';
function bttv(data) {
  const result = {};
  const entries = Array.isArray(data)
    ? data
    : [...(data?.channelEmotes || []), ...(data?.sharedEmotes || [])];
  for (const e of entries.slice(0, 3000))
    if (typeof e.code === 'string' && e.code.length <= 100 && /^[a-f0-9]{24}$/.test(e.id) && !e.modifier)
      result[e.code] = 'https://cdn.betterttv.net/emote/' + e.id + '/2x';
  return result;
}
function ffz(data) {
  const result = {};
  for (const [id, s] of Object.entries(data?.sets || {})) {
    if (data.default_sets && !data.default_sets.map(String).includes(id)) continue;
    for (const e of (s.emoticons || []).slice(0, 3000)) {
      let url = e.animated?.['2'] || e.urls?.['2'] || e.urls?.['1'];
      if (url?.startsWith('//')) url = 'https:' + url;
      try {
        const u = new URL(url);
        if (
          u.protocol === 'https:' &&
          u.hostname === 'cdn.frankerfacez.com' &&
          !u.username &&
          !u.password &&
          !u.port &&
          typeof e.name === 'string' &&
          e.name.length <= 100
        )
          result[e.name] = url;
      } catch {}
    }
  }
  return result;
}
async function load(user, request, signal) {
  let result = {};
  const sources = [
    ['https://api.frankerfacez.com/v1/set/global', ffz],
    ['https://api.betterttv.net/3/cached/emotes/global', bttv]
  ];
  if (/^\d+$/.test(user))
    sources.push(
      ['https://api.frankerfacez.com/v1/room/id/' + user, ffz],
      ['https://api.betterttv.net/3/cached/users/twitch/' + user, bttv]
    );
  for (const [url, parse] of sources)
    try {
      Object.assign(result, parse(await request(url, { signal })));
    } catch {}
  return result;
}
module.exports = { bttv, ffz, load };
