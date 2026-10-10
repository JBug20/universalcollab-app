// Draws the Stream Deck plugin images (PNG, 1x and @2x) from the SVG icons below.
// Run from the repo root: node streamdeck/tools/make-images.mjs   (needs Playwright, as the tests do)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'stream.universalcollab.app.sdPlugin',
  'imgs'
);
const line =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const GLYPHS = {
  stream: `<circle cx="12" cy="12" r="2.6" fill="currentColor"/><path ${line} d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>`,
  record: `<circle cx="12" cy="12" r="6.5" fill="currentColor"/>`,
  clip: `<circle cx="6.5" cy="7" r="2.6" ${line}/><circle cx="6.5" cy="17" r="2.6" ${line}/><path ${line} d="M8.7 8.4 20 16.5M8.7 15.6 20 7.5"/>`,
  endrelay: `<circle cx="12" cy="12" r="9.5" ${line}/><rect x="8" y="8" width="8" height="8" rx="1.2" fill="currentColor"/>`,
  obsscene: `<rect x="3" y="5" width="18" height="14" rx="2" ${line}/><rect x="6" y="8" width="7" height="5" rx="1" fill="currentColor"/>`,
  relayscene: `<path ${line} d="M12 4 21 9l-9 5-9-5zM3 13.5l9 5 9-5"/>`,
  studiomode: `<rect x="2" y="7" width="9" height="10" rx="1.5" ${line}/><rect x="13" y="7" width="9" height="10" rx="1.5" ${line}/>`,
  transition: `<rect x="2.5" y="7" width="7.5" height="10" rx="1.5" ${line}/><path ${line} d="M12.5 12H21M17.5 8.5 21 12l-3.5 3.5"/>`,
  mute: `<rect x="9" y="3" width="6" height="11" rx="3" ${line}/><path ${line} d="M6 11a6 6 0 0 0 12 0M12 17v3.5M8.5 20.5h7"/>`,
  muted: `<rect x="9" y="3" width="6" height="11" rx="3" ${line}/><path ${line} d="M6 11a6 6 0 0 0 12 0M12 17v3.5M8.5 20.5h7"/><path fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" d="M4 4l16 16"/>`,
  assist: `<path ${line} d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0"/>`,
  afk: `<path ${line} d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.8 1 .8 2-.1 3M11.5 3.5c-.8 1 .8 2-.1 3"/>`,
  collab: `<circle cx="9" cy="8" r="3.2" ${line}/><path ${line} d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.2a3.2 3.2 0 0 1 0 5.6M17 13.6a5.5 5.5 0 0 1 3.5 5.4"/>`
};
const OFF = { bg: '#262033', fg: '#d9d0ec' };
// [file, glyph, background, glyph colour]
const KEYS = [
  ['stream-off', 'stream', OFF.bg, OFF.fg],
  ['stream-on', 'stream', '#c92a3a', '#ffffff'],
  ['record-off', 'record', OFF.bg, '#e05561'],
  ['record-on', 'record', '#c92a3a', '#ffffff'],
  ['clip', 'clip', OFF.bg, OFF.fg],
  ['endrelay-off', 'endrelay', OFF.bg, '#8a8199'],
  ['endrelay-on', 'endrelay', '#5a1d26', '#ff6b78'],
  ['obsscene-off', 'obsscene', OFF.bg, OFF.fg],
  ['obsscene-on', 'obsscene', '#6a4bd8', '#ffffff'],
  ['relayscene-off', 'relayscene', OFF.bg, OFF.fg],
  ['relayscene-on', 'relayscene', '#6a4bd8', '#ffffff'],
  ['studiomode-off', 'studiomode', OFF.bg, OFF.fg],
  ['studiomode-on', 'studiomode', '#6a4bd8', '#ffffff'],
  ['transition', 'transition', OFF.bg, OFF.fg],
  ['mute-off', 'mute', OFF.bg, OFF.fg],
  ['mute-on', 'muted', '#c92a3a', '#ffffff'],
  ['assist', 'assist', OFF.bg, OFF.fg],
  ['afk-off', 'afk', OFF.bg, OFF.fg],
  ['afk-on', 'afk', '#8a5a00', '#fff6d6']
];
const ACTIONS = [
  'stream',
  'record',
  'clip',
  'endrelay',
  'obsscene',
  'relayscene',
  'studiomode',
  'transition',
  'mute',
  'assist',
  'afk'
];

const svg = (glyph, size, { bg, fg, pad }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${fg}">` +
  (bg ? `<rect width="24" height="24" fill="${bg}"/>` : '') +
  `<g transform="translate(${pad} ${pad}) scale(${(24 - 2 * pad) / 24})">${GLYPHS[glyph]}</g></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, glyph, size, opts) {
  for (const [suffix, scale] of [
    ['', 1],
    ['@2x', 2]
  ]) {
    const px = size * scale;
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(glyph, px, opts)}</body></html>`
    );
    const out = path.join(root, file + suffix + '.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  }
}
for (const [file, glyph, bg, fg] of KEYS) await render('keys/' + file, glyph, 72, { bg, fg, pad: 5 });
for (const name of ACTIONS) await render('actions/' + name, name, 20, { fg: '#ffffff', pad: 0 });
await render('category', 'collab', 28, { fg: '#ffffff', pad: 0 });
await render('plugin', 'collab', 256, { bg: '#6a4bd8', fg: '#ffffff', pad: 4 });
await browser.close();
console.log('Images written to', root);
