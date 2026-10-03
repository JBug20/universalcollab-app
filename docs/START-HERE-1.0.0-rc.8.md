# UniversalCollab 1.0.0-rc.8

Compact OBS-style UI, recovered from the saved rc.7 project. The desktop runtime remains byte-checked against rc.3. No registry or activation is required. Accounts, completed setup, preview preferences and saved relay scenes are retained; this version starts with the new compact panel arrangement.

## Install/update

Close the app first; do not delete saved settings.

- Windows: run UniversalCollab-Setup-1.0.0-rc.8.exe.
- Linux: extract UniversalCollab-Linux-1.0.0-rc.8.tar.gz and run `bash install.sh` inside its folder.
- Existing relay: stop it and back up config.json and the whole data folder. Extract UniversalCollab-ServerUpdate-1.0.0-rc.8.zip over its root. Preserve config.json, data, vendor, recordings and fallback.png; restart normally. This updates an existing server, not the future standalone installer.

## Setup

Only the setup screen appears on first launch. Steps: name; platforms; two OBS choices; two relay choices. Optional steps can be skipped. Settings → General can reopen setup.

Automatic OBS sync tries saved credentials, standard local OBS configuration, then localhost:4455. OBS must be running with WebSocket enabled. If it cannot connect, a pairing popup asks for port/password. Authentication is never disabled and the OBS configuration file is never modified. Manual mode keeps URL/key copying under Settings → Relay.

Join a relay opens nickname, address and password. The chosen display name supplies the account username; an advanced disclosure handles an existing account or different username. Eye buttons reveal the address/password. Make my own relay explains that the standalone installer is pending.

## Studio

Chat is left, the feed preview is center, stream controls are right. Four bottom docks hold OBS scenes, Relay scenes, Relay Sources and a vertical OBS audio mixer. OBS Sources starts hidden. OBS docks appear only while connected.

Drag colored title bars to move panels. Drag neighboring panel/section dividers to resize, or focus a divider and use arrow keys. Panels contains checkboxes, Add panel and Reset. Add panel also supports custom browser tools. No main-page scrollbar or panel corner resize grips. Content scrolls inside docks.

The purple settings gear is top-right beside your name. Settings and tools open in movable popups over the studio. Appearance is reserved for future themes; the Customize workspace menu has been removed.

Scenes and sources use compact bottom toolbars and right-click menus. Hover buttons for their names. Relay Sources lists frontmost items first; drag to reorder, toggle visibility and lock movement. New chat/friend POV objects start centered. The check mark below Relay Sources applies the layout. Scene switching applies the selected relay scene while connected.

OBS scenes control local OBS sources; Relay scenes arrange the shared outgoing feed. Optional OBS Sources supports visibility, lock, reordering, existing inputs, removal and transforms. New devices, encoders and plugin-specific settings remain in OBS.

## OBS/output

Automatic mode applies and verifies the relay URL/key on relay connection and New stream. New stream prepares destinations/metadata; it does not go live. Start Stream starts OBS after destination checks. Stop Stream stops OBS input; the relay may continue fallback. Stream controls → ⋯ → End relay broadcast ends that broadcast.

Settings → OBS → OBS connection settings includes pairing, secure remembering, reconnect, explicit disconnect and default-enabled retries every two seconds after pairing. Only one attempt runs at a time. Disconnect pauses retry. Credentials stay in the main process; optional persistence requires the OS keyring.

Settings → Fallback & output contains fallback and relay resolution. New layouts match the incoming OBS feed by default; explicit existing sizes are preserved. End the relay broadcast before changing output resolution. This does not change OBS's own canvas size.

The feed preview shows local OBS program screenshots without audio, not the final relay composite. Settings → Preview adjusts its width/rate or disables it. The default target is 640 pixels at 5 fps, with an optional 10 fps setting. It is not full 30/60 fps video. Requests are single-flight and pause when hidden.

The OBS mixer uses vertical meters/sliders and mute. Supported OBS video/recording settings are under Settings → OBS. Stop outputs before changing video settings.

## Chat

The chat gear opens display/filter/connection settings. The shield toggles supported moderation controls. Platform permissions still apply, and destructive actions need confirmation. Send to the selected platform using Enter or the arrow button. Messages are not automatically sent to every platform.

## Platform linking: application IDs still required

The recovered release has blank Twitch and YouTube application client IDs. Existing per-device configurations are preserved. Connect now calls browser authorization directly when configured; missing configuration produces a clear message instead of an unexplained grey button.

For new users to sign in, the owner must supply the app's registered Twitch Public client ID and Google Desktop OAuth client ID (plus the Desktop client secret if supplied). Populate DesktopSource/release-oauth.json and rebuild. These are application registration details, not personal passwords. Owner configuration is also available under Settings → Advanced → Application connections. Provider testing, consent and quota requirements still apply.

Kick, Restream and Rumble currently use RTMP URLs/keys. Their buttons open the website and a compact entry popup; opening the website alone does not link an account. Kick OAuth and automatic multistream disclosure remain future work, recorded in FUTURE-KICK.md. No unsupported endpoint or false success indicator was added.

## Existing features

The person-plus Collab button, +N incoming indicator, combined first-use explanation, mutual Collab and ongoing Super Collab remain. Approved feeds must still be added to a scene. PiP uses video; fallback can include the friend's audio.

Tools → Relay Admin is for the connected relay owner. Claim an unowned relay with data/host-setup-code.txt; there is no universal admin password. Remote admin requires HTTPS.

Advanced settings retain encrypted backups, preference reset and uninstall with warnings. Reset preserves accounts, names, scenes, permissions and completed setup. Uninstall does not remove OBS, server data or recordings.

## Verification limits

Browser tests exercise a real local relay with a mocked desktop bridge. Native Linux Electron tests use real preload/IPC and an OBS WebSocket protocol simulator. Platform tests simulate API responses; they do not prove live account approval. Real OBS devices/plugins, Windows installer execution, OS keyrings and live Twitch/YouTube streaming still need a check on your machine. This remains a release candidate.

Keep UniversalCollab-Owner-Source-PRIVATE-1.0.0-rc.8.zip private: it contains source and release signing keys. This guide supersedes historical UI instructions.
