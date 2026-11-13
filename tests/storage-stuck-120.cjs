// A recordings drive that stops answering (a USB drive asleep or failing, a network drive that dropped) must never
// freeze UniversalCollab: the free-space check and the readiness folder check run asynchronously, give up after a few
// seconds with a clear message, and do not pile up while the drive is still not answering.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { measure, guarded } = require('../DesktopSource/local-storage.cjs');
const { status } = require('../DesktopSource/record-folder.cjs');

(async () => {
  // Nothing in the free-space check is synchronous file access on the main thread.
  const src = fs.readFileSync(path.join(__dirname, '../DesktopSource/local-storage.cjs'), 'utf8');
  assert.doesNotMatch(src, /Sync\(/, 'no synchronous file calls');
  const rf = fs.readFileSync(path.join(__dirname, '../DesktopSource/record-folder.cjs'), 'utf8');
  const statusSrc = rf.slice(rf.indexOf('async function status'));
  assert.doesNotMatch(
    statusSrc.slice(0, statusSrc.indexOf('\n}\n')),
    /Sync\(/,
    'readiness check is asynchronous'
  );

  // A drive that never answers: the check gives up, the app stays responsive.
  let calls = 0;
  const hang = () => {
    calls++;
    return new Promise(() => {});
  };
  const check = guarded({ timeout: 200, measureFn: hang });
  const t0 = Date.now();
  await assert.rejects(check('E:\\Recordings'), /drive for E:\\Recordings is not answering/);
  assert(Date.now() - t0 < 1500, 'gave up quickly');
  // Asked again while the drive is still stuck: answered at once, without touching the drive again.
  const t1 = Date.now();
  await assert.rejects(check('E:\\Recordings'), /not answering/);
  assert(Date.now() - t1 < 100);
  assert.equal(calls, 1, 'no pile-up of checks on a stuck drive');
  // The main thread kept running meanwhile.
  let ticks = 0;
  const iv = setInterval(() => ticks++, 20);
  await assert.rejects(guarded({ timeout: 200, measureFn: hang })('F:\\'), /not answering/);
  clearInterval(iv);
  assert(ticks >= 5, 'timers kept running while waiting');

  // A drive that answers: normal result, and the next check runs again.
  let n = 0;
  const ok = guarded({ timeout: 500, measureFn: async dir => ({ folder: dir, n: ++n }) });
  assert.equal((await ok('D:\\Rec')).n, 1);
  assert.equal((await ok('D:\\Rec')).n, 2);

  // measure() with stand-ins: a folder not made yet is measured at its nearest existing parent.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-stuck-'));
  try {
    let seen = '';
    const r = await measure(path.join(dir, 'not', 'yet'), {
      statfs: async at => {
        seen = at;
        return { blocks: 100, bsize: 4096, bavail: 50 };
      }
    });
    assert.equal(seen, dir);
    assert.equal(r.freeBytes, 50 * 4096);
    // The readiness folder check, on a real folder and a missing one.
    assert.deepEqual(await status(dir), { ok: true, folder: dir });
    assert.match((await status(path.join(dir, 'gone'))).error, /does not exist \(is the drive connected\?\)/);
    assert.equal((await status('')).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    'PASS stuck recordings drive: checks give up after a few seconds, never pile up, app keeps running.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
