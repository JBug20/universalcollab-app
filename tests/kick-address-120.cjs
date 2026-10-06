// Kick (Amazon IVS) addresses from Kick's dashboard or sign-in lack the RTMP app; they are completed to
// rtmps://host:443/app so the relay sends the key as the stream name, as OBS's Kick preset does.
const assert = require('node:assert/strict');
const { target } = require('../DesktopSource/platforms/studio.cjs');
const host = 'rtmps://fa723fc1b171.global-contribute.live-video.net';
const kick = { url: host + ':443/app', key: 'sk_us-west-2_test' };
assert.deepEqual(target(host, 'sk_us-west-2_test'), kick);
assert.deepEqual(target(host + '/', 'sk_us-west-2_test'), kick);
assert.deepEqual(target(host + ':443/app/', 'sk_us-west-2_test'), kick);
assert.deepEqual(target(host + '/sk_us-west-2_test'), kick, 'a combined URL keeps the key out of the app');
// Other services are unchanged.
assert.deepEqual(target('rtmp://live.twitch.tv/app', 'live_1'), {
  url: 'rtmp://live.twitch.tv/app',
  key: 'live_1'
});
assert.deepEqual(target('rtmps://a.rtmps.youtube.com/live2', 'a-b'), {
  url: 'rtmps://a.rtmps.youtube.com/live2',
  key: 'a-b'
});
console.log('PASS Kick addresses get the IVS app path; other services unchanged.');
