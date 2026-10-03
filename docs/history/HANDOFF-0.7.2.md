# Implementation handoff
0.7.1: StudioService.prepare preflights selected accounts, resumes known resources,
accepts edited metadata, filters selected targets and emits sanitized progress.
Main IPC clears saved targets before preparation, commits and verifies a draft ID.
Verified-production capability is 2 (required by app). New production-clear route.
No implicit Restream in bootstrap or account creation. parsePublisherPath accepts
only permanent three-part paths. Existing explicit single destinations survive.
0.7.2 adds app presets inside panel editor and server-account-scoped canvas presets.
App presets in universalcollab-app-presets-v1, canvas in universalcollab-stream-presets-v1.
No new external dependencies. Preserve install paths for existing vault/localStorage.
Run tests/studio-071.cjs, routing-071.mjs, desktop-studio-071.mjs,
studio-ui-072.mjs, studio-live-070.py, platforms-062.cjs, platform-vault-062.cjs,
portal-unit.mjs and host-features-042.mjs. Earlier version UI/unit fixtures are
historical and may target their original workspace or obsolete routing behavior.
UI test requires PLAYWRIGHT_MODULE and CHROMIUM_PATH. Media test needs vendor/mediamtx.
Build script in build/package.py uses existing local Electron runtime directories;
portable source archive does not include Electron or MediaMTX binaries.
Remaining roadmap and validation limits are in START-HERE-0.7.2.txt.
