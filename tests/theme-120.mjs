// Appearance themes (#14, 1.2.0): Settings → Appearance recolours the app's own stylesheets; purples move to the
// theme's colour, status colours keep their meaning, Light swaps light and dark but keeps video areas black, the
// default restores the original stylesheets, and the choice is remembered and applied before the first paint.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { transform, recolour, THEMES } = createRequire(import.meta.url)('../DesktopSource/theme.js');
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const purple = [0xae, 0x86, 0xfb];
assert.deepEqual(transform(purple, 'purple'), purple, 'default is unchanged');
assert.ok(Math.abs(hue(transform(purple, 'blue')) - 212) < 12, 'purple accent becomes blue');
assert.ok(Math.abs(hue(transform(purple, 'teal')) - 172) < 12);
const green = [0x3e, 0xcf, 0x6e],
  red = [0xf5, 0x72, 0x87],
  yellow = [0xf2, 0xc2, 0x30];
for (const t of ['blue', 'teal', 'graphite', 'contrast'])
  for (const c of [green, red, yellow]) assert.deepEqual(transform(c, t), c, t + ' keeps status colours');
// Light: dark backgrounds become light, light text becomes dark, black video areas stay black.
const bg = transform([0x10, 0x10, 0x17], 'light'),
  text = transform([0xf2, 0xee, 0xf8], 'light');
assert.ok(bg[0] > 200 && text[0] < 40, JSON.stringify([bg, text]));
assert.deepEqual(transform([0, 0, 0], 'light'), [0, 0, 0]);
// High contrast: the accent becomes yellow and bright.
const hc = transform(purple, 'contrast');
assert.ok(Math.abs(hue(hc) - 48) < 6 && hc[0] > 200);
// Recolouring keeps everything that is not a colour, and alpha.
assert.equal(recolour('1px solid #ae86fb', 'purple'), '1px solid #ae86fb');
assert.match(
  recolour('0 2px 8px rgba(174, 134, 251, 0.4)', 'blue'),
  /^0 2px 8px rgba\(\d+, \d+, \d+, 0\.4\)$/
);
assert.match(recolour('#ae86fb80', 'blue'), /^#[0-9a-f]{6}80$/);
assert.equal(recolour('none', 'light'), 'none');
assert.equal(Object.keys(THEMES).length, 6);

const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.appTheme && window.workspaceUI);
  // Buttons animate colour changes; read the colour once the animation is over.
  const gear = async () => {
    await page.waitForTimeout(600);
    return page.evaluate(() => getComputedStyle(document.getElementById('settingsGear')).backgroundColor);
  };
  const original = await gear();
  await page.evaluate(() => window.workspaceUI.openSettings('appearance'));
  const radios = page.locator('input[name=appTheme]');
  assert.equal(await radios.count(), 6);
  assert.equal(await page.locator('input[name=appTheme][value=purple]').isChecked(), true);
  // Midnight blue: the accent changes, the original stylesheets are switched off and copies used instead.
  await page.locator('input[name=appTheme][value=blue]').check();
  const blue = await gear();
  assert.notEqual(blue, original);
  assert.equal(
    await page
      .evaluate(() => [
        document.adoptedStyleSheets.length,
        [...document.styleSheets].filter(s => !s.disabled).length
      ])
      .then(String),
    '3,0'
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-theme')), 'blue');
  // Remembered: after a restart it is applied before the app's scripts run.
  await page.reload();
  await page.waitForFunction(() => window.appTheme);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'blue');
  assert.equal(await gear(), blue);
  // Light: page background light, video area stays black, form controls light.
  await page.evaluate(() => window.appTheme.set('light'));
  const light = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme
  }));
  const [r] = light.body.match(/\d+/g).map(Number);
  assert.ok(r > 200, light.body);
  assert.match(light.scheme, /light/);
  // Back to the default: the original stylesheets, exactly.
  await page.evaluate(() => window.appTheme.set('purple'));
  assert.equal(await gear(), original);
  assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS themes: six themes, status colours kept, light keeps video black, remembered, default restores.'
  );
} finally {
  await browser.close();
}
