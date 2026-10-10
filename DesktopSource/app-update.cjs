'use strict';
// App updates (1.2.0). Checks the GitHub Releases of the repository named in release-update.json for a newer
// version. A release can carry an app update: update-manifest.json, its Ed25519 signature
// (update-manifest.json.sig) and the zip it names, which holds the app files (resources/app) only. The manifest
// must be signed with the key whose public half is in release-update.json, and the zip must match the manifest's
// size and SHA-256, before anything is installed. The update is installed when UniversalCollab closes (or with
// Restart to update); the files it replaces are kept in resources/app-previous and put back if the new version
// fails to load (start.cjs). Without a public key, or for a release without an app update (a new Electron or OBS),
// the app only says a new version exists and links to its release page.
// Private build files are never replaced by an update and an update may not contain them: release-oauth.json,
// release-update.json, the bundled relay release and compiled programs (.exe).
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  zlib = require('node:zlib');

const MANIFEST = 'update-manifest.json',
  MAX_ZIP = 200 * 1024 * 1024,
  MAX_MANIFEST = 64 * 1024,
  BACKUP = 'app-previous';
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

// Semantic versions: 1.2.0-preview.2 > 1.2.0-preview.1, and 1.2.0 > 1.2.0-preview.9.
function compareVersions(a, b) {
  const x = VERSION.exec(a),
    y = VERSION.exec(b);
  if (!x || !y) throw Error('Invalid version.');
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] > +y[i] ? 1 : -1;
  if (!x[4] || !y[4]) return x[4] === y[4] ? 0 : x[4] ? -1 : 1;
  const p = x[4].split('.'),
    q = y[4].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const n = /^\d+$/.test(p[i]),
      m = /^\d+$/.test(q[i]);
    if (n && m) return +p[i] > +q[i] ? 1 : -1;
    if (n !== m) return n ? -1 : 1;
    return p[i] > q[i] ? 1 : -1;
  }
  return 0;
}

const isProtected = name =>
  name === 'release-oauth.json' ||
  name === 'release-update.json' ||
  name === 'relay-release' ||
  name.startsWith('relay-release/') ||
  /\.exe$/i.test(name);

// Reads a zip (stored or deflated entries, no zip64 or encryption) into [{ name, data }]. Refuses any path that
// could land outside the app folder and any private build file.
function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error('The update is not a zip file.');
  const count = buf.readUInt16LE(end + 10),
    files = [],
    names = new Set();
  let at = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw Error('Damaged update zip.');
    const flags = buf.readUInt16LE(at + 8),
      method = buf.readUInt16LE(at + 10),
      csize = buf.readUInt32LE(at + 20),
      size = buf.readUInt32LE(at + 24),
      nameLen = buf.readUInt16LE(at + 28),
      extraLen = buf.readUInt16LE(at + 30),
      commentLen = buf.readUInt16LE(at + 32),
      local = buf.readUInt32LE(at + 42),
      name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1 || csize === 0xffffffff || size === 0xffffffff || ![0, 8].includes(method))
      throw Error('Unsupported update zip.');
    if (name.endsWith('/')) continue;
    if (
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some(p => !p || p === '.' || p === '..')
    )
      throw Error('Unsafe path in update: ' + name);
    if (isProtected(name)) throw Error('The update may not contain ' + name + '.');
    const key = name.toLowerCase();
    if (names.has(key)) throw Error('Duplicate file in update: ' + name);
    names.add(key);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw Error('Damaged update zip.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28),
      raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: size || 1 });
    if (data.length !== size) throw Error('Damaged update zip.');
    files.push({ name, data });
  }
  return files;
}

function publicKey(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return crypto.createPublicKey({ key: Buffer.from(text.trim(), 'base64'), format: 'der', type: 'spki' });
}

// Checks the signature and contents of update-manifest.json; returns the parsed manifest.
function verifyManifest(bytes, signature, key) {
  if (!key) throw Error('This build has no update key.');
  const sig = Buffer.from(String(signature).trim(), 'base64');
  if (sig.length !== 64 || !crypto.verify(null, bytes, key, sig))
    throw Error('The update is not signed by UniversalCollab.');
  const m = JSON.parse(bytes.toString('utf8'));
  if (
    m?.format !== 1 ||
    m.app !== 'UniversalCollab' ||
    !VERSION.test(m.version) ||
    typeof m.file !== 'string' ||
    !/^[\w.-]+\.zip$/.test(m.file) ||
    !Number.isSafeInteger(m.size) ||
    m.size <= 0 ||
    m.size > MAX_ZIP ||
    !/^[0-9a-f]{64}$/.test(m.sha256) ||
    !Number.isSafeInteger(m.electron)
  )
    throw Error('Invalid update manifest.');
  return m;
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readConfig = appDir => {
  try {
    return JSON.parse(fs.readFileSync(path.join(appDir, 'release-update.json'), 'utf8'));
  } catch {
    return {};
  }
};

// Puts back the files the last update replaced. Used when the updated app fails to load.
function rollback(appDir) {
  const backup = path.join(appDir, '..', BACKUP),
    record = path.join(backup, '.update.json');
  if (!fs.existsSync(record)) return false;
  const { replaced = [], added = [] } = JSON.parse(fs.readFileSync(record, 'utf8'));
  for (const name of added) fs.rmSync(path.join(appDir, name), { force: true });
  for (const name of replaced) {
    fs.mkdirSync(path.dirname(path.join(appDir, name)), { recursive: true });
    fs.copyFileSync(path.join(backup, name), path.join(appDir, name));
  }
  fs.rmSync(backup, { recursive: true, force: true });
  return true;
}

function create({
  appDir,
  userData,
  currentVersion,
  electronVersion,
  fetch: get = globalThis.fetch,
  notify = () => {}
}) {
  const config = readConfig(appDir);
  const repo = /^[\w.-]+\/[\w.-]+$/.test(config.repo || '') ? config.repo : '';
  const channel = config.channel === 'stable' ? 'stable' : 'preview';
  let key = null;
  try {
    key = publicKey(config.publicKey);
  } catch {}
  const stage = path.join(userData, 'app-update'),
    settingsFile = path.join(userData, 'app-update.json');
  let settings = { auto: true };
  try {
    settings = { auto: JSON.parse(fs.readFileSync(settingsFile, 'utf8')).auto !== false };
  } catch {}
  let state = { state: 'idle' };
  let busy = null;

  // A staged update survives a restart until it is installed.
  function staged() {
    try {
      const bytes = fs.readFileSync(path.join(stage, MANIFEST));
      const m = verifyManifest(bytes, fs.readFileSync(path.join(stage, MANIFEST + '.sig'), 'utf8'), key);
      if (compareVersions(m.version, currentVersion) <= 0) return null;
      return m;
    } catch {
      return null;
    }
  }
  {
    const m = staged();
    if (m) state = { state: 'ready', latest: { version: m.version, notes: m.notes || '' } };
  }
  const status = () => ({
    version: currentVersion,
    repo,
    channel,
    signed: !!key,
    auto: settings.auto,
    ...state
  });
  const set = next => {
    state = next;
    notify(status());
  };

  async function fetchBytes(url, limit, accept) {
    const r = await get(url, {
      headers: { 'User-Agent': 'UniversalCollab', Accept: accept || 'application/octet-stream' },
      redirect: 'follow'
    });
    if (!r.ok) throw Error('Download failed (' + r.status + ').');
    const length = +r.headers?.get?.('content-length');
    if (length > limit) throw Error('The update is too large.');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > limit) throw Error('The update is too large.');
    return buf;
  }
  const assetUrl = url => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com') throw Error('Unexpected download address.');
    return u.href;
  };

  async function check() {
    if (!repo) throw Error('Updates are not set up in this build.');
    const list = JSON.parse(
      (
        await fetchBytes(
          `https://api.github.com/repos/${repo}/releases?per_page=20`,
          4 * 1024 * 1024,
          'application/vnd.github+json'
        )
      ).toString('utf8')
    );
    let best = null;
    for (const r of Array.isArray(list) ? list : []) {
      // Tags are read without regard to case or a leading "v": 1.2.0-Preview.4 and v1.2.0-preview.4 both mean
      // 1.2.0-preview.4 (a capital P would otherwise sort before every lowercase preview).
      const version = String(r?.tag_name || '')
        .trim()
        .replace(/^v/i, '')
        .toLowerCase();
      if (r.draft || (r.prerelease && channel === 'stable') || !VERSION.test(version)) continue;
      if (!best || compareVersions(version, best.version) > 0) best = { version, release: r };
    }
    if (!best || compareVersions(best.version, currentVersion) <= 0)
      return set({ state: 'latest', checked: Date.now() });
    const r = best.release;
    const page = /^https:\/\/github\.com\//.test(r.html_url || '') ? r.html_url : '';
    const latest = { version: best.version, notes: String(r.body || '').slice(0, 2000), page };
    const ready = staged();
    if (ready && ready.version.toLowerCase() === best.version) return set({ state: 'ready', latest });
    const asset = name => (r.assets || []).find(a => a?.name === name)?.browser_download_url;
    if (!asset(MANIFEST) || !asset(MANIFEST + '.sig'))
      return set({
        state: 'installer',
        latest,
        message: 'This version needs the full installer (it updates Electron or OBS too).'
      });
    if (!key) return set({ state: 'available', latest, message: 'Download it from the release page.' });
    set({ state: 'downloading', latest });
    const bytes = await fetchBytes(assetUrl(asset(MANIFEST)), MAX_MANIFEST);
    const sig = (await fetchBytes(assetUrl(asset(MANIFEST + '.sig')), 1024)).toString('utf8');
    const m = verifyManifest(bytes, sig, key);
    if (m.version.toLowerCase() !== best.version) throw Error('The update does not match its release.');
    if (m.electron > parseInt(electronVersion, 10))
      return set({
        state: 'installer',
        latest,
        message: 'This version needs the full installer (it needs a newer Electron).'
      });
    if (!asset(m.file)) throw Error('The release is missing ' + m.file + '.');
    const zip = await fetchBytes(assetUrl(asset(m.file)), m.size);
    if (zip.length !== m.size || sha256(zip) !== m.sha256) throw Error('The download is damaged.');
    readZip(zip);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'update.zip'), zip);
    fs.writeFileSync(path.join(stage, MANIFEST + '.sig'), sig);
    // Written last: a manifest in the folder means the update is complete.
    fs.writeFileSync(path.join(stage, MANIFEST), bytes);
    return set({ state: 'ready', latest: { ...latest, notes: latest.notes || m.notes || '' } });
  }

  return {
    status,
    check() {
      busy ||= (async () => {
        const before = state;
        if (before.state !== 'ready') set({ ...before, state: 'checking' });
        try {
          await check();
        } catch (e) {
          set({ ...before, state: before.state === 'ready' ? 'ready' : 'error', error: e.message });
        }
        busy = null;
        return status();
      })();
      return busy;
    },
    setAuto(on) {
      if (typeof on !== 'boolean') throw Error('Invalid setting.');
      settings.auto = on;
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings));
      return status();
    },
    // Installs a staged update into the app folder. Runs while the app is closing, so it is synchronous.
    apply() {
      const m = staged();
      if (!m) return null;
      const zip = fs.readFileSync(path.join(stage, 'update.zip'));
      if (zip.length !== m.size || sha256(zip) !== m.sha256) {
        fs.rmSync(stage, { recursive: true, force: true });
        throw Error('The staged update is damaged.');
      }
      const files = readZip(zip),
        backup = path.join(appDir, '..', BACKUP),
        replaced = [],
        added = [];
      fs.rmSync(backup, { recursive: true, force: true });
      fs.mkdirSync(backup, { recursive: true });
      for (const { name } of files) {
        const dest = path.join(appDir, name);
        if (fs.existsSync(dest)) {
          fs.mkdirSync(path.dirname(path.join(backup, name)), { recursive: true });
          fs.copyFileSync(dest, path.join(backup, name));
          replaced.push(name);
        } else added.push(name);
      }
      fs.writeFileSync(
        path.join(backup, '.update.json'),
        JSON.stringify({ from: currentVersion, to: m.version, replaced, added })
      );
      try {
        for (const { name, data } of files) {
          const dest = path.join(appDir, name);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, data);
        }
      } catch (e) {
        rollback(appDir);
        throw e;
      }
      fs.rmSync(stage, { recursive: true, force: true });
      return m.version;
    }
  };
}

module.exports = { create, compareVersions, readZip, verifyManifest, rollback, isProtected, MANIFEST };
