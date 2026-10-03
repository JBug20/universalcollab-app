LAYOUT UPDATE (0.4.2)
All panel editing is now under Edit app layout.
Click × on a panel to hide it. Add panel lists every built-in panel; already
visible panels are marked Added and cannot be duplicated. Hidden panels return
to their saved positions. Reset panels restores all built-ins in default order.
Compact spacing is in the same edit toolbar. Choices stay local and work offline.
Existing visibility, compact spacing and panel positions carry over.
Future custom panel types may have multiple instances; they are not added yet.
No server streaming changes. Update the server only if you use its browser UI.

UniversalCollab 0.4.2

INSTALL / UPDATE
Close the app; do not uninstall.
Linux: extract UniversalCollab-Linux-0.4.2.tar.gz, open a terminal inside
UniversalCollab-Linux, run: bash install.sh
Windows: run UniversalCollab-Setup-0.4.2.exe (full installer and updater).
The existing installation/data paths stay unchanged. Saved logins, panel order,
server nicknames and permanent publisher keys are preserved.

LOCAL WORKSPACE
Click Edit app layout to hide panels with ×, restore them with Add panel,
and choose compact spacing. Reset panels restores visibility and default order.
These settings live on your device, work offline and apply across servers.
Hiding a panel does not disable a server feature or stop a broadcast.
Edit app layout still moves panels; server controls remain disabled offline.
Server switching remains locked during broadcasts/fallback or unknown state.

SERVER UPDATE
Update between broadcasts. Back up the server. Stop it, then upload CONTENTS
of Server-Update into the server root, replacing index.js and src/ files.
Leave config.json, data/, vendor/, fallback.png and all keys in place.
Restart; Main File is still index.js. This is an update, not a fresh server kit.
The new hostFeatures object is added to your existing config.json on startup:

"hostFeatures": {
  "registration": true,
  "pictureInPicture": true,
  "collaboratorFallback": true
}

Hosts can set each value to false; stop/restart the server to apply config edits.
registration: prevents new accounts; existing accounts still connect.
pictureInPicture: blocks new corner-feed requests/approvals and enabling PiP,
  and prevents saved corner feeds from being composed into output.
collaboratorFallback: blocks new fallback requests/approvals and enabling it,
  and uses the reconnect image when the main feed fails.
Existing multi.pictureInPicture.enabled and multi.collab.enabled false also
remain host restrictions. Set both the old switch and new switch true to enable.
Existing saved choices/approvals remain; re-enabling restores approved choices.
Users can still revoke/cancel permissions, end streams and change destinations.
These controls are enforced on the server, including for older desktop apps.
They do not disable basic reconnect-image fallback or ordinary streaming.
The app shows host-disabled features and disables corresponding controls.
Later features (recording, multi-destination, guest links, platform integration)
are not part of this patch; no misleading switches for unimplemented features.

COMPATIBILITY / VALIDATION
Desktop local settings also work with previous servers; host-feature enforcement
requires the 0.4.2 server update. Older servers display an availability notice.
Browser profiles/layouts remain site-local. Desktop supports multiple servers.
Automated API policy, account migration, IPC and browser tests passed, including
fallback switch lock, disabled features and offline workspace persistence.
No live multi-stream encoding stress test, native Windows installation or actual
OS-keyring migration was run in this build environment. Installer is unsigned.
