// Chat voice, window side: the dropdown in Chat settings (Off / On (streamer hears) / On (everyone hears)),
// reading only new messages, the volume and Mute in the audio panel, links read as "link", and the copy link.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const { browser, page, errors } = await openStudio({
  initScript: () => {
    // A fake system voice: records what would be spoken and finishes at once.
    window.spoken = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: u => {
          window.spoken.push({ text: u.text, volume: u.volume });
          setTimeout(() => u.onend?.(), 5);
        },
        cancel: () => {}
      }
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
          this.volume = 1;
        }
      }
    });
  }
});
const message = (n, text, extra = {}) => ({
  key: 'm' + n,
  platform: 'twitch',
  author: 'viewer' + n,
  authorId: 'u' + n,
  text,
  time: Date.now(),
  ...extra
});
const push = list =>
  page.evaluate(
    messages => window.dispatchEvent(new CustomEvent('platform-state', { detail: { messages } })),
    list
  );
const spoken = () => page.evaluate(() => window.spoken.map(s => s.text));
const voiceCalls = () =>
  page.evaluate(() => window.calls.filter(c => c.chatVoice === 'speak').map(c => c.input));
try {
  await page.evaluate(() => document.getElementById('serverConnect').click());
  await page.waitForFunction(() => window.chatVoice && document.getElementById('chatVoiceMode'));

  // The dropdown has exactly the three choices, and starts off.
  assert.deepEqual(await page.locator('#chatVoiceMode option').allTextContents(), [
    'Off',
    'On (streamer hears)',
    'On (everyone hears)'
  ]);
  assert.equal(await page.locator('#chatVoiceMode').inputValue(), 'off');
  // The volume sits in the audio panel, with Mute.
  assert.equal(await page.locator('#obsMixerPanel #chatVoiceVolume').count(), 1);
  assert.equal(await page.locator('#obsMixerPanel #chatVoiceMute').count(), 1);

  // History present at start is never read; with the setting off nothing is read.
  await push([message(1, 'old message')]);
  await push([message(1, 'old message'), message(2, 'hello while off')]);
  await page.waitForTimeout(200);
  assert.deepEqual(await spoken(), []);

  // On (streamer hears): new messages are spoken with the name first, in order, links as "link".
  await page.evaluate(() => window.chatVoice.set('local'));
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-chat-voice').includes('"local"')), true);
  const all = [message(1, 'old message'), message(2, 'hello while off')];
  await push([...all, message(3, 'hi there https://example.com/x?y=1 ok'), message(4, 'second one')]);
  await page.waitForFunction(() => window.spoken.length === 2);
  assert.deepEqual(await spoken(), ['viewer3 says hi there link ok', 'viewer4 says second one']);
  assert.deepEqual(await voiceCalls(), [], 'streamer-only never goes to the stream voice');
  // The same message is not read twice.
  await push([...all, message(3, 'hi there'), message(4, 'second one')]);
  await page.waitForTimeout(200);
  assert.equal((await spoken()).length, 2);

  // Volume and Mute in the audio panel set how loud it is.
  await page.locator('#chatVoiceVolume').evaluate(n => {
    n.value = '40';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await push([...all, message(5, 'quieter')]);
  await page.waitForFunction(() => window.spoken.length === 3);
  assert.equal(await page.evaluate(() => window.spoken.at(-1).volume), 0.4);
  await page.locator('#chatVoiceMute').click();
  assert.equal(await page.locator('#chatVoiceMute').getAttribute('aria-pressed'), 'true');
  await push([...all, message(5, 'quieter'), message(6, 'muted message')]);
  await page.waitForTimeout(300);
  assert.equal((await spoken()).length, 3, 'nothing is spoken while muted');
  await page.locator('#chatVoiceMute').click();

  // On (everyone hears): the stream voice is asked; the window does not also speak.
  await page.evaluate(() => window.chatVoice.set('stream'));
  assert.equal(await page.locator('#chatVoiceCopy').evaluate(n => !n.hidden), true);
  await push([...all, message(5, 'quieter'), message(6, 'muted message'), message(7, 'for everyone')]);
  await page.waitForFunction(() => window.calls.some(c => c.chatVoice === 'speak'));
  const sent = await voiceCalls();
  assert.deepEqual(
    sent.map(s => [s.text, s.volume]),
    [['viewer7 says for everyone', 0.4]]
  );
  assert.equal((await spoken()).length, 3);
  // The copy link button asks for the voice overlay link.
  await page.evaluate(() => document.getElementById('chatVoiceCopy').click());
  await page.waitForFunction(() =>
    window.calls.some(c => c.overlays === 'copy' && c.input.which === 'voice')
  );

  // A failure is shown, not swallowed.
  await page.evaluate(
    () => (window.chatVoiceFail = 'No text-to-speech voice found. On Linux, install espeak-ng.')
  );
  await push([...all, message(8, 'will fail')]);
  await page.waitForFunction(() => /espeak-ng/.test(document.getElementById('chatVoiceStatus').textContent));

  // Off again: nothing more is read.
  await page.evaluate(() => window.chatVoice.set('off'));
  const before = (await voiceCalls()).length;
  await push([...all, message(8, 'will fail'), message(9, 'after off')]);
  await page.waitForTimeout(300);
  assert.equal((await voiceCalls()).length, before);
  assert.equal((await spoken()).length, 3);

  // Remembered across a reload.
  await page.evaluate(() => window.chatVoice.set('local'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('uc-chat-voice')).volume), 40);
  assert.deepEqual(errors, []);
  console.log('PASS chat voice window: dropdown, new messages only, volume and mute, stream voice, errors.');
} finally {
  await browser.close();
}
