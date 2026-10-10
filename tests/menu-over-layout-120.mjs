// Menus draw above the stream layout (1.2.0): the Preview/Program labels (layer 1100) and the live video (1000)
// used to show through the menu bar's menus. The layout panel now keeps its layers inside itself.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
try {
  await page.setViewportSize({ width: 1221, height: 890 });
  await page.evaluate(async () => {
    if (!window.studioMode.enabled) await window.studioMode.toggle();
  });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Tools'
    );
    menu.open = true;
    const list = menu.querySelector('.menu-popup');
    const out = [];
    for (const label of [...document.querySelectorAll('.studio-label')].filter(l => l.offsetParent)) {
      // The labels ignore the mouse, so let them count for the "what is on top" check.
      label.style.pointerEvents = 'auto';
      const b = label.getBoundingClientRect(),
        x = b.left + b.width / 2,
        y = b.top + b.height / 2;
      const m = list.getBoundingClientRect();
      // Move the open menu over the label, as when a long menu reaches it.
      list.style.transform = `translate(${x - m.left - 30}px, ${y - m.top - 30}px)`;
      out.push([label.textContent, list.contains(document.elementFromPoint(x, y))]);
      list.style.transform = '';
      label.style.pointerEvents = '';
    }
    return out;
  });
  assert.equal(result.length, 2, 'Preview and Program labels are shown');
  for (const [label, menuOnTop] of result) assert(menuOnTop, label + ' label shows through the menu');
  assert.deepEqual(errors, []);
  console.log('PASS menus draw above the stream layout and its Preview/Program labels.');
} finally {
  await browser.close();
}
