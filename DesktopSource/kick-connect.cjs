const crypto = require('node:crypto');
const origin = 'https://assist-beta.universalcollab.stream';
exports.connectKick = async openExternal => {
  const verifier = crypto.randomBytes(32).toString('base64url'),
    challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const request = async (path, data) => {
    const r = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
    if (r.status === 428) return null;
    const value = await r.json();
    if (!r.ok) throw Error(value.error || 'Kick connection failed.');
    return value;
  };
  const start = await request('/v1/collab/kick/start', { challenge });
  const url = new URL(start.url);
  if (url.origin !== 'https://id.kick.com') throw Error('Invalid Kick approval address.');
  await openExternal(url.href);
  try {
    const until = Date.now() + 600000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 3000));
      const result = await request('/v1/collab/kick/token', { request_id: start.request_id, verifier });
      if (result) return result;
    }
    throw Error('Kick sign-in timed out.');
  } finally {
    request('/v1/collab/kick/cancel', { request_id: start.request_id, verifier }).catch(() => {});
  }
};
