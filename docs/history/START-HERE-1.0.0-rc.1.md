# UniversalCollab 1.0.0-rc.1

This is a release candidate built on 0.7.2. It includes the next roadmap features in one update. It is not a claim of platform approval or a fully verified public 1.0.0 release.

## Update your existing installation

1. End broadcasts, stop OBS and close the desktop app. Stop the relay in Bloom.
2. Back up the server's config.json and data directory. Keep your previous app installer/archive for rollback.
3. Extract UniversalCollab-ServerUpdate-1.0.0-rc.1.zip into the server root, replacing index.js and src. Keep config.json, data, vendor and fallback.png. Do not delete accounts or edit OBS keys. Main file remains index.js. No new ports or npm dependencies.
4. Start the server. Its first line should say UNIVERSALCOLLAB 1.0.0-rc.1.
5. Windows: run UniversalCollab-Setup-1.0.0-rc.1.exe. It is both a full installer and an in-place updater. Do not uninstall first.
6. Garuda/Linux: extract UniversalCollab-Linux-1.0.0-rc.1.tar.gz. Open a terminal inside UniversalCollab-Linux and run `bash install.sh`. Launch UniversalCollab from your menu. Do not delete app settings. The internal legacy installation path intentionally remains stream-relay to preserve existing settings.

Update BOTH server and app. Existing server accounts, OBS keys, destinations, saved platform logins and panel settings are retained. New host-feature options have defaults, so existing config files need no replacement. This archive is an update for a server already set up with FFmpeg and MediaMTX; the source archive includes install.mjs for new-server setup.

## New app features

- Fixed Move panel dragging: pointer capture stays on a stable page element; Escape or loss of focus cancels the drag cleanly. Arrow controls remain available.
- Edit app layout > Add panel now includes Custom tool. Enter a label and an HTTP(S) page URL. Up to 30 custom panels; duplicate URLs are allowed. Panels can be moved, hidden or deleted. Built-in panels still appear once each. Existing layout presets adapt when custom panels are added/removed.
- Embedded sites may block framing or sign-in. Open in browser is available. These are local workspace tools, not broadcast overlays. Their contents are controlled by the site; streamer mode cannot censor third-party page contents for you. Tool URLs are masked in the entry form.
- Encrypted settings backup is underneath the workspace controls. Use a password of at least 12 characters. Export creates a .ucbackup file containing saved servers, local profile, platform accounts/settings, custom destinations, workspace layout and presets. Restore replaces this device's saved settings after confirmation; it does not modify relay files. The password is not recoverable. Token refresh/revocation may require signing in again after restore. End streaming first and keep the desktop keyring unlocked.
- Stream history has separate Download and Delete recording buttons. Deletion requires confirmation and is limited to your own finalized recordings. Hosts can disable deletion.
- A host-gated health readout shows primary-feed availability, output frame-pump rate, selected source and uptime. Existing destination-worker and recording status remain visible. The FPS value measures the relay's frame pump, not FPS received by Twitch/YouTube or a CPU benchmark.
- Check stream readiness refreshes the server plan/mode/hold state and reminds you of required OBS codecs. Create & prepare retains the stronger platform-access, destination-save and read-back checks from 0.7.1. This button does not benchmark the host or prove that a disconnected OBS encoder is configured correctly.

## Collaboration and fallback

- PiP feeds now have NAME POV labels. An approved collaborator used as the main fallback has that name label too. Labels use registered server usernames, in uppercase, and may truncate in narrow tiles. Show POV names is saved with the stream layout. PiP remains silent; only the selected main feed supplies audio.
- Show fallback now switches your outgoing main feed to the first healthy, approved fallback in your list, or the reconnect image when none is available. Return to my feed restores normal selection. OBS can keep sending throughout. Approvals and host policy still apply. This toggle resets for a new broadcast.
- Stop after primary disconnects: set minutes underneath the stream layout, then save. 0 means manual end. The timeout counts while your primary feed is unhealthy, even if a collaborator is keeping the output live. A healthy returning primary resets it. Manually showing fallback while your primary is healthy does not start the timer.
- When the timeout or End stream ends a broadcast, stop OBS/auto-reconnect. The existing quiet-period rearm permits the same static OBS key to start a later broadcast. A manual End does not disable your account permanently.
- Social approvals offer Always allow and Approve for session. Session approvals end when either participating broadcast ends, when the relay restarts, or after 24 hours, whichever comes first. Persistent approvals remain until revoked. Requests do not give account-control access.

## Guest invitations (host opt-in)

Set `hostFeatures.guestInvites` to true in the server config and restart to enable invitations. Existing accounts can create a single-use invitation under Social > Guest invitations. Choose 5–1440 minutes. Expiry counts from creation, not redemption. Copy the masked invitation link and give it privately to your guest.

The guest can open the link in a browser to register, or paste it into the desktop Add server password field; the app extracts the server address and invitation. They choose their own server username and receive their own OBS credentials. After registration, the app remembers their personal login. Their account expires at the invitation deadline; a running guest broadcast is ended then. Revoking the invitation also ends an already-joined guest's broadcast. Guests cannot issue invitations themselves.

Guests still need their own prepared outgoing destination. A contributor with no destination is the separate POV-only feature, not part of this release. Expired guest accounts remain in the server data and count toward its account limit; automatic account cleanup is not implemented. Invitations do not automatically approve PiP or fallback sharing.

## Host controls

Add only the options you want to override inside the existing `hostFeatures` object. These are authoritative on the server:

| Option | Default | Controls |
| --- | --- | --- |
| registration | true | Normal account registration |
| pictureInPicture | true | Approved video overlays |
| collaboratorFallback | true | Approved fallback feeds |
| chatOverlays | true | Chat frames in outgoing video |
| multipleDestinations | true | Multiple targets per broadcaster |
| recording | false | Saving video to server disk |
| recordingManagement | true | Owner deletion of finalized recordings |
| povLabels | true | Labels in encoded output |
| manualFallback | true | Show fallback / restore primary |
| fallbackTimeout | true | User disconnect timeout |
| streamHealth | true | New health metrics exposed to the app |
| sessionPermissions | true | Issuing session-only approvals |
| guestInvites | false | Creating/redeeming guest invitations |

Turning off guestInvites prevents new invitations/redemptions; existing guests still expire on their deadlines. Disabling sessionPermissions prevents new session approvals; existing ones remain bounded by their original session/expiry. Recording storage is a shared total server quota, not a per-stream allocation. Local custom panels/backups are app functions and do not require server permission.

## Validation and remaining release work

Verified here:
- Real FFmpeg/MediaMTX with two healthy outgoing targets and one failed target, live PiP/chat pixels, approved fallback/revocation, manual fallback/restore without outgoing RTMP reconnection, primary disconnect timeout, session revocation, finalized recordings with video/audio, owner-only download/deletion.
- Chromium desktop/mobile UI: actual mouse dragging, panel presets, custom panels, platform failure/retry, secret masking, verified stream preparation, recording actions and active-stream locks.
- Native bridge with simulated OS services: encrypted backup export/restore, wrong password leaves settings unchanged, existing account recovery; route/token checks. Unit/API tests cover one-use invitations, guest expiry, owner revocation, host policy and persisted preferences.
- Existing Twitch/YouTube API and encrypted-vault regression tests use simulated platform responses.

Still required before calling this a verified public 1.0.0:
- Run the installers on actual Windows and Garuda desktops, including real OS keyrings and update-from-0.7.2 checks.
- Exercise Twitch/YouTube login, refresh, metadata, chat/moderation and multi-platform publishing with real accounts on this build.
- Finish public OAuth project setup/Google verification and choose release application credentials. This package retains your working local application settings; blank release defaults are deliberate.
- Test realistic high-resolution/60 FPS collaboration load and long recordings on the intended host. Small local video tests are not a capacity guarantee.
- Installer code signing/distribution decisions. These packages are unsigned.

A richer health dashboard, host-capacity benchmark, recording retention/admin cleanup and POV-only contributors remain outside this RC. API-Public-Release-Checklist.md explains the owner-side platform work. There is no automatic claim of Twitch/YouTube policy certification.

## Rollback

End broadcasts and stop the relay/app first. Restore your pre-update config.json and data backup together with the old server files. Re-run/extract the previous desktop package without deleting user data. If you created new custom panels or used encrypted backups, keep a copy before rollback; older versions do not expose those features. Do not roll back an actively running broadcast.
