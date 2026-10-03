# 0.7.0 integration build
Source from saved 0.6.3. Native platform accounts remain in encrypted vault.
New platforms/studio.cjs owns custom connections and resumable provider drafts.
Native studio-command IPC prepares and commits credentials directly to saved
selected relay; returned snapshots omit keys. Twitch scope added read:stream_key.
Google scopes unchanged. Remote API tests mocked; live OAuth creation untested.
Server adds production plans per user; routing hashes/validates all destinations.
OutputHub receives one encoded MPEG-TS stream and sends to independent FFmpeg
stream-copy workers. Workers drop/restart on bounded backpressure; no unbounded
buffers or second video encoding. Shared picture/primary/fallback code retained.
Recordings optional host toggle false by default; metadata history always kept.
Raw MPEG-TS recorded incrementally and downloaded through scoped bearer endpoint.
New API /v3/production, /v3/recordings, /v3/recordings/:uuid/download,
/v3/recording-delete. Browser UI lacks native auth/studio IPC; desktop required.
Optional hostFeatures multipleDestinations true and recording false; root
recordings.maxStorageMB 1024/minFreeMB 256. Existing config preserved on upgrade.
Application UI now Stream/Social/Combined chat. Connections and Stream are editable
app panels. Old destination panel/order migrates into Connections; form retained
under advanced. Connections work offline. Server broadcasts retain switch locks.
Run studio-070.cjs, studio-ui-070.mjs, desktop-studio-070.mjs, studio-live-070.py,
platforms-062.cjs, platform-vault-062.cjs, portal-unit.mjs, canvas-063.mjs.
Legacy UI tests targeting removed Twitch/YouTube tabs need the new studio UI test.
Build from DesktopSource with existing Electron runtimes; no new npm dependency.
