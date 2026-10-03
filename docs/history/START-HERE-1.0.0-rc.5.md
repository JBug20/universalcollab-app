# UniversalCollab rc.5 — UI rebuilt from rc.3

This replacement starts from the saved rc.3 source and desktop runtimes. It does not reuse rc.4's UI shell. The rc.3 media engine, platform integration services, server credential store and local profile store are preserved. The release number is rc.5 to distinguish the replacement from both the unchanged rc.3 rollback and the rejected rc.4 build.

A packaging defect was confirmed in rc.4's Linux archive: its Electron executable was truncated (165,885,952 bytes instead of rc.3's 228,740,424). The Windows executable was also truncated: 188,743,680 bytes instead of rc.3's 246,236,160, and exactly matched its beginning. Both rebuilt runtimes use the intact rc.3 files. Runtime files are checked against the baseline, and the Linux app is launched in Electron with its actual preload and IPC services.

## Update safely

End broadcasts, stop OBS and close the desktop app. Stop the relay. Back up config.json and the entire data directory before updating.

- Windows: run UniversalCollab-Setup-1.0.0-rc.5.exe. Do not uninstall or delete your saved app settings first.
- Linux: extract UniversalCollab-Linux-1.0.0-rc.5.tar.gz. Inside UniversalCollab-Linux run `bash install.sh`, then launch the app.
- Relay: extract UniversalCollab-ServerUpdate-1.0.0-rc.5.zip into your existing relay root, replacing the included files. Keep config.json, data, recordings, vendor and fallback.png. Start the relay with its existing command.

Update both app and relay for mutual Collab/Super Collab. The desktop can still connect to rc.3 and access its existing streaming controls; the new mutual permissions need the relay update. No registry or activation is required.

Saved credentials and platform logins use the same stores as rc.3. The new workspace and scenes use separate uc-ui5 preferences, so rc.4 layout settings cannot break the new UI. Existing rc.3 custom workspace tools are retained. Backups include the new UI preferences.

## Setup and studio

The first launch walks through name → platform connections → automatic/manual OBS setup → join or host a relay. You can skip optional steps. Forms stay in the same document locations throughout setup and normal use. Platform authorization still uses the existing Twitch/Google application configuration; no new OAuth project credentials are bundled.

After setup, Studio shows scenes on the left, the placement editor in the center, and streaming/fallback/chat controls on the right. Add item opens a picker for chat and approved friend POVs. New items start centered. Right-click an item to lock/unlock it; locking prevents dragging, resizing and removal. The preview is a placement editor, not a live video monitor.

Create, duplicate, rename, delete and switch scenes. Scenes save per relay/account on this device. Apply scene to relay sends edits. Switching a scene while connected applies it to the relay; if the request fails, the editor restores the previous scene. On reconnect, a saved scene loads for preview and does not automatically replace the running relay layout. Unapproved/unavailable friend feeds are omitted.

Customize lets you move/hide/resize panels, choose a wider canvas, save/load workspace presets, add custom browser tools, and reset the layout. To move the Collab button, unlock panel movement, close Customize and drag it. Workspace tools are local panels, not broadcast overlays. Some external sites do not permit embedding.

Connections & settings contains saved servers, platform connections, OBS setup and encrypted backup controls. The add-server address/password fields have eye buttons. Sensitive fields hide again when the window loses focus. A startup problem displays an error and a Reset studio layout action; that reset keeps saved servers, platform credentials and scenes.

## OBS

Manual mode keeps the existing rc.3 URL/key copy workflow. For automatic mode, enable OBS's local WebSocket server and enter its port/password. Connect OBS, join your relay, then choose Apply relay URL and key to OBS. OBS and the relay broadcast must be stopped before changing the destination. The app verifies the applied values and stores the previous destination for restoration using the operating-system keyring. Remembering the OBS password is optional. Start OBS verifies the selected relay destination first. Automatic OBS loads only when requested; a failure cannot prevent ordinary app startup.

## Collab and Super Collab

The floating person-plus button pulses and displays +N for incoming requests. A single combined explanation appears on its first opening. It explains regular Collab and Super Collab; no second explanation interrupts Super Collab acceptance.

A Collab request must be accepted by the recipient. It grants mutual permission for PiP video and fallback. PiP is video only; fallback may include the selected feed's audio. Approval does not add a feed or enable fallback automatically. Regular permissions end when either broadcast ends, the relay restarts, either person revokes them, or after a maximum 24 hours.

After regular Collab is active, either person can request Super Collab. The other person must accept; permission then persists across sessions/restarts until either ends it. Existing individual rc.3 permissions remain available in the menu's Earlier individual permissions section. The server remains authoritative for permission checks.

## Relay Admin

Connect as the existing owner to see the Relay Admin tab. To claim an unowned relay, connect an account, open Connections & settings → Relay admin access and enter the code from data/host-setup-code.txt. There is no universal admin password. Owner controls include members/guests, invitations, feature switches, capacities, quotas, broadcast end/rearm and owner-token rotation. Remote administration still requires HTTPS.

## Verification and limits

Checks include fresh onboarding, saved-account reconnect, platform form access, eye buttons, one-time warning, incoming badges, regular and Super Collab, centered/locked items, scene persistence/switching, workspace movement and owner controls in Chromium against a real local relay. The packaged Linux runtime is launched in Electron, with actual preload/IPC, to exercise onboarding, profile storage, settings and restart. OBS authentication/configuration uses a local protocol simulator. Relay tests cover authorization, persistence, old licensing removal and local FFmpeg/RTMP media behavior. Release checks verify signed assets and runtime bytes against rc.3.

This is a replacement release candidate, not a claim that every user's environment is verified. Windows installer execution, real OBS configuration and live Twitch/YouTube end-to-end use still need testing on your machine. The server installer is not built yet; the hosting choice displays that clearly. The canvas does not show live video.

If you want the untouched rc.3 back, close the app and install the original rc.3 desktop package. For a relay rollback, stop the relay and restore the matching pre-update config/data backup along with rc.3 files. Keep recordings separately. Do not delete credential files to reset the interface.

Keep UniversalCollab-Owner-Source-PRIVATE-1.0.0-rc.5.zip private: it contains development source and release-signing keys. Historical handoff files in that source may describe older releases; this guide is the current reference.
