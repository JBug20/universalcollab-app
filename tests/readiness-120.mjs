// Pre-stream readiness (1.2.0): a report of what must be fixed before going live, what is worth checking and what
// is ready, from the relay, OBS (encoders, replay buffer, recordings folder), free space and the Twitch rule.
// Checking only reads.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { evaluate, summary } = createRequire(import.meta.url)('../DesktopSource/readiness.js');
const GB = 2 ** 30;
const good = {
  relay: {
    connected: true,
    mode: 'live',
    destinationConfigured: true,
    cpu: 30,
    storage: { limitBytes: 10 * GB, freeBytes: 8 * GB }
  },
  obs: {
    connected: true,
    readiness: {
      encoder: 'jim_nvenc',
      audioEncoder: 'ffmpeg_aac',
      video: { outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 },
      replay: { supported: true, enabled: true },
      recordFolder: { ok: true, folder: 'D:\\Rec' }
    }
  },
  pc: { freeBytes: 300 * GB, totalBytes: 1000 * GB, drive: 'D:\\' },
  afkTarget: 'bob'
};
const levels = f => evaluate(f).filter(i => i.level === 'block' || i.level === 'warn');
assert.deepEqual(levels(good), [], 'all good');
assert.equal(summary(evaluate(good)), 'Ready to go live.');
const texts = f =>
  evaluate(f)
    .map(i => i.level + ': ' + i.text)
    .join('\n');
assert.match(texts(good), /ok: OBS video encoder: jim_nvenc \(H\.264\)/);
assert.match(texts(good), /info: OBS sends 1920×1080 at 60 fps/);
assert.match(texts(good), /info: AFK switches viewers to bob's stream/);

const variant = patch => structuredClone({ ...good, ...patch(structuredClone(good)) });
// Must fix.
assert.match(texts(variant(() => ({ relay: { connected: false } }))), /block: Not connected to a relay/);
assert.match(texts(variant(() => ({ obs: { connected: false } }))), /block: OBS is not connected/);
assert.match(
  texts(variant(g => ({ relay: { ...g.relay, destinationConfigured: false } }))),
  /block: No stream is prepared/
);
assert.match(texts(variant(g => ({ relay: { ...g.relay, held: true } }))), /block: The relay is holding/);
assert.match(
  texts(
    variant(g => ({
      obs: { connected: true, readiness: { ...g.obs.readiness, encoder: 'obs_nvenc_hevc_tex' } }
    }))
  ),
  /block: .*HEVC\/AV1.*needs H\.264/
);
assert.match(
  texts(
    variant(g => ({ obs: { connected: true, readiness: { ...g.obs.readiness, encoder: 'nvenc_av1' } } }))
  ),
  /block: .*needs H\.264/
);
assert.match(
  texts(
    variant(g => ({
      obs: { connected: true, readiness: { ...g.obs.readiness, audioEncoder: 'ffmpeg_opus' } }
    }))
  ),
  /block: .*needs AAC/
);
assert.equal(
  summary(evaluate(variant(() => ({ obs: { connected: false } })))),
  'Not ready: 1 thing to fix before going live.'
);
// Worth checking.
assert.match(
  texts(variant(g => ({ relay: { ...g.relay, mode: 'test' } }))),
  /warn: The relay is in TEST mode/
);
assert.match(texts(variant(g => ({ relay: { ...g.relay, cpu: 92 } }))), /warn: Relay CPU is at 92%/);
assert.match(
  texts(variant(g => ({ relay: { ...g.relay, storage: { limitBytes: 10 * GB, freeBytes: 0.5 * GB } } }))),
  /warn: Your recording storage on the relay is nearly full/
);
assert.match(
  texts(
    variant(g => ({
      obs: { connected: true, readiness: { ...g.obs.readiness, replay: { supported: true, enabled: false } } }
    }))
  ),
  /warn: Clip will not work/
);
assert.match(
  texts(
    variant(g => ({
      obs: {
        connected: true,
        readiness: {
          ...g.obs.readiness,
          recordFolder: { ok: false, error: 'E:\\Rec does not exist (is the drive connected?).' }
        }
      }
    }))
  ),
  /warn: Recordings cannot be saved: E:\\Rec does not exist/
);
assert.match(
  texts(variant(() => ({ pc: { freeBytes: 6 * GB, totalBytes: 500 * GB, drive: 'C:\\' } }))),
  /warn: This PC is low on space/
);
assert.match(
  texts(variant(() => ({ twitchGaps: ['Twitch is 720p but YouTube is source size.'] }))),
  /warn: Twitch quality: Twitch is 720p/
);
assert.match(texts(variant(() => ({ afkTarget: '' }))), /info: AFK would show your reconnect image/);
assert.equal(
  summary(evaluate(variant(g => ({ relay: { ...g.relay, mode: 'test' } })))),
  'Ready to go live, with 1 thing worth checking.'
);
// With auto-record on, no space or no folder becomes a must-fix.
assert.match(
  texts(
    variant(() => ({ autoRecord: true, pc: { freeBytes: 1 * GB, totalBytes: 500 * GB, drive: 'C:\\' } }))
  ),
  /block: This PC is almost out of space.*Auto-record will not start/
);
assert.match(
  texts(
    variant(g => ({
      autoRecord: true,
      obs: { connected: true, readiness: { ...g.obs.readiness, recordFolder: { ok: false, error: 'x' } } }
    }))
  ),
  /block: Recordings cannot be saved/
);

const { browser, page, errors } = await openStudio();
try {
  await page.evaluate(() => {
    window.fakeDisk = {
      folder: 'D:\\Rec',
      drive: 'D:\\',
      freeBytes: 300 * 2 ** 30,
      totalBytes: 1000 * 2 ** 30
    };
    window.fakeHealth = {
      at: Date.now(),
      cpu: { percent: 40, cores: 4 },
      storage: { limitBytes: 10 * 2 ** 30, freeBytes: 8 * 2 ** 30, usedBytes: 2 * 2 ** 30 },
      warnings: [],
      sessions: [],
      otherBroadcasts: 0
    };
  });
  await page.waitForFunction(() => window.openReadiness && window.obsConnected);
  // Not connected to the relay: must fix.
  // Stream controls ⋯ → Check readiness clicks this button.
  await page.evaluate(() => document.getElementById('readinessCheck').click());
  const win = page.locator('#readinessWindow');
  await win.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !/Checking/.test(document.querySelector('.readiness-summary').textContent)
  );
  assert.match(await win.textContent(), /Not ready: .*Not connected to a relay/);
  await win.getByRole('button', { name: 'Close' }).click();
  // Connected with a prepared stream: ready, and it read OBS and the relay health without changing anything.
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => connected && view?.me);
  const before = await page.evaluate(() => calls.length);
  await page.evaluate(() => window.openReadiness());
  await page.waitForFunction(() =>
    /Ready to go live/.test(document.querySelector('.readiness-summary').textContent)
  );
  const text = await win.textContent();
  assert.match(text, /OBS video encoder: x264 \(H\.264\)/);
  assert.match(text, /Clip is ready/);
  assert.match(text, /300\.0 GB free on D:/);
  const made = await page.evaluate(n => calls.slice(n), before);
  assert.ok(
    made.some(c => c.route?.endsWith('/health')),
    'relay health read'
  );
  assert.ok(
    made.some(c => c.obs === 'readiness'),
    'OBS read'
  );
  assert.ok(
    !made.some(c => c.body && Object.keys(c.body).length) &&
      !made.some(c => /set|start|stop|record-|directory/.test(c.obs || '')),
    'nothing changed: ' + JSON.stringify(made)
  );
  // An HEVC encoder: must fix, shown in red.
  await page.evaluate(
    () =>
      (window.fakeReadiness = {
        encoder: 'obs_nvenc_hevc_tex',
        audioEncoder: '',
        replay: { supported: true, enabled: true },
        recordFolder: { ok: true, folder: 'D:\\Rec' }
      })
  );
  await win.getByRole('button', { name: 'Check again' }).click();
  await page.waitForFunction(() =>
    /Not ready/.test(document.querySelector('.readiness-summary').textContent)
  );
  assert.equal(await page.locator('.readiness-summary').getAttribute('data-level'), 'block');
  assert.match(await page.locator('.readiness-group.block').textContent(), /needs H\.264/);
  assert.deepEqual(errors, []);
  console.log(
    'PASS readiness: must-fix, worth checking and ready from relay, OBS, storage and Twitch; read-only.'
  );
} finally {
  await browser.close();
}
