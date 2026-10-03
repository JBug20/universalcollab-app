# UniversalCollab 0.6.2 desktop
Based on 0.4.2 layout revision (v1 source). Relay server remains 0.4.2 unchanged.
DesktopSource/platforms/service.cjs owns OAuth/network/chat. Dependencies injected
for tests. platforms/vault.cjs uses safeStorage atomic platform-accounts-v1.bin.
Main process exposes guarded platform-command IPC; platform-state is sanitized.
OAuth app IDs are user-configured, NOT bundled. Twitch Public DCF, Google Desktop
loopback PKCE. Sign-in must be tested with real registered clients by the user.
platforms-ui.js scopes platform tabs independently of portal.js server state.
Chat prefs universalcollab-chat-ui-v1. Local keys/install paths unchanged.
No 0.4.3 export/import implemented (user explicitly advanced to 0.5.0–0.6.2).
Tests mock API responses and use Chromium UI. Native OS/keyring and live OAuth
are unverified. Do not report these tests as live provider validation.
Source archive includes relay backend only to preserve full reproducible project.
Future custom panels, POV-only feeds, recording etc remain backlog.
