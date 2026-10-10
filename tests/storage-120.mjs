// Storage (1.2.0): free space on this PC beside "My storage" on the relay, and low storage warnings for both.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { measure } = createRequire(import.meta.url)('../DesktopSource/local-storage.cjs');

// Measuring: the nearest existing folder is used when OBS's recordings folder does not exist yet.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-disk-'));
try {
  let asked = '';
  const r = await measure(path.join(dir, 'not', 'yet'), async at => {
    asked = at;
    return { blocks: 1000, bsize: 4096, bavail: 250 };
  });
  assert.equal(asked, dir);
  assert.equal(r.totalBytes, 4096000);
  assert.equal(r.freeBytes, 1024000);
  assert.equal(r.drive, path.parse(dir).root);
  const real = await measure(dir);
  assert.ok(real.freeBytes > 0 && real.totalBytes >= real.freeBytes);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const GB = 1073741824;
const { browser, page, errors } = await openStudio({ viewport: { width: 1500, height: 1000 } });
try {
  // This PC is shown even before connecting to a relay.
  await page.evaluate(GB => {
    window.fakeDisk = {
      folder: 'D:\\Videos\\OBS',
      drive: 'D:\\',
      freeBytes: 250 * GB,
      totalBytes: 1000 * GB,
      fromOBS: true
    };
  }, GB);
  const pcSeg = page.locator('.status-seg.local');
  await page.waitForFunction(
    () => /free/.test(document.querySelector('.status-seg.local .status-value').textContent),
    null,
    {
      timeout: 40000
    }
  );
  assert.equal(await pcSeg.textContent(), 'This PC250.0 GB free');
  assert.equal(await pcSeg.getAttribute('class'), 'status-seg local');

  // Connected: My storage from the relay and This PC side by side, with both in the details window.
  await page.evaluate(GB => {
    window.fakeHealth = {
      at: Date.now(),
      cpu: { percent: 10, cores: 2 },
      memory: null,
      network: null,
      storage: { limitBytes: 10 * GB, usedBytes: 2 * GB, freeBytes: 8 * GB },
      warnings: [],
      sessions: [],
      otherBroadcasts: 0
    };
    window.live = true;
    document.getElementById('serverConnect').click();
  }, GB);
  const relaySeg = page.locator('.status-seg.disk');
  await page.waitForFunction(() => !document.querySelector('.status-seg.disk').hidden);
  assert.equal(await relaySeg.textContent(), 'My storage8.0 GB free');
  await page.locator('.status-segments').click();
  const details = await page.locator('#statusDetails').textContent();
  assert.match(details, /My storage8\.0 GB free of 10\.0 GB/);
  assert.match(
    details,
    /This PC250\.0 GB free of 1000\.0 GB on D:\\ \(OBS recordings folder: D:\\Videos\\OBS\)/
  );
  await page.locator('#statusDetails button').first().click();

  // Relay allowance nearly full: yellow and one notice; full: red and a new notice.
  await page.evaluate(
    GB => (window.fakeHealth.storage = { limitBytes: 10 * GB, usedBytes: 9.5 * GB, freeBytes: 0.5 * GB }),
    GB
  );
  await page.waitForFunction(() => document.querySelector('.status-seg.disk').classList.contains('warn'));
  assert.match(
    await page.locator('#notice').textContent(),
    /recording storage on the relay is nearly full: 512 MB free of 10\.0 GB/
  );
  await page.evaluate(() => (document.getElementById('notice').textContent = ''));
  await page.waitForTimeout(4000);
  assert.equal(await page.locator('#notice').textContent(), '', 'said once');
  await page.evaluate(
    GB => (window.fakeHealth.storage = { limitBytes: 10 * GB, usedBytes: 10 * GB, freeBytes: 0 }),
    GB
  );
  await page.waitForFunction(() => document.querySelector('.status-seg.disk').classList.contains('crit'));
  assert.match(await page.locator('#notice').textContent(), /relay is full/);

  // This PC low: yellow under 10 GB, red under 2 GB, each said once; stays visible on a narrow window.
  await page.evaluate(GB => (window.fakeDisk = { ...window.fakeDisk, freeBytes: 6 * GB }), GB);
  await page.waitForFunction(
    () => document.querySelector('.status-seg.local').classList.contains('warn'),
    null,
    {
      timeout: 40000
    }
  );
  assert.match(
    await page.locator('#notice').textContent(),
    /This PC is running low on space for recordings and clips: 6\.0 GB free on D:\\/
  );
  await page.evaluate(GB => (window.fakeDisk = { ...window.fakeDisk, freeBytes: 1 * GB }), GB);
  await page.waitForFunction(
    () => document.querySelector('.status-seg.local').classList.contains('crit'),
    null,
    {
      timeout: 40000
    }
  );
  assert.match(await page.locator('#notice').textContent(), /almost out of space/);
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.equal(await pcSeg.isVisible(), true, 'a nearly full drive stays visible on narrow windows');
  assert.deepEqual(errors, []);
  console.log('PASS storage: This PC beside My storage, details, low storage warnings once each.');
} finally {
  await browser.close();
}
