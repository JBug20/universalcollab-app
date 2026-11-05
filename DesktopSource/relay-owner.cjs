'use strict';
// Relay ownership from the desktop app. When you claim a relay, this PC creates an Ed25519 key
// pair; the private key never leaves this PC (stored encrypted with the OS account). Owner
// requests are signed with it, so owner tools and relay updates work over plain http:// without
// anyone who sees the traffic being able to forge or replay them.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { generateKeyPairSync, createPrivateKey, createHash, sign, randomBytes } = require('node:crypto');
const sha = data => createHash('sha256').update(data).digest('hex');
const keyId = publicKey => sha(Buffer.from(publicKey, 'base64')).slice(0, 24);
const signedMessage = ({ method, url, time, nonce, body }) =>
  ['UCOWNER1', method, url, String(time), nonce, sha(body || Buffer.alloc(0))].join('\n');

class OwnerKeys {
  constructor({ directory, safeStorage }) {
    this.file = path.join(directory, 'owner-keys.bin');
    this.safeStorage = safeStorage;
  }
  secure() {
    return (
      this.safeStorage.isEncryptionAvailable() &&
      !(process.platform === 'linux' && this.safeStorage.getSelectedStorageBackend?.() === 'basic_text')
    );
  }
  read() {
    try {
      return JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
    } catch {
      return {};
    }
  }
  write(value) {
    if (!this.secure()) throw Error('Unlock your desktop keyring to store the relay owner key securely.');
    fs.writeFileSync(this.file + '.tmp', this.safeStorage.encryptString(JSON.stringify(value)), {
      mode: 0o600
    });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  slot(origin, userId) {
    return origin + '|' + userId;
  }
  get(origin, userId) {
    return this.read()[this.slot(origin, userId)] || null;
  }
  // Creates (or reuses) the key for this relay account; saved before the claim is sent.
  ensure(origin, userId) {
    const all = this.read(),
      slot = this.slot(origin, userId);
    if (all[slot]) return all[slot];
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    all[slot] = {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      createdAt: Date.now()
    };
    this.write(all);
    return all[slot];
  }
  headers(entry, { method, url, body }) {
    const time = Date.now(),
      nonce = randomBytes(18).toString('base64url');
    const key = createPrivateKey({
      key: Buffer.from(entry.privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8'
    });
    return {
      'x-uc-owner-key': keyId(entry.publicKey),
      'x-uc-time': String(time),
      'x-uc-nonce': nonce,
      'x-uc-signature': sign(
        null,
        Buffer.from(signedMessage({ method, url, time, nonce, body: Buffer.from(body || '') })),
        key
      ).toString('base64')
    };
  }
}

// The relay release bundled with this app (built by tools/make-relay-release.mjs).
function bundledRelease(appDir) {
  const dir = path.join(appDir, 'relay-release');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (
    typeof manifest.version !== 'string' ||
    !/^[a-f0-9]{16,64}$/.test(manifest.build || '') ||
    !Array.isArray(manifest.files)
  )
    return null;
  return { dir, version: manifest.version, build: manifest.build, files: manifest.files };
}
function releaseBody(release) {
  const files = release.files.map(f => {
    if (
      !/^(index\.js|relay-main\.js|install\.mjs|release\.json|src\/[A-Za-z0-9_-]+\.(?:mjs|js|css|html))$/.test(
        f.path
      )
    )
      throw Error('The bundled relay release is invalid.');
    const data = fs.readFileSync(path.join(release.dir, f.path));
    if (sha(data) !== f.sha256) throw Error('The bundled relay release is damaged. Reinstall the app.');
    return { path: f.path, sha256: f.sha256, data: data.toString('base64') };
  });
  return JSON.stringify({ release: { version: release.version, build: release.build, files } });
}
const label = () => (os.hostname() || 'Desktop app').replace(/[^\w .-]/g, '').slice(0, 60) || 'Desktop app';
// Adds the owner signature to relay requests (and the public key to a claim). Returns the body
// to send and extra headers; {error} when the key cannot be stored.
function prepareOwnerRequest(ownerKeys, { origin, route, token, body, input }) {
  const userId = (token || '').split(':')[0];
  if (!route.startsWith('/api/v3/host-') || !userId) return { body, headers: {} };
  let entry = ownerKeys.get(origin, userId);
  if (route === '/api/v3/host-claim-device') {
    const code = input?.code;
    if (code !== undefined && (typeof code !== 'string' || code.length > 200))
      throw Error('Invalid setup code.');
    try {
      entry = ownerKeys.ensure(origin, userId);
    } catch (e) {
      return { error: e.message };
    }
    body = JSON.stringify({ ...(code ? { code } : {}), publicKey: entry.publicKey, label: label() });
  }
  return {
    body,
    headers: entry
      ? ownerKeys.headers(entry, { method: body === undefined ? 'GET' : 'POST', url: route, body })
      : {}
  };
}
const UPDATE_REASONS = {
  UPDATE_BUSY: 'A relay update is already running.',
  UPDATE_LIVE: 'End all broadcasts on this relay before updating it.',
  UPDATE_UNSUPPORTED: 'This relay cannot update itself yet. Upload the update files to the server once.',
  UPDATE_REJECTED: 'The relay rejected the update files and kept its current version.',
  OWNER_CLOCK: 'Your PC clock is more than 5 minutes off. Correct the time and try again.',
  OWNER_SIGNATURE: 'The relay did not accept this PC as its owner.',
  HOST_HTTPS: 'The relay did not accept this PC as its owner.',
  HOST_ONLY: 'Sign in with the relay owner account.'
};
async function installRelease(ownerKeys, { appDir, origin, token, fetchImpl = fetch }) {
  const release = bundledRelease(appDir);
  if (!release) return { ok: false, error: 'This app does not include a relay update.' };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{24,64}$/.test(token))
    return { ok: false, error: 'Connect to the relay first.' };
  const entry = ownerKeys.get(origin, token.split(':')[0]);
  if (!entry)
    return { ok: false, error: 'Claim this relay from this PC first. Only the owner app can update it.' };
  let body;
  try {
    body = releaseBody(release);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  let response;
  try {
    response = await fetchImpl(origin + '/api/v3/host-update', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...ownerKeys.headers(entry, { method: 'POST', url: '/api/v3/host-update', body })
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(120000)
    });
  } catch {
    return { ok: false, error: 'Could not reach the relay to update it.' };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    return { ok: false, error: UPDATE_REASONS[data.reason] || 'The relay could not install the update.' };
  return {
    ok: true,
    data: { restarting: !!data.restarting, version: release.version, build: release.build }
  };
}
module.exports = {
  OwnerKeys,
  bundledRelease,
  releaseBody,
  label,
  keyId,
  prepareOwnerRequest,
  installRelease
};
