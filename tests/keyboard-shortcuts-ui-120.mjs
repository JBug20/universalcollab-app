// Keyboard shortcuts and AFK (1.2.0), window side: the AFK shortcut switches viewers to the fallback collaborator's
// stream and back, with a banner and I'm back; it refuses when not live; Tools → Keyboard shortcuts turns shortcuts on,
// records a new shortcut from the keys pressed, clears one, and picks the Mute source.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { accelerator } = createRequire(import.meta.url)('../DesktopSource/keyboard-shortcuts.js');
const key = (code, mods = {}) =>
  accelerator({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
assert.equal(key('KeyC', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+C');
assert.equal(key('F9', { metaKey: true }), 'Super+F9');
assert.equal(key('Digit5', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+5');
assert.equal(key('ArrowUp', { altKey: true }), 'Alt+Up');
assert.equal(key('ControlLeft', { ctrlKey: true }), null, 'only modifiers held: not finished yet');

const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.pressHotkey && window.afkMode && window.runControlAction);
  // Not connected, then connected but not live: AFK explains.
  await page.evaluate(() => window.pressHotkey({ action: 'afk' }));
  await page.waitForFunction(() =>
    /Connect to the relay first/.test(document.getElementById('notice').textContent)
  );
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => connected && view?.status && !view.status.broadcast);
  await page.evaluate(() => window.pressHotkey({ action: 'afk' }));
  await page.waitForFunction(() =>
    /AFK works during a live relay broadcast/.test(document.getElementById('notice').textContent)
  );

  // Live with bob chosen as fallback: AFK switches to bob, banner, then back with the shortcut and with I'm back.
  await page.evaluate(() => {
    window.live = true;
    return refresh();
  });
  await page.waitForFunction(() => connected && view?.status?.broadcast);
  await page.evaluate(() => (view.me.settings.fallback = ['bob']));
  await page.evaluate(() => window.pressHotkey({ action: 'afk' }));
  await page.waitForFunction(() => calls.some(c => c.route?.endsWith('/force-fallback')));
  const banner = page.locator('#afkBanner');
  await banner.waitFor({ state: 'visible' });
  assert.match(await banner.textContent(), /AFK · viewers are watching bob's stream/);
  assert.match(await page.locator('#notice').textContent(), /viewers now see bob's stream/);
  await page.evaluate(() => window.pressHotkey({ action: 'afk' }));
  await page.waitForFunction(() => calls.some(c => c.route?.endsWith('/restore-primary')));
  await banner.waitFor({ state: 'hidden' });
  assert.match(await page.locator('#notice').textContent(), /viewers see your stream again/);
  await page.evaluate(() => window.pressHotkey({ action: 'afk' }));
  await banner.waitFor({ state: 'visible' });
  await banner.getByRole('button', { name: "I'm back" }).click();
  await banner.waitFor({ state: 'hidden' });
  // Stream Deck's AFK key uses the same switch.
  assert.equal(await page.evaluate(() => typeof window.afkMode.toggle), 'function');

  // Other shortcuts run the same actions as the buttons.
  await page.evaluate(() => window.pressHotkey({ action: 'clip' }));
  await page.waitForFunction(() => calls.some(c => c.obs === 'clip'));
  await page.evaluate(() => window.pressHotkey({ action: 'mute' }));
  await page.waitForFunction(() =>
    /Choose which audio source/.test(document.getElementById('notice').textContent)
  );

  // Tools → Keyboard shortcuts.
  await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Tools'
    );
    menu.open = true;
  });
  await page.locator('.app-menu[open] .menu-popup').getByText('Keyboard shortcuts').click();
  const win = page.locator('#keyboardShortcutsWindow');
  await win.waitFor({ state: 'visible' });
  assert.match(await win.textContent(), /Shortcuts are off/);
  await page.locator('#hotkeysEnabled').check();
  await page.waitForFunction(() => window.hotkeyState.enabled === true);
  // New shortcut for Clip: pause, press, resume.
  await win.locator('[data-action=clip]').click();
  await page.waitForFunction(() => calls.some(c => c.hotkeys === 'pause'));
  assert.equal(await win.locator('[data-action=clip]').textContent(), 'Press keys…');
  await page.keyboard.press('Control+Alt+KeyK');
  await page.waitForFunction(() => window.hotkeyState.keys.clip === 'Ctrl+Alt+K');
  await page.waitForFunction(() => calls.at(-1).hotkeys === 'resume');
  assert.equal(await win.locator('[data-action=clip]').textContent(), 'Ctrl+Alt+K');
  // Backspace clears; Esc cancels without closing the window.
  await win.locator('[data-action=transition]').click();
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => window.hotkeyState.keys.transition === '');
  await win.locator('[data-action=record]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await win.isVisible(), true, 'Esc while typing a shortcut does not close the window');
  assert.equal(await page.evaluate(() => window.hotkeyState.keys.record), 'Ctrl+Alt+R');
  // Mute source from OBS's audio sources.
  const mic = await page.evaluate(() => window.streamControls.state().inputs[0].name);
  await page.locator('#hotkeyMuteSource').selectOption(mic);
  await page.waitForFunction(m => window.hotkeyState.muteSource === m, mic);
  // In use by another program: shown.
  await page.evaluate(() => (window.hotkeyState.failed = ['afk']));
  await win.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => window.openKeyboardShortcuts());
  await page.waitForFunction(() =>
    /In use by another program: AFK/.test(document.getElementById('keyboardShortcutsWindow').textContent)
  );
  assert.equal(await win.locator('[data-action=afk]').getAttribute('class'), 'hotkey-key in-use');
  assert.deepEqual(errors, []);
  console.log(
    "PASS keyboard shortcuts window and AFK: switch and back, banner, I'm back, set/clear/cancel keys, mute source."
  );
} finally {
  await browser.close();
}
