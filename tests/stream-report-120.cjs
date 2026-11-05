// Post-stream report (1.2.0): readings during a broadcast (outputs, drops, OBS frames across a stream restart,
// reconnects, recording, viewers), the finished report and its text; saving next to the recordings and the history.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const R = require('../DesktopSource/stream-report.js');
const { start, fileName } = require('../DesktopSource/stream-reports.cjs');

(async () => {
  const t0 = new Date(2026, 9, 17, 19, 2, 0).getTime();
  const r = R.newReport(t0, 'Friday chaos');
  assert.equal(r.id, new Date(t0).toISOString().replace(/[-:]/g, '').slice(0, 15));
  const out = (state, kbps) => [
    { id: 'tw', name: 'Twitch', state, bitrateKbps: kbps, fps: 60 },
    { id: 'kk', name: 'Kick', state: 'sending', bitrateKbps: 6000, fps: 30 }
  ];
  R.sample(r, {
    outputs: out('sending', 6000),
    stream: { outputActive: true, outputSkippedFrames: 10, outputTotalFrames: 1000 }
  });
  R.sample(r, {
    outputs: out('sending', 5000),
    stream: { outputActive: true, outputSkippedFrames: 20, outputTotalFrames: 2000, outputReconnecting: true }
  });
  R.sample(r, {
    outputs: out('reconnecting', NaN),
    stream: { outputActive: true, outputSkippedFrames: 20, outputTotalFrames: 2100, outputReconnecting: true }
  });
  // OBS's stream restarted: its counters start again; earlier frames still count.
  R.sample(r, {
    outputs: out('sending', 6000),
    stream: { outputActive: true, outputSkippedFrames: 5, outputTotalFrames: 900 },
    record: { outputActive: true, outputDuration: 3600000 }
  });
  R.drop(r, { type: 'down', id: 'tw', name: 'Twitch', state: 'reconnecting', at: t0 + 600000 });
  R.drop(r, { type: 'back', id: 'tw', name: 'Twitch', at: t0 + 645000 });
  R.drop(r, { type: 'down', id: 'tw', name: 'Twitch', state: 'failed', at: t0 + 7000000 });
  R.viewers(R.viewers(r, { twitch: 30, youtube: null }), { twitch: 54, youtube: 12 });
  r.clips.push({ path: 'Replay 2026-10-17.mp4', at: t0 + 120000 });
  R.finish(r, {
    now: t0 + 2 * 3600000 + 13 * 60000 + 5000,
    markers: [{ n: 1, label: '', stream: 65, recording: 60, at: t0 + 65000, twitch: true, chapter: false }],
    people: { follow: ['a', 'b', 'c'], sub: ['d'], chat: ['e', 'f'] }
  });
  const s = R.summary(r);
  assert.equal(s.length, '2:13:05');
  assert.deepEqual([s.skipped, s.total], [25, 3000]);
  assert.equal(s.drops, 2);
  assert.deepEqual(s.community, ['3 new followers', '1 subscriber', '2 chatters']);
  assert.equal(r.obs.reconnects, 1, 'one reconnect, not one per reading');
  assert.deepEqual(r.platforms, ['Twitch', 'Kick']);
  const text = R.toText(r);
  for (const want of [
    /^Stream report: Friday chaos\n/,
    /, 19:02 to 21:15 \(2:13:05\)/,
    /Platforms: Twitch, Kick/,
    /- Twitch: 5,667 kbps, 60 fps; stopped receiving 2× \(19:12, back after 0:45; 20:58, not back\)/,
    /- Kick: 6,000 kbps, 30 fps; no drops/,
    /- Dropped frames: 0\.83% \(25 of 3,000\)/,
    /- Reconnects: 1/,
    /- Recorded: 1:00:00/,
    /- Twitch: peak 54, average 42\n- YouTube: peak 12, average 12/,
    /- 3 new followers, 1 subscriber, 2 chatters/,
    /Markers \(1\)\n- #1 · Marker · stream 1:05 · recording 1:00 · .* \(Twitch marker\)/,
    /Clips \(1\)\n- Replay 2026-10-17\.mp4 at 19:04/
  ])
    assert.match(text, want);
  // Nothing noted.
  const empty = R.finish(R.newReport(t0), { now: t0 + 60000 });
  assert.match(
    R.toText(empty),
    /No destination readings[\s\S]*Dropped frames: no readings[\s\S]*Not recorded[\s\S]*No new followers[\s\S]*Markers\n- None[\s\S]*Clips\n- None/
  );
  assert.doesNotMatch(R.toText(empty), /Viewers/);

  // Saving: the text next to the recordings, the report in the history (newest first, last 50).
  assert.equal(fileName(t0), 'Stream report 2026-10-17 19-02.txt');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-report-'));
  try {
    const rec = path.join(dir, 'Recordings');
    fs.mkdirSync(rec);
    let folder = rec;
    const handlers = {},
      shown = [];
    start({
      app: { getPath: k => path.join(dir, k) },
      ipcMain: { handle: (n, f) => (handlers[n] = f) },
      guard: () => {},
      shell: { showItemInFolder: p => shown.push(p) },
      recordingsFolder: async () => folder
    });
    const call = i => handlers['stream-reports']({}, i);
    const saved = await call({ op: 'save', report: r, text });
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.data.file, 'Stream report 2026-10-17 19-02.txt');
    assert.equal(fs.readFileSync(path.join(rec, saved.data.file), 'utf8').replace(/\r\n/g, '\n'), text);
    const list = await call({ op: 'list' });
    assert.deepEqual(list.data, [
      { id: r.id, title: 'Friday chaos', startedAt: r.startedAt, endedAt: r.endedAt }
    ]);
    assert.equal((await call({ op: 'get', id: r.id })).data.report.title, 'Friday chaos');
    await call({ op: 'show', id: r.id });
    assert.deepEqual(shown, [path.join(rec, saved.data.file)]);
    // No OBS folder: Videos/UniversalCollab.
    folder = '';
    const r2 = R.finish(R.newReport(t0 + 86400000), { now: t0 + 86400000 + 1000 });
    const s2 = await call({ op: 'save', report: r2, text: 'x' });
    assert.equal(
      s2.data.path,
      path.join(dir, 'videos', 'UniversalCollab', 'Stream report 2026-10-18 19-02.txt')
    );
    assert.equal((await call({ op: 'list' })).data[0].id, r2.id, 'newest first');
    for (const bad of [
      { ...r, id: '../x' },
      { ...r, startedAt: 'x' }
    ])
      assert.equal((await call({ op: 'save', report: bad, text })).ok, false);
    assert.equal((await call({ op: 'get', id: '../../etc' })).ok, false);
    assert.equal((await call({ op: 'save', report: r, text: 'x'.repeat(200001) })).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS stream report: readings, drops, frames, viewers, text, saving and history.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
