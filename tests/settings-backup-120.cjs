// Automatic settings backups (1.2.0): taken before an update installs, caches left out, last 5 kept, restored at
// the next start with each item replaced whole, and the current settings backed up first so a restore can be undone.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  sb = require('../DesktopSource/settings-backup.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-settings-')),
  ud = path.join(dir, 'Stream Relay');
const write = (f, v) => {
  fs.mkdirSync(path.dirname(path.join(ud, f)), { recursive: true });
  fs.writeFileSync(path.join(ud, f), v);
};
const read = f => fs.readFileSync(path.join(ud, f), 'utf8');
try {
  const b = sb.create(ud);
  assert.equal(b.snapshot('nothing'), null, 'no settings folder: nothing to back up');
  write('profile.bin', 'v1 profile');
  write('own-obs.json', '{"enabled":true}');
  write('Local Storage/leveldb/000003.log', 'log data');
  write('Local Storage/leveldb/000005.ldb', 'v1 table');
  write('Local Storage/leveldb/CURRENT', 'MANIFEST-1');
  write('Local Storage/leveldb/LOCK', '');
  write('Cache/Cache_Data/data_0', 'cache');
  write('GPUCache/index', 'gpu');
  write('renderer-problems.log', 'log');
  write('app-update/update.zip', 'zip');
  const id = b.snapshot('Before updating to 1.2.0-preview.3', {
    from: '1.2.0-preview.2',
    to: '1.2.0-preview.3'
  });
  const saved = path.join(ud, 'settings-backups', id);
  const files = [];
  const walk = (d, rel = '') =>
    fs
      .readdirSync(path.join(d, rel), { withFileTypes: true })
      .forEach(e => (e.isDirectory() ? walk(d, rel + e.name + '/') : files.push(rel + e.name)));
  walk(saved);
  assert.deepEqual(files.sort(), [
    'Local Storage/leveldb/000003.log',
    'Local Storage/leveldb/000005.ldb',
    'Local Storage/leveldb/CURRENT',
    'backup.json',
    'own-obs.json',
    'profile.bin'
  ]);
  const listed = b.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].label, 'Before updating to 1.2.0-preview.3');
  assert.equal(listed[0].to, '1.2.0-preview.3');

  // Settings change after the update; a new browser storage table appears.
  write('profile.bin', 'v2 profile');
  write('Local Storage/leveldb/000009.ldb', 'v2 table');
  write('stream-deck.json', 'new file');
  assert.equal(b.applyPendingRestore(), null, 'nothing asked for');
  assert.throws(() => b.requestRestore('nope'), /no longer exists/);
  b.requestRestore(id);
  // Next start.
  const restored = sb.create(ud).applyPendingRestore();
  assert.equal(restored.id, id);
  assert.equal(read('profile.bin'), 'v1 profile');
  assert.equal(read('Local Storage/leveldb/000005.ldb'), 'v1 table');
  assert.equal(
    fs.existsSync(path.join(ud, 'Local Storage/leveldb/000009.ldb')),
    false,
    'browser storage replaced whole, never mixed'
  );
  assert.equal(read('stream-deck.json'), 'new file', 'settings that were not in the backup are kept');
  assert.equal(sb.create(ud).applyPendingRestore(), null, 'restored once');
  // The settings from before the restore were backed up, so it can be undone.
  const undo = b.list().find(x => x.undo === id);
  assert.ok(undo, 'undo backup made');
  b.requestRestore(undo.id);
  sb.create(ud).applyPendingRestore();
  assert.equal(read('profile.bin'), 'v2 profile');
  assert.equal(read('Local Storage/leveldb/000009.ldb'), 'v2 table');

  // Only the last 5 are kept, but never the one being restored.
  for (let i = 0; i < 6; i++) {
    write('profile.bin', 'p' + i);
    b.snapshot('n' + i);
  }
  assert.equal(b.list().length, 5);
  assert.equal(b.list()[0].label, 'n5');
  const oldest = b.list().at(-1);
  b.requestRestore(oldest.id);
  const r = sb.create(ud).applyPendingRestore();
  assert.equal(r.id, oldest.id, 'the oldest can still be restored');
  // An incomplete backup (no backup.json) is never listed.
  fs.mkdirSync(path.join(ud, 'settings-backups', 'broken'), { recursive: true });
  assert.ok(!b.list().some(x => x.id === 'broken'));
  console.log('PASS settings backups: taken without caches, last 5 kept, restored whole at start, undoable.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
