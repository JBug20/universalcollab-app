// Go-live announcements (1.2.0), window: Tools → Go-live announcements saves the webhook (never shown again), the
// message preview fills in title, collaborators and links; when a relay broadcast starts the ask-first preview
// appears once, posts the edited text with the chosen ping, and Skip posts nothing; the optional end post.
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';
const { browser, page, errors } = await openStudio();
const posts = () => page.evaluate(() => window.calls.filter(c => c.announce === 'post').map(c => c.input));
const setLive = on =>
  page.evaluate(on => {
    window.live = on;
  }, on);
try {
  await page.evaluate(() => {
    window.live = false;
    document.getElementById('serverConnect').click();
    // Destinations of the broadcast, as the relay reports them.
    setInterval(() => {
      if (view?.status?.broadcast)
        view.status.outputs = [
          { id: 'twitch', name: 'Twitch', state: 'sending' },
          { id: 'youtube', name: 'YouTube', state: 'sending' }
        ];
    }, 100);
  });
  await page.waitForFunction(() => connected && window.openAnnouncements && view?.status);

  // Not set up: going live posts nothing.
  await setLive(true);
  await page.waitForFunction(() => view.status.broadcast === true);
  await page.waitForTimeout(1500);
  await setLive(false);
  await page.waitForFunction(() => view.status.broadcast === false);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#announcePreview').isVisible(), false);

  // Set up.
  await page.evaluate(() => window.openAnnouncements());
  await page.locator('#announceWindow').waitFor({ state: 'visible' });
  assert.match(await page.locator('#announceDiscordState').textContent(), /not set up/);
  assert.equal(await page.locator('#announceTest').isHidden(), true);
  await page.locator('#announceWebhook').fill('https://discord.com/api/webhooks/123456789/token');
  await page.locator('#announceSaveWebhook').click();
  await page.waitForFunction(() => /connected \(webhook …6789\)/.test(announceDiscordState.textContent));
  assert.equal(await page.locator('#announceWebhook').inputValue(), '', 'the link is not kept in the window');
  assert.equal(await page.locator('#announceAsk').isChecked(), true, 'asks first by default');
  assert.equal(await page.locator('#announceEndEnabled').isChecked(), false, 'no end post by default');
  await page.locator('#announceLink-twitch').fill('https://twitch.tv/alice');
  await page.locator('#announceLink-twitch').dispatchEvent('change');
  await page.locator('#productionTitle').evaluate(n => (n.value = 'Friday chaos'));
  await page.locator('#announceLiveText').fill('Live: {title}{collaborators} {links}');
  await page.waitForFunction(() => /Preview: Live: Friday chaos/.test(announceSample.textContent));
  await page.locator('#announcePing').selectOption('role');
  await page.locator('#announceRoleId').fill('555666777');
  await page.locator('#announceRoleId').dispatchEvent('change');
  // Test post.
  await page.locator('#announceTest').click();
  await page.waitForFunction(() => /Test posted/.test(announceStatus.textContent));
  assert.match((await posts()).at(-1).text, /^Test from UniversalCollab/);
  assert.deepEqual((await posts()).at(-1).ping, { kind: 'role', roleId: '555666777' });
  await page.evaluate(() => announceWindow.close());

  // A collaborator in the layout.
  await page.evaluate(() => {
    view.me.settings.overlays = [{ publisher: 'bob' }];
  });
  const before = (await posts()).length;
  await setLive(true);
  await page.locator('#announcePreview').waitFor({ state: 'visible', timeout: 10000 });
  const text = await page.locator('#announcePreviewText').inputValue();
  assert.equal(text, 'Live: Friday chaos with bob https://twitch.tv/alice · YouTube');
  assert.match(await page.locator('#announcePreview').textContent(), /Pings the role 555666777/);
  assert.equal((await posts()).length, before, 'nothing posted before you choose');
  await page.locator('#announcePreviewText').fill(text + ' — come say hi');
  await page.locator('#announcePost').click();
  await page.locator('#announcePreview').waitFor({ state: 'hidden' });
  assert.equal((await posts()).at(-1).text, text + ' — come say hi');
  await page.waitForFunction(() => /Posted to Discord/.test(document.getElementById('notice').textContent));
  // Once per broadcast.
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('#announcePreview').isVisible(), false);

  // Ended (end post off): nothing. Next broadcast, Skip posts nothing; a failure shows in the preview.
  await setLive(false);
  await page.waitForFunction(() => view.status.broadcast === false);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#announcePreview').isVisible(), false);
  const count = (await posts()).length;
  await setLive(true);
  await page.locator('#announcePreview').waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => (window.announceFail = 'Discord says this webhook no longer exists.'));
  await page.locator('#announcePost').click();
  await page.waitForFunction(() =>
    /no longer exists/.test(document.getElementById('announcePreview').textContent)
  );
  await page.evaluate(() => (window.announceFail = ''));
  await page.locator('#announceSkip').click();
  assert.equal((await posts()).length, count + 1, 'only the failed attempt');

  // End post on, posting automatically.
  await page.evaluate(() => window.openAnnouncements());
  await page.locator('#announceEndEnabled').check();
  await page.locator('#announceAsk').uncheck();
  await page.evaluate(() => announceWindow.close());
  await setLive(false);
  await page.waitForFunction(() =>
    (window.calls.filter(c => c.announce === 'post').at(-1)?.input.text || '').startsWith('Stream over')
  );
  assert.equal(await page.locator('#announcePreview').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS go-live announcements window: setup, ask-first preview once per broadcast, skip, end post.'
  );
} finally {
  await browser.close();
}
