const assert = require('node:assert/strict');
const { StudioService } = require('../../DesktopSource/platforms/studio.cjs');
(async () => {
  const calls = [];
  let failBind = true,
    ids = 0,
    saves = 0;
  const platform = {
    db: { clients: {}, accounts: { twitch: { id: 'tw' }, youtube: { id: 'yt' } } },
    save() {
      saves++;
    },
    now: () => Date.now(),
    account(p) {
      if (!this.db.accounts[p]) throw Error();
      return this.db.accounts[p];
    },
    raw: async () => ({
      ingests: [{ default: true, url_template: 'rtmp://ingest.example/app/{stream_key}' }]
    }),
    twitchInfo: async () => ({ gameId: '42', language: 'en' }),
    updateTwitch: async x => calls.push(['tw-meta', x]),
    updateYoutube: async x => calls.push(['yt-meta', x]),
    api: async (p, route, opts = {}) => {
      calls.push([p, route, opts]);
      if (route.startsWith('streams/key')) return { data: [{ stream_key: 'secret_tw' }] };
      if (route.startsWith('liveBroadcasts?')) return { id: 'b' + ++ids };
      if (route.startsWith('liveStreams?') && opts.method === 'POST') return { id: 's' + ++ids };
      if (route.startsWith('liveBroadcasts/bind')) {
        if (failBind) {
          failBind = false;
          throw Error('temporary');
        }
        return {};
      }
      if (route.startsWith('liveStreams?'))
        return {
          items: [
            {
              cdn: { ingestionInfo: { ingestionAddress: 'rtmp://yt.example/live', streamName: 'secret_yt' } }
            }
          ]
        };
      throw Error(route);
    }
  };
  const studio = new StudioService(platform);
  studio.custom({ name: 'Custom', url: 'rtmps://custom.example/live', key: 'secret_custom' });
  const custom = studio.snapshot().custom[0];
  assert(!JSON.stringify(studio.snapshot()).includes('secret_'));
  const input = {
    id: '12345678-1234-1234-1234-123456789abc',
    title: 'Shared title',
    description: 'Shared description',
    sync: true,
    selected: ['twitch', 'youtube', custom.id],
    privacy: 'unlisted',
    madeForKids: false,
    categoryId: '20',
    record: true
  };
  await assert.rejects(() => studio.prepare(input));
  const result = await studio.prepare(input);
  assert.equal(result.destinations.length, 3);
  assert.equal(result.destinations[0].url, 'rtmp://ingest.example/app');
  assert.equal(result.destinations[1].key, 'secret_yt');
  assert.equal(ids, 2);
  assert.deepEqual(await studio.prepare(input), result);
  assert.equal(ids, 2);
  assert(!JSON.stringify(studio.snapshot()).includes('secret_'));
  assert(saves > 3);
  await assert.rejects(() => studio.prepare({ ...input, title: 'Changed' }));
  const meta = studio.metadata(
    {
      ...input,
      sync: false,
      twitchTitle: 'Twitch only',
      youtubeTitle: 'YT only',
      youtubeDescription: 'YT description'
    },
    'youtube'
  );
  assert.equal(meta.title, 'YT only');
  await studio.update({ ...input, title: 'Changed live' });
  assert.equal(calls.filter(x => x[0] === 'yt-meta').at(-1)[1].title, 'Changed live');
  platform.db.accounts.youtube.id = 'someone_else';
  await assert.rejects(() => studio.prepare(input));
  console.log(
    'PASS native/custom selections, private ingest details, synced and individual metadata, resumable YouTube bind failure without duplicate creation, account binding.'
  );
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
