# UniversalCollab 0.6.3
Based on 0.6.2 desktop + 0.4.2 relay; both now versioned 0.6.3.
New stream-canvas.js UI with main/PiP/chat geometry. X/Y retain prior normalized
available-space coordinates (x=1 anchors right). Width/height are canvas fractions.
Main is always background. Other items have integer z-order. One tile per peer;
no fixed two-tile limit; max registered peers/maxSessions still apply.
store settings: {main,overlays:[{publisher,corner,x,y,width,height,z}],
chatOverlays:[{source,x,y,width,height,z}],fallback}. Optional fields migrate.
Host setting chatOverlays defaults true. capabilities.streamCanvas=1 gates new UI.
HTTP /api/v3/chat-frame accepts authenticated bounded raw YUV420p base64 images
(up to 3 frames, one per saved chat source, <=512x768 even dimensions); no tokens
or messages are stored. Chat frames expire after 15 seconds. Desktop transmits
only while broadcast active and actual platform chats running, every 3–6 seconds.
Frame decoder is dependency-free: scaleFrame nearest-neighbor for static images.
Main scale changes restart only input decoder; output encoder remains continuous.
Session picture() composites active PiP and chat frames sorted by z.
Social panel groups migrate old six-panel order; existing hidden flags retained.
Local storage key universalcollab-panel-groups-v2; existing credential stores intact.
Platform integration is unchanged except tab routing and sanitized message events.
App registration IDs remain user-configured in encrypted desktop vault.

Verified:
node tests/portal-unit.mjs; tests/host-features-042.mjs; tests/desktop-bridge.mjs
node tests/canvas-063.mjs (real FFmpeg filter + encoder output pump)
Chromium tests/canvas-ui-063.mjs + tests/platforms-ui-062.mjs with mock bridge
python3 tests/canvas-live-063.py with actual MediaMTX/FFmpeg RTMP localhost:
register/destinations, approved PiP pixels, resized main/PiP/chat pixels, clearing
chat, unchanged output connection IDs, fallback, revocation, recovered primary.
Legacy workspace-042.mjs targets old tab structure, superseded by canvas-ui-063.
Native Windows install, real desktop keyring, high-resolution stress and external
platform streaming not tested. Keep performance claims limited to local test sizes.

Package:
ServerUpdate contains only index.js/src and guide; never replace config/data/vendor.
Source excludes bundled vendor binary; install.mjs retrieves pinned/checksummed MTX.
Existing Linux/Windows runtime reused. No new ports, no extra npm dependencies.
