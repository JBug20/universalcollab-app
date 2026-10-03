const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createVault } = require('../DesktopSource/platforms/vault.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-vault-')),
  key = crypto.randomBytes(32);
let available = true;
const storage = {
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => 'kwallet6',
  encryptString: text => {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(text), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]);
  },
  decryptString: b => {
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
  }
};
try {
  const store = createVault(dir, storage, 'linux'),
    value = {
      version: 1,
      clients: { twitch: { clientId: 'CLIENT' } },
      accounts: { twitch: { accessToken: 'SECRET_TOKEN' } }
    };
  store.save(value);
  assert.deepEqual(store.load(), value);
  const f = path.join(dir, 'platform-accounts-v1.bin'),
    bytes = fs.readFileSync(f);
  assert(!bytes.includes('SECRET_TOKEN'));
  available = false;
  assert.throws(() => store.save({ ...value, accounts: {} }));
  assert(fs.readFileSync(f).equals(bytes));
  available = true;
  assert.deepEqual(store.load(), value);
  storage.getSelectedStorageBackend = () => 'basic_text';
  assert.throws(() => store.save(value));
  console.log(
    'PASS encrypted platform vault round-trip, plaintext rejection and locked-keyring write preserves existing data.'
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
