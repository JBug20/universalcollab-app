// Recordings folder (1.2.0): a folder is created if needed and checked to be writable before OBS is told to use
// it; relative paths, files and folders without write permission are refused with a clear message.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { check } = require('../DesktopSource/record-folder.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-recfolder-'));
try {
  const target = path.join(dir, 'New recordings', 'OBS');
  assert.equal(check('  ' + target + '  '), target, 'created when missing, spaces trimmed');
  assert.ok(fs.statSync(target).isDirectory());
  assert.deepEqual(fs.readdirSync(target), [], 'the write test leaves nothing behind');
  assert.throws(() => check(''), /Choose a folder/);
  assert.throws(() => check('Recordings'), /full folder path/);
  assert.throws(() => check(path.join(dir, 'bad|name')), /not a valid folder name/);
  const file = path.join(dir, 'a-file.txt');
  fs.writeFileSync(file, '');
  assert.throws(() => check(file), /cannot be saved in .*Choose another folder/);
  if (process.getuid?.() !== 0) {
    const locked = path.join(dir, 'locked');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    assert.throws(() => check(locked), /no permission to write there/);
    fs.chmodSync(locked, 0o700);
  }
  console.log('PASS recordings folder: created if needed, checked writable, bad paths refused.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
