// End credits and alerts (1.2.0), window side: Stream Assist events are grouped into credits sections without
// duplicates, events from before are not counted, sample alerts only when asked, each new event goes to the Alerts
// overlay, a new relay broadcast starts a new list, and Tools → End credits & alerts has the settings and links.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openStudio } from './helpers/studio-page.mjs';
const { section, alertTitle, collect, newSession } = createRequire(import.meta.url)(
  '../DesktopSource/end-credits.js'
);
const kinds = {
  Follow: 'follow',
  Subscription: 'sub',
  ReSub: 'sub',
  Resubscription: 'sub',
  NewSponsor: 'sub',
  MemberMileStone: 'sub',
  GiftBomb: 'gift',
  MassGiftSubscription: 'gift',
  MembershipGift: 'gift',
  KicksGifted: 'support',
  Cheer: 'support',
  Donation: 'support',
  SuperChat: 'support',
  SuperSticker: 'support',
  Raid: 'raid',
  Chat: 'chat',
  Collaboration: null
};
for (const [k, s] of Object.entries(kinds)) assert.equal(section(k), s, k);
assert.equal(alertTitle('Follow'), 'New follower');
assert.equal(alertTitle('ReSub'), 'Resubscribed');
assert.equal(alertTitle('KicksGifted'), 'Kicks');
assert.equal(alertTitle('Chat'), null, 'chat is credited but not an alert');
// Newest first, as Assist lists them; before-the-stream events are skipped; no duplicates.
const before = [{ id: 'old', kind: 'Follow', name: 'Earlybird', platform: 'Twitch' }];
const s = newSession(before);
let added = collect(s, [
  { id: '3', kind: 'Follow', name: 'ada', platform: 'Kick' },
  { id: '2', kind: 'Raid', name: 'BigStreamer', detail: '120 viewers', platform: 'Twitch' },
  { id: '1', kind: 'Follow', name: 'Ada', platform: 'Twitch' },
  ...before
]);
assert.deepEqual(s.people, { follow: ['Ada'], raid: ['BigStreamer'] });
assert.deepEqual(
  added.map(a => a.title + ':' + a.name),
  ['New follower:Ada', 'Raid!:BigStreamer', 'New follower:ada']
);
assert.equal(collect(s, [{ id: '3', kind: 'Follow', name: 'ada' }]).length, 0, 'counted once');
assert.equal(collect(s, [{ id: 's', kind: 'Subscription', name: 'Sample', demo: true }]).length, 0);
assert.equal(
  collect(s, [{ id: 's2', kind: 'Subscription', name: 'Sample', demo: true }], { samples: true }).length,
  1
);

const { browser, page, errors } = await openStudio();
try {
  await page.waitForFunction(() => window.openEndCredits && window.endCredits);
  const assist = alerts =>
    page.evaluate(
      alerts => window.dispatchEvent(new CustomEvent('integrated-assist-state', { detail: { alerts } })),
      alerts
    );
  // First update: what Assist already lists is from before.
  await assist([{ id: 'a0', kind: 'Follow', name: 'Yesterday', platform: 'Twitch' }]);
  await assist([
    { id: 'a2', kind: 'Subscription', name: 'Ada', detail: '3 months', platform: 'Twitch' },
    { id: 'a1', kind: 'Chat', name: 'Bo', detail: 'hi', platform: 'YouTube' },
    { id: 'a0', kind: 'Follow', name: 'Yesterday', platform: 'Twitch' }
  ]);
  await page.waitForFunction(() =>
    (window.overlayUpdates || []).some(u => u.alerts.some(a => a.name === 'Ada'))
  );
  const last = await page.evaluate(() => window.overlayUpdates.at(-1));
  const names = Object.fromEntries(last.credits.sections.map(s => [s.title, s.names]));
  assert.deepEqual(names.Subscribers, ['Ada']);
  assert.deepEqual(names.Chatters, ['Bo']);
  assert.deepEqual(names['New followers'], [], 'Yesterday was before the stream');
  assert.deepEqual(
    last.alerts.map(a => a.title),
    ['New subscriber']
  );
  // Tools → End credits & alerts.
  await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.app-menu')].find(
      d => d.querySelector('summary').textContent === 'Tools'
    );
    menu.open = true;
  });
  await page.locator('.app-menu[open] .menu-popup').getByText('End credits & alerts').click();
  const win = page.locator('#endCreditsWindow');
  await win.waitFor({ state: 'visible' });
  assert.match(await win.locator('.credits-counts').textContent(), /Subscribers: 1 · Chatters: 1/);
  await page.locator('#creditsTitle').fill('GG everyone!');
  await page.locator('#creditsTitle').dispatchEvent('change');
  await page.waitForFunction(() => window.overlayUpdates.at(-1).credits.title === 'GG everyone!');
  await win.getByRole('button', { name: 'Send a test alert' }).click();
  await page.waitForFunction(() => window.overlayUpdates.at(-1).alerts.some(a => a.name === 'Test viewer'));
  await win.getByRole('button', { name: 'Roll credits now' }).click();
  await page.waitForFunction(() => window.overlayUpdates.at(-1).credits.rollAt > 0);
  await win.getByRole('button', { name: 'Copy credits link' }).click();
  await page.waitForFunction(() => calls.some(c => c.overlays === 'copy' && c.input.which === 'credits'));
  assert.match(await win.textContent(), /link copied\. In OBS: Sources → \+ → Browser/);
  // A new relay broadcast starts a new list.
  await page.evaluate(() => {
    window.live = false;
    document.getElementById('serverConnect').click();
  });
  await page.waitForFunction(() => connected && view?.status && !view.status.broadcast);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.live = true;
    return refresh();
  });
  await page.waitForFunction(() => window.overlayUpdates.at(-1).credits.sections.every(s => !s.names.length));
  assert.deepEqual(errors, []);
  console.log(
    'PASS end credits: grouped, once each, before-stream skipped, alerts sent, settings, new list per broadcast.'
  );
} finally {
  await browser.close();
}
