// OBS link: the meter subscription survives a reconnect, so the mixer bars keep moving.
const assert = require('node:assert/strict'),
  { OBSLink } = require('../DesktopSource/obs-link.cjs');
const link = new OBSLink();
assert.equal(link.subscriptions(), 1023);
link.subscribe(true);
assert.equal(
  link.subscriptions(),
  1023 | 65536,
  'meters requested before OBS connects must be included when it does'
);
const sent = [];
link.ready = true;
link.socket = { send: m => sent.push(JSON.parse(m)) };
link.subscribe(false);
assert.deepEqual(sent.at(-1), { op: 3, d: { eventSubscriptions: 1023 } });
link.subscribe(true);
assert.deepEqual(sent.at(-1), { op: 3, d: { eventSubscriptions: 1023 | 65536 } });
console.log('PASS OBS meter subscription is remembered for the next connection and updated live.');
