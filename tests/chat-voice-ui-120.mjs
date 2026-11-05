// Chat voice, window side: the dropdown in Chat settings (Off / On (streamer hears) / On (everyone hears)),
// reading only new messages, the volume and Mute in the audio panel, the Linux steps under the dropdown, skipping
// links, the blocklist, and the copy link.
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
// Every message the page has been told about so far; the window only reads ones it has not seen.
const history = [];
let n = 0;
const add = (text, extra = {}) => {
  history.push({
    key: 'm' + ++n,
    platform: 'twitch',
    author: 'viewer' + n,
    authorId: 'u' + n,
    text,
    time: Date.now(),
    ...extra
  });
  return 'viewer' + n;
};
const send = () =>
  page.evaluate(
    messages => window.dispatchEvent(new CustomEvent('platform-state', { detail: { messages } })),
    history
  );
const spoken = () => page.evaluate(() => window.spoken.map(s => s.text));
const voiceCalls = () =>
  page.evaluate(() => window.calls.filter(c => c.chatVoice === 'speak').map(c => c.input));
const status = () => page.locator('#chatVoiceStatus').textContent();
const set = (id, props) =>
  page.evaluate(
    ([i, p]) => {
      const el = document.getElementById(i);
      Object.assign(el, p);
      el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
    },
    [id, props]
  );
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
  // The Linux install steps are written under the dropdown (this browser reports Linux).
  assert.equal(await page.locator('#chatVoiceLinux').evaluate(el => el.hidden), false);
  const help = await page.locator('#chatVoiceLinux').textContent();
  for (const text of ['sudo pacman -S speech-dispatcher espeak-ng', 'sudo apt install', 'sudo dnf install'])
    assert(help.includes(text), text);
  assert.equal(
    await page.evaluate(() => {
      const a = document.getElementById('chatVoiceMode').closest('label'),
        b = document.getElementById('chatVoiceLinux');
      return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
    true
  );
  // Links are skipped by default; the blocklist starts empty.
  assert.equal(await page.locator('#chatVoiceSkipLinks').isChecked(), true);
  assert.equal(await page.locator('#chatVoiceBlocklist').inputValue(), '');

  // History present at start is never read; with the setting off nothing is read.
  add('old message');
  await send();
  add('hello while off');
  await send();
  await page.waitForTimeout(200);
  assert.deepEqual(await spoken(), []);

  // On (streamer hears): new messages are spoken with the name first, in order; links are skipped.
  await page.evaluate(() => window.chatVoice.set('local'));
  assert.equal(await page.evaluate(() => localStorage.getItem('uc-chat-voice').includes('"local"')), true);
  const first = add('hi there'),
    second = add('second one');
  add('see https://example.com/x?y=1 ok');
  add('join discord.gg/abc now');
  add('visit www.site.com');
  await send();
  await page.waitForFunction(() => window.spoken.length === 2);
  assert.deepEqual(await spoken(), [first + ' says hi there', second + ' says second one']);
  assert.deepEqual(await voiceCalls(), [], 'streamer-only never goes to the stream voice');
  await send();
  await page.waitForTimeout(200);
  assert.equal((await spoken()).length, 2, 'the same messages are not read twice');
  // With the option off, a link is read as the word "link".
  await set('chatVoiceSkipLinks', { checked: false });
  const linked = add('look https://a.test/b ok');
  await send();
  await page.waitForFunction(() => window.spoken.length === 3);
  assert.equal((await spoken())[2], linked + ' says look link ok');
  await set('chatVoiceSkipLinks', { checked: true });

  // The blocklist: whole words, disguised words and spread-out words are not read, and nothing is spoken for them.
  await set('chatVoiceBlocklist', { value: 'badword\nkys, nasty phrase' });
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('uc-chat-voice')).blocklist),
    'badword\nkys, nasty phrase'
  );
  add('you are a B4dw0rd!!');
  add('b a d w o r d');
  add('baaaadword');
  add('so nasty   phrase');
  add('kys');
  const fine1 = add('skys the limit'),
    fine2 = add('totally fine');
  await send();
  await page.waitForFunction(() => window.spoken.length === 5);
  assert.deepEqual((await spoken()).slice(3), [fine1 + ' says skys the limit', fine2 + ' says totally fine']);
  assert.match(await status(), /5 messages were not read because of the blocklist/);
  assert(!(await status()).includes('badword'), 'the status never repeats the word');
  // A blocked name is held too.
  add('hello', { author: 'xBadWord99' });
  await send();
  await page.waitForTimeout(250);
  assert.equal((await spoken()).length, 5);
  assert.match(await status(), /6 messages were not read/);
  await set('chatVoiceBlocklist', { value: '' });

  // Volume and Mute in the audio panel set how loud it is.
  await set('chatVoiceVolume', { value: '40' });
  add('quieter');
  await send();
  await page.waitForFunction(() => window.spoken.length === 6);
  assert.equal(await page.evaluate(() => window.spoken.at(-1).volume), 0.4);
  await page.locator('#chatVoiceMute').click();
  assert.equal(await page.locator('#chatVoiceMute').getAttribute('aria-pressed'), 'true');
  add('muted message');
  await send();
  await page.waitForTimeout(300);
  assert.equal((await spoken()).length, 6, 'nothing is spoken while muted');
  await page.locator('#chatVoiceMute').click();

  // On (everyone hears): the stream voice is asked; the window does not also speak.
  await page.evaluate(() => window.chatVoice.set('stream'));
  assert.equal(await page.locator('#chatVoiceCopy').evaluate(el => !el.hidden), true);
  const everyone = add('for everyone');
  await send();
  await page.waitForFunction(() => window.calls.some(c => c.chatVoice === 'speak'));
  assert.deepEqual(
    (await voiceCalls()).map(s => [s.text, s.volume]),
    [[everyone + ' says for everyone', 0.4]]
  );
  assert.equal((await spoken()).length, 6);
  // The copy link button asks for the voice overlay link.
  await page.evaluate(() => document.getElementById('chatVoiceCopy').click());
  await page.waitForFunction(() =>
    window.calls.some(c => c.overlays === 'copy' && c.input.which === 'voice')
  );

  // A failure is shown, not swallowed.
  await page.evaluate(
    () => (window.chatVoiceFail = 'No text-to-speech voice found. On Linux, install espeak-ng.')
  );
  add('will fail');
  await send();
  await page.waitForFunction(() => /espeak-ng/.test(document.getElementById('chatVoiceStatus').textContent));

  // Off again: nothing more is read.
  await page.evaluate(() => window.chatVoice.set('off'));
  const before = (await voiceCalls()).length;
  add('after off');
  await send();
  await page.waitForTimeout(300);
  assert.equal((await voiceCalls()).length, before);
  assert.equal((await spoken()).length, 6);

  // Remembered settings.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('uc-chat-voice')));
  assert.equal(saved.volume, 40);
  assert.equal(saved.skipLinks, true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS chat voice window: dropdown, Linux steps, new messages only, links, blocklist, volume and mute, stream voice, errors.'
  );
} finally {
  await browser.close();
}
