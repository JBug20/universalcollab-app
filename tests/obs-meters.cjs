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
const events = [];
const quiet = new OBSLink(e => events.push(e));
quiet.close();
assert.deepEqual(events, [], 'closing a link that never connected must not report a disconnect');
quiet.ready = true;
quiet.socket = { close() {} };
quiet.close();
assert.deepEqual(events, [{ type: 'connection', connected: false }]);
console.log(
  'PASS OBS meter subscription is remembered for the next connection and updated live; failed retries stay quiet.'
);
