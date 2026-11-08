// Stream labels (1.2.0): Stream Assist's events from every platform become label texts (latest follower, sub, tip,
// cheer, raid…, and this stream's counts); the app writes them as text files only when they change, only for known
// labels, and adds OBS Text sources that read them.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const L = require('../DesktopSource/stream-labels.js');
const { create, sourceName } = require('../DesktopSource/stream-labels.cjs');

(async () => {
  // Kinds as Stream Assist names them (DirectTwitch / DirectKick / DirectYouTube / DirectStreamlabs).
  const kinds = {
    Follow: 'follow',
    Subscription: 'sub',
    ReSub: 'sub',
    Resubscription: 'sub',
    NewSponsor: 'sub',
    MemberMileStone: 'sub',
    GiftBomb: 'gift',
    MembershipGift: 'gift',
    Cheer: 'cheer',
    Raid: 'raid',
    SuperChat: 'superchat',
    SuperSticker: 'superchat',
    Donation: 'donation',
    KicksGifted: 'kicks',
    Chat: null,
    Collaboration: null
  };
  for (const [k, want] of Object.entries(kinds)) assert.equal(L.kindOf(k), want, k);
  assert.equal(L.amountOf('cheer', '500 bits  Nice stream!'), '500 bits');
  assert.equal(L.amountOf('donation', '$5.00  Thanks for the help'), '$5.00');
  assert.equal(L.amountOf('follow', 'Welcome to the community!'), '', 'no amount for a follow');
  assert.equal(L.valueOf('$1,234.50'), 1234.5);
  assert.equal(L.valueOf('12,50 €'), 12.5);
  assert.equal(L.valueOf('500 bits'), 500);
  assert.equal(L.valueOf(''), 0);

  // Nothing saved yet: what Assist already lists is from before and is not counted.
  const st = L.newState();
  const before = [{ id: 'old', kind: 'Follow', name: 'Earlier', platform: 'Twitch' }];
  assert.equal(L.collect(st, before), false);
  assert.equal(L.texts(st).latest_follower, '');

  // Assist lists newest first.
  const events = [
    { id: '9', kind: 'Chat', name: 'Talker', detail: 'secret chat message', platform: 'Kick' },
    { id: '8', kind: 'Donation', name: 'Tipper', detail: '$3.00  hi', platform: 'Streamlabs' },
    { id: '7', kind: 'SuperChat', name: 'BigFan', detail: '£20.00  Love it', platform: 'YouTube' },
    { id: '6', kind: 'Cheer', name: 'Bitsy', detail: '100 bits  go', platform: 'Twitch' },
    { id: '5', kind: 'Cheer', name: 'Bitsy', detail: '150 bits', platform: 'Twitch' },
    { id: '4', kind: 'Cheer', name: 'Other', detail: '200 bits', platform: 'Twitch' },
    { id: '3', kind: 'GiftBomb', name: 'Santa', detail: '5 gifted subscriptions', platform: 'Twitch' },
    { id: '2', kind: 'NewSponsor', name: 'Member1', detail: 'Membership: Gold', platform: 'YouTube' },
    { id: '1', kind: 'Follow', name: 'Kicker', detail: 'Welcome', platform: 'Kick' },
    { id: '0', kind: 'Follow', name: 'Twitchy', detail: 'Welcome', platform: 'Twitch' },
    { id: 'demo', kind: 'Follow', name: 'Sample', demo: true },
    ...before
  ];
  assert.equal(L.collect(st, events), true);
  assert.equal(L.collect(st, events), false, 'events are counted once');
  let t = L.texts(st);
  assert.equal(t.latest_follower, 'Kicker');
  assert.equal(t.latest_subscriber, 'Member1');
  assert.equal(t.latest_gifter, 'Santa (5 gifted subscriptions)');
  assert.equal(t.latest_cheer, 'Bitsy (100 bits)');
  assert.equal(t.latest_superchat, 'BigFan (£20.00)');
  assert.equal(t.latest_donation, 'Tipper ($3.00)');
  assert.equal(t.latest_event, 'Tip: Tipper');
  assert.equal(t.latest_raid, '');
  assert.equal(t.session_follower_count, '2');
  assert.equal(t.session_subscriber_count, '1');
  assert.equal(t.session_gifted_count, '5');
  assert.equal(t.session_bits, '450');
  assert.equal(t.session_followers, 'Twitchy, Kicker');
  assert.equal(t.session_top_tip, 'BigFan (£20.00)');
  assert.equal(t.session_top_cheerer, 'Bitsy (250 bits)');
  assert(!Object.values(t).some(v => /secret chat/.test(v)), 'chat messages never go into labels');
  assert(!Object.values(t).some(v => /Sample/.test(v)), 'sample alerts are left out');

  // Own formats, the "nothing yet" text, and an empty amount leaves no "()".
  t = L.texts(st, {
    formats: { latest_follower: 'Follower: {name} on {platform}', session_bits: '{count} bits' },
    empty: 'None yet'
  });
  assert.equal(t.latest_follower, 'Follower: Kicker on Kick');
  assert.equal(t.session_bits, '450 bits');
  assert.equal(t.latest_raid, 'None yet');
  assert.equal(L.fill('{name} ({amount})', { name: 'A', amount: '' }), 'A');

  // A new stream: the "this stream" labels start from zero; the latest ones stay.
  st.session = L.newSession();
  t = L.texts(st);
  assert.equal(t.session_follower_count, '0');
  assert.equal(t.session_followers, '');
  assert.equal(t.latest_follower, 'Kicker');
  L.collect(st, [
    { id: 'r', kind: 'Raid', name: 'Raider', detail: '42 viewers', platform: 'Twitch' },
    ...events
  ]);
  assert.equal(L.texts(st).latest_raid, 'Raider (42 viewers)');

  // The files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-'));
  try {
    const user = path.join(dir, 'user'),
      docs = path.join(dir, 'docs');
    const labels = create({ userData: user, documents: docs, ids: L.IDS });
    assert.equal(labels.folder, path.join(docs, 'UniversalCollab', 'Stream Labels'));
    assert.equal(labels.write(L.texts(st)), L.IDS.length);
    assert.equal(fs.readFileSync(path.join(labels.folder, 'latest_raid.txt'), 'utf8'), 'Raider (42 viewers)');
    assert.equal(labels.write(L.texts(st)), 0, 'unchanged files are not written again');
    // Only known labels, only inside the folder.
    labels.write({ '../evil': 'x', other_name: 'x', latest_raid: 'R2' });
    assert.deepEqual(
      fs
        .readdirSync(labels.folder)
        .filter(f => !L.IDS.includes(f.replace(/\.txt$/, '')))
        .sort(),
      []
    );
    assert(!fs.existsSync(path.join(docs, 'UniversalCollab', 'evil.txt')));
    assert.throws(() => labels.fileFor('../x'), /Unknown label/);
    assert.equal(fs.readFileSync(path.join(labels.folder, 'latest_raid.txt'), 'utf8'), 'R2');
    // Another folder is remembered.
    const other = path.join(dir, 'obs labels');
    labels.setFolder(other);
    assert.equal(create({ userData: user, documents: docs, ids: L.IDS }).folder, other);
    assert.throws(() => labels.setFolder('relative/path'), /Choose a folder/);

    // Add to OBS: a Text source reading the file, in the current scene; a second time reuses it.
    const calls = [];
    let exists = false;
    const request = (kinds => async (type, d) => {
      calls.push([type, d]);
      if (type === 'GetInputKindList') return { inputKinds: kinds };
      if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: 'Live' };
      if (type === 'CreateInput') {
        if (exists) throw Object.assign(Error('exists'), { obsCode: 601 });
        exists = true;
        return {};
      }
      if (type === 'GetSceneItemList') return { sceneItems: [] };
      return {};
    })(['color_source', 'text_gdiplus_v3']);
    const r = await labels.addToOBS(request, { id: 'latest_follower', title: 'Latest follower' });
    assert.deepEqual([r.source, r.scene], ['Label: Latest follower', 'Live']);
    const made = calls.find(([t]) => t === 'CreateInput')[1];
    assert.equal(made.inputKind, 'text_gdiplus_v3');
    assert.deepEqual(made.inputSettings, {
      read_from_file: true,
      file: path.join(other, 'latest_follower.txt')
    });
    assert(fs.existsSync(path.join(other, 'latest_follower.txt')), 'the file exists before OBS reads it');
    await labels.addToOBS(request, { id: 'latest_follower', title: 'Latest follower' });
    assert(calls.some(([t, d]) => t === 'SetInputSettings' && d.inputName === 'Label: Latest follower'));
    assert(calls.some(([t, d]) => t === 'CreateSceneItem' && d.sceneName === 'Live'));
    // Linux / macOS OBS: the FreeType text source.
    calls.length = 0;
    exists = false;
    const ft = async (type, d) =>
      type === 'GetInputKindList' ? { inputKinds: ['text_ft2_source_v2'] } : request(type, d);
    await labels.addToOBS(ft, { id: 'session_bits', title: 'Bits this stream' });
    assert.deepEqual(calls.find(([t]) => t === 'CreateInput')[1].inputSettings, {
      from_file: true,
      text_file: path.join(other, 'session_bits.txt')
    });
    await assert.rejects(
      labels.addToOBS(async t => (t === 'GetInputKindList' ? { inputKinds: [] } : {}), {
        id: 'session_bits'
      }),
      /no Text source/
    );
    await assert.rejects(labels.addToOBS(request, { id: 'nope' }), /Unknown label/);
    assert.equal(sourceName('A\nB'), 'Label: A B');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS stream labels: events to texts, files written when changed, OBS Text sources.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
