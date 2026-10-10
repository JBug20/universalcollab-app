// Stream overlays (1.2.0): End credits and Alerts served on 127.0.0.1 only, behind a private token; read-only;
// what the window publishes is size-limited; the pages roll the credits and show new alerts (not old ones).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const overlays = require('../DesktopSource/overlays.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-overlays-'));
const handlers = {};
let clip = '';
const ov = overlays.start({
  app: { getPath: () => dir, on() {} },
  ipcMain: { handle: (ch, fn) => (handlers[ch] = fn) },
  guard: () => {},
  clipboard: { writeText: t => (clip = t) },
  port: 0
});
const call = input => handlers.overlays({}, input);
const get = (url, { method = 'GET', host } = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname, method, headers: host ? { host } : {} },
      res => {
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  for (let i = 0; i < 50 && !call({ op: 'status' }).data.urls; i++) await new Promise(r => setTimeout(r, 20));
  const { credits, alerts } = call({ op: 'status' }).data.urls;
  assert.match(credits, /^http:\/\/127\.0\.0\.1:\d+\/o\/[A-Za-z0-9_-]{22,}\/credits$/);
  const base = credits.replace(/credits$/, '');
  // Only with the token, only GET, only for this PC's address.
  assert.equal((await get(credits)).status, 200);
  assert.match(
    (await get(credits)).headers['content-security-policy'],
    /default-src 'none'; script-src 'self'/
  );
  assert.equal((await get(credits.replace(/\/o\/[^/]+/, '/o/wrongtoken12345678901234'))).status, 404);
  assert.equal((await get(credits, { method: 'POST' })).status, 403);
  assert.equal((await get(credits, { host: 'evil.example' })).status, 403, 'DNS rebinding refused');
  assert.equal((await get(base + '../overlays.cjs')).status, 404);
  assert.equal((await get(base + 'main.cjs')).status, 404, 'only the overlay files');
  // Copy a link; reset makes the old one stop working.
  assert.equal(call({ op: 'copy', which: 'alerts' }).ok, true);
  assert.equal(clip, alerts);

  // What the window publishes is cleaned and limited.
  const many = Array.from({ length: 700 }, (_, i) => 'viewer' + i);
  call({
    op: 'update',
    credits: {
      title: 'GG!',
      speed: 9999,
      sections: [{ title: 'Followers', names: [...many, 42, 'x'.repeat(500)] }]
    },
    alerts: [],
    config: { sound: false, seconds: 1 }
  });
  const data = JSON.parse((await get(base + 'data.json')).body);
  assert.equal(data.credits.title, 'GG!');
  assert.equal(data.credits.speed, 200);
  assert.equal(data.credits.sections[0].names.length, 500);
  assert.equal(data.config.seconds, 2);

  // The credits page shows the title and names.
  call({
    op: 'update',
    credits: {
      title: 'Thanks for watching!',
      sections: [
        { title: 'Subscribers', names: ['Ada', 'Bo'] },
        { title: 'New followers', names: ['Cy'] },
        { title: 'Chatters', names: [] }
      ]
    },
    alerts: [{ seq: 1, title: 'New follower', name: 'OldEvent' }],
    config: { sound: false, seconds: 2 }
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(credits);
  await page.waitForFunction(() => document.querySelectorAll('#roll .name').length === 3);
  assert.deepEqual(
    await page.$$eval('#roll h2', h => h.map(x => x.textContent)),
    ['Subscribers', 'New followers'],
    'empty sections left out'
  );
  assert.equal(await page.textContent('#roll h1'), 'Thanks for watching!');
  const y1 = await page.$eval('#roll', r => r.getBoundingClientRect().top);
  await page.waitForTimeout(700);
  const y2 = await page.$eval('#roll', r => r.getBoundingClientRect().top);
  assert.ok(y2 < y1, 'the credits roll up');
  // The alerts page: old alerts are not replayed; a new one shows as a card.
  const ap = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  ap.on('pageerror', e => errors.push(e.message));
  await ap.goto(alerts);
  await ap.waitForTimeout(1500);
  assert.equal(await ap.$('.alert-card'), null, 'events from before the overlay opened are not shown');
  call({
    op: 'update',
    credits: {},
    alerts: [
      { seq: 1, title: 'New follower', name: 'OldEvent' },
      { seq: 2, title: 'Raid!', name: 'BigStreamer', detail: '120 viewers' }
    ],
    config: { sound: false, seconds: 2 }
  });
  await ap.waitForSelector('.alert-card');
  assert.match(await ap.textContent('.alert-card'), /Raid!BigStreamer120 viewers/);
  await ap.waitForFunction(() => !document.querySelector('.alert-card'), null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  // Reset: the old link stops working.
  call({ op: 'reset-token' });
  assert.equal((await get(credits)).status, 404);
  assert.notEqual(call({ op: 'status' }).data.urls.credits, credits);
  console.log('PASS overlays: local, token, read-only, limited data; credits roll; only new alerts shown.');
} finally {
  await browser.close();
  ov.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
