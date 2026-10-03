// Updating stream metadata keeps the Twitch channel's language and category.
const assert = require('node:assert/strict'),
  { StudioService } = require('../DesktopSource/platforms/studio.cjs');
(async () => {
  const sent = [];
  const platform = {
    db: { accounts: { twitch: { id: 'tw' } } },
    save() {},
    account(p) {
      if (!this.db.accounts[p]) throw Error();
      return this.db.accounts[p];
    },
    twitchInfo: async () => ({ gameId: '42', language: 'de' }),
    updateTwitch: async x => sent.push(x)
  };
  const studio = new StudioService(platform);
  const result = await studio.update({
    id: '12345678-1234-1234-1234-123456789abc',
    title: 'New title',
    description: '',
    selected: ['twitch']
  });
  assert.deepEqual(result.results, [{ platform: 'twitch', ok: true }]);
  assert.equal(sent[0].language, 'de', 'a title update must not reset the channel language');
  assert.equal(sent[0].gameId, '42');
  assert.equal(sent[0].title, 'New title');
  console.log('PASS metadata updates keep the Twitch language and category.');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
