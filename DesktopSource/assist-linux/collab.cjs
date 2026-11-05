'use strict';
function origin(text) {
  let u;
  try {
    u = new URL(text);
  } catch {
    throw Error('Enter your server address');
  }
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/' ||
    !['https:', 'http:'].includes(u.protocol)
  )
    throw Error('Use an HTTP or HTTPS server address, without a path');
  return u.origin;
}
// HTTP to anything but this computer sends the personal token unencrypted; the UI warns.
function insecure(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}
function entries(data) {
  const result = {};
  for (const p of (data.peers || []).slice(0, 500))
    result['peer:' + p.id] = (p.displayName || p.id) + ': ' + p.state;
  for (const k of ['collaborations', 'requests'])
    for (const p of (data[k] || []).slice(0, 500)) {
      if (p.peer !== data.me?.id && p.owner !== data.me?.id) continue;
      result[k + ':' + p.id] =
        (p.peer === data.me.id ? 'Incoming from ' + p.owner : 'Request to ' + p.peer) + ' · ' + p.status;
    }
  return result;
}
module.exports = { origin, entries, insecure };
