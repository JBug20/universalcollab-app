// Builds a signed app update for a GitHub release (app-update.cjs).
//   node build/make-app-update.mjs --key <update-signing-key.pem> --out <folder> [--app <app folder>] [--notes <file>]
// --app defaults to DesktopSource. Writes UniversalCollab-app-<version>.zip, update-manifest.json and
// update-manifest.json.sig; attach all three to the GitHub release whose tag is the version (e.g. 1.2.0-preview.2).
// The zip holds the app files only. Private build files (release-oauth.json, release-update.json, the relay release,
// compiled programs) are left out, so installed copies keep their own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isProtected, readZip, verifyManifest, MANIFEST } = require('../DesktopSource/app-update.cjs');
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// Not part of the installed app.
const SKIP = new Set(['windows-installer.nsi', 'linux-install.sh']);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function appFiles(app) {
  const out = [];
  const walk = rel => {
    for (const d of fs.readdirSync(path.join(app, rel), { withFileTypes: true })) {
      const name = rel ? rel + '/' + d.name : d.name;
      if (d.name.startsWith('.') || isProtected(name) || (!rel && SKIP.has(d.name))) continue;
      if (d.isDirectory()) walk(name);
      else if (d.isFile()) out.push(name);
    }
  };
  walk('');
  return out.sort();
}

export function zip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = Buffer.from(name, 'utf8'),
      packed = zlib.deflateRawSync(data, { level: 9 }),
      crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0x00210000, 10); // 1980-01-01, so the same files give the same zip
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0x00210000, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, n, packed);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// Returns { file, zip, manifest, signature } for the app folder, signed with the private key.
export function makeUpdate({ app, key, notes = '', electron }) {
  const version = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version;
  const file = `UniversalCollab-app-${version}.zip`;
  const data = zip(appFiles(app).map(name => ({ name, data: fs.readFileSync(path.join(app, name)) })));
  readZip(data);
  const manifest = Buffer.from(
    JSON.stringify(
      {
        format: 1,
        app: 'UniversalCollab',
        version,
        // Lowest Electron major version the update runs on; older installs are sent to the full installer.
        electron,
        file,
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        notes
      },
      null,
      2
    ) + '\n'
  );
  const privateKey = crypto.createPrivateKey(key);
  const signature = crypto.sign(null, manifest, privateKey).toString('base64') + '\n';
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  verifyManifest(manifest, signature, crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }));
  return { file, zip: data, manifest, signature, version, publicKey: pub.toString('base64') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const arg = name => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const keyFile = arg('key'),
    out = arg('out') && path.resolve(arg('out'));
  if (!keyFile || !out || out === repo || out.startsWith(repo + path.sep)) {
    console.error(
      'Usage: node build/make-app-update.mjs --key <update-signing-key.pem> --out <folder outside this repo> [--app <folder>] [--notes <file>] [--electron <major>]'
    );
    process.exit(1);
  }
  const app = path.resolve(arg('app') || path.join(repo, 'DesktopSource'));
  const r = makeUpdate({
    app,
    key: fs.readFileSync(keyFile, 'utf8'),
    notes: arg('notes') ? fs.readFileSync(arg('notes'), 'utf8').trim() : '',
    electron: +(arg('electron') || 44)
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, r.file), r.zip);
  fs.writeFileSync(path.join(out, MANIFEST), r.manifest);
  fs.writeFileSync(path.join(out, MANIFEST + '.sig'), r.signature);
  console.log(`Update ${r.version}: ${r.file} (${r.zip.length} bytes), ${MANIFEST}, ${MANIFEST}.sig in ${out}`);
  console.log(`Signed for public key ${r.publicKey}`);
  console.log(`Attach the three files to a GitHub release tagged exactly ${r.version} (lowercase).`);
}
