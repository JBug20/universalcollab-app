// Makes the Ed25519 key pair that signs app updates (app-update.cjs).
//   node build/update-keys.mjs <folder outside this repo>
// Writes update-signing-key.pem (PRIVATE: keep it safe, never commit, upload or share it) and prints the public
// key to put in DesktopSource/release-update.json of release builds ("publicKey"). Keep the same key for every
// release: installed apps only accept updates signed with the key they were built with.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] || '');
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.argv[2] || dir === repo || dir.startsWith(repo + path.sep)) {
  console.error('Usage: node build/update-keys.mjs <folder outside this repo>');
  process.exit(1);
}
const file = path.join(dir, 'update-signing-key.pem');
if (fs.existsSync(file)) {
  console.error(file + ' already exists; keep using it.');
  process.exit(1);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
console.log('Private key: ' + file);
console.log('Public key (release-update.json "publicKey"):');
console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
