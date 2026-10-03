# UniversalCollab 0.4.2
Based on 0.4.1. DesktopSource portal files are authoritative and mirrored to src.
Local visibility/compact workspace settings in universalcollab-workspace-v1.
Existing panel IDs/order key and install/userData identities unchanged.
Host policy src/host-features.mjs: registration, pictureInPicture, collaboratorFallback.
index.js validates then adds hostFeatures defaults, preserving config fields.
Policy merges legacy multi.collab.enabled / multi.pictureInPicture.enabled as caps.
PortalStore request/approve/settings gates, API pip-on/collab-on gates,
feed selection and effective runtime toggles enforce policy. Revocation allowed.
GET info and authenticated view carry capabilities. Missing means older server.
Saved disabled settings persist; layouts cannot introduce altered disabled choices.
Registration/login and direct API end/destination remain independent as documented.
Tests: tests/host-features-042.mjs, workspace-042.mjs, portal-unit.mjs,
desktop-bridge.mjs and server-store-041.cjs.
Next roadmap patch 0.4.3: settings export/import excluding secrets. Not implemented.
POV-only ingest remains side backlog. Do not add later roadmap items implicitly.

Layout revision: no workspaceSettings menu. editPanels controls addPanel, compactControl, resetPanels, panel-tools. panelCatalog lists fixed built-in IDs, already present entries disabled. × hides card, Add unhides same card. No cloning. Future custom panel types should allocate independent instance IDs without built-in singleton restriction. Tests workspace-042.mjs updated.
