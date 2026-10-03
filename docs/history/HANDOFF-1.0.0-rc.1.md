# Release candidate handoff
Based on recovered 0.7.2. New modules: src/pov-label.mjs, DesktopSource/backup.cjs,
DesktopSource/release-ui.js (mirrored under src), DesktopSource/release-oauth.json.
Host policy defaults added in src/host-features.mjs. Account schema remains version1,
with optional db.invites, user.guestExpiresAt/invitedBy, request.scope/expiresAt and
settings.fallbackTimeoutMinutes/povLabels. Existing fields and keys preserved.
No new npm dependencies or public ports.

Manual fallback is ephemeral per session. PrimaryMissingSince counts unhealthy primary,
not selected fallback. Timeout calls existing end/hold path. End revokes session permissions.
Guest expiry enforced by HTTP authentication, RTMP auth and polling active sessions.
All new control mutations owner-scoped. Guest credentials never included in public views.
Labels are cached YUV bitmap frames; primary/fallback labels below overlay layers.
Output health reports frame-pump rate, not receiver performance.

Custom browser panels stored in universalcollab-tools-v1; existing panel layout engine
handles dynamic IDs, presets tolerate additions/deletions. Stable document pointer capture
fixes dragging reparented cards. Embedded tools are sandboxed HTTP(S) frames, no webviews.
Backup uses AES-256-GCM plus scrypt; secrets handled by native bridge with OS dialogs,
never returned to renderer. Workspace strings whitelisted; restored accounts remain
in existing OS encrypted vault. Public release OAuth defaults blank; see API checklist.

Validation commands from project parent:
node universalcollab-next/tests/release-unit.mjs
node universalcollab-next/tests/release-api.mjs
node universalcollab-next/tests/release-native.mjs
node universalcollab-next/tests/studio-071.cjs
node universalcollab-next/tests/platforms-062.cjs
node universalcollab-next/tests/platform-vault-062.cjs
node universalcollab-next/tests/portal-unit.mjs
node universalcollab-next/tests/host-features-042.mjs
node universalcollab-next/tests/preferences-migration.mjs
PLAYWRIGHT_MODULE=<playwright module> CHROMIUM_PATH=<chromium> node universalcollab-next/tests/release-ui.mjs
python3 universalcollab-next/tests/release-live.py

The media test requires existing vendor/mediamtx and ffmpeg/ffprobe. Uses loopback only.
Desktop API tests mock Electron/OS; live platform APIs and actual Windows installer
execution not tested here. See release guide for limitations and remaining1.0 release gates.
Build recipe in build/package.py takes existing Electron runtimes via RUNTIME_ROOT;
makensis builds the one-time Windows installer/updater. No user's credentials bundled.
