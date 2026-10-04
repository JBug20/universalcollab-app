# UniversalCollab desktop 1.2.0-preview.1 (experimental)

This brings the 1.2.0 desktop work onto `experimental`, merged with the fixes already on this branch (mixer meters, End Relay controls, layout sources kept on save, quiet OBS retries, review fixes). Several features need the matching private relay (1.2.0); with an older relay the app says so and keeps working.

## Layout editor
- Text, picture and browser-page sources, edited in a source settings window (no `prompt()` boxes). With a 1.2.0 relay they are drawn into the outgoing stream; pictures are stored on this PC by checksum; browser pages are captured as ~1 fps snapshots in an isolated, sandboxed off-screen window.
- Offline drafts: the editor works without a relay and offers to apply the draft when you connect.
- Snapping with guides (hold Alt to place freely), corner placement and a 2×2 split from the right-click menu.

## Preview
- Live OBS preview through the OBS Virtual Camera (OBS 28+): real-time program output, before and during streaming. Starts the virtual camera only if it is off and stops only what it started. Falls back to snapshots. Camera permission is granted only to the app's own page, video only.
- During a relay broadcast the preview shows the relay's outgoing video, with stall/ended recovery.
- The display process restarts itself after a crash or hang instead of leaving a blank window (`renderer-problems.log` in the app data folder).

## Streaming
- Per-destination quality: size (Source, 1440p, 1080p, 900p, 720p, 480p, 360p), bitrate (Auto or 1.5–20 Mbps) and frame rate. Source = exact copy, anything else is re-encoded on the relay; Twitch rows warn above 1080p / 8 Mbps.
- End Relay asks once, then ends the relay broadcast and stops OBS streaming.

## Relay owner tools
- Server health panel: relay CPU (against its own container limit), memory, upload, disk, each broadcast's real frame rate, destination state and warnings.
- One-click relay ownership (Tools → Relay Admin → Make me the owner). The PC keeps an Ed25519 owner key (encrypted by the OS); owner requests are signed, so they are safe over http://. Without the setup code only the first account on the relay may claim it.
- In-app relay updates (owner only) when the app carries a relay release. This repository does not include relay code, so builds from it show "This app does not include a relay update"; update the relay with the server update zip.

## Studio mode
- Stream controls → Studio Mode (or View → Studio mode). The layout area splits into Preview (the editor) and Program (what is on the stream), with a Transition button between them, like OBS.
- Relay: layout edits and relay scene switches stay in Preview. Saving settings (fallback, auto-end timer) keeps the live layout. Transition (or ✓ in the Sources panel) sends Preview to the relay. The scene on stream is marked LIVE in Relay scenes. Program shows the relay video while broadcasting, otherwise OBS program output with outlines of the live layout.
- OBS: the same switch turns on OBS's own studio mode. OBS scene buttons pick the preview scene (the program scene is marked LIVE), the editor shows the OBS preview scene, and Transition runs the OBS transition too. Turning studio mode on or off in OBS is followed by the app.
- Changing the output resolution (only possible while not live) applies the Preview layout as well.
- The choice is remembered on this PC.
- Preview and Program sit side by side and level with each other, filling the layout panel. Transition sits in the panel's title bar.

## Edition with OBS included (Windows)
- `build/package.py` now also makes a second Windows app, `windows-app-with-obs`, and `installer-with-obs.nsi` when `release-runtime/obs-windows` holds the extracted official OBS Studio x64 zip (plus `OBS-VERSION.txt`). Without that folder only the standard build is made, unchanged.
- The included OBS lives in `obs-studio` next to the app, runs in portable mode (its settings stay in that folder), and is set up by the app: WebSocket on port 4466 with a generated password, no first-run wizard, no self-updates, starts in the system tray. A Display Capture is added to the empty first scene.
- The app starts it, connects automatically and closes it on exit. If OBS is still streaming or recording when the app quits, it asks whether to stop or keep OBS running.
- Settings → OBS → OBS connection settings: choose the included OBS or your own; Open OBS window (for filters, plugins, advanced settings); Close included OBS. Users who had already paired their own OBS keep it until they switch.
- `build/get-obs.py` downloads the official OBS Studio 32.2.2 Windows x64 zip, checks its published SHA-256 and extracts it to `release-runtime/obs-windows`.
- OBS 32 offers Safe Mode (WebSockets off) after an unclean exit; the app clears OBS's leftover run markers before starting it.
- `build/build-installers.cmd` (Windows) runs get-obs.py, package.py and makensis for both installers in one go.
- `OBS-STUDIO-NOTICE.txt` in the build states the OBS version, its GPL licence and where its source is.
- Standard builds have no `obs-studio` folder and behave exactly as before.

## Stream Assist
- Integrated Stream Assist panel, docked at the bottom of the studio (movable, scrollable).
- Windows: uses the Stream Assist engine (`assist-engine/CollabAssistEngine.exe`), which is not part of this repository.
- Linux: `assist-linux/` runs UniversalStream Assist for Linux as the integrated engine (same executable, started with `--uc-assist-engine` by `start.cjs`): combined chat, sending, alerts, sample alerts, Connections and the other settings pages. Accounts need an unlocked desktop keyring; YouTube needs your own Google Desktop credentials JSON (`release-google.json` is not committed).

## Other
- Electron entry is now `start.cjs` (it chooses between the app and the Linux Assist engine).
- Backups include the new layout and workspace keys.
- `release-oauth.json` keeps blank client IDs.

## Tests
New: `desktop-modules-120`, `assist-controller-120`, `assist-spawn-120`, `assist-ui-120`, `full-ui-120`, `inline-video-120`, `live-preview-120`, `layout-sources-ui-120`, `owner-health-ui-120`, `relay-video-recovery-120`, `obs-preview-resolution`, `status-timers-120`, `studio-mode-120`, `obs-studio-ops-120`, `bundled-obs-120`, `bundled-obs-ui-120`. Tests that need the relay are skipped unless `universalcollab-relay` is checked out next to this repo; `owner-health-ui-120` also needs FFmpeg and downloads MediaMTX (or set `MEDIAMTX_ARCHIVE`). Updated for 1.2.0: `studio-rc8` (text sources use the settings window), the four main-process tests (fuller Electron mock in `tests/helpers/electron-stub.mjs`).

## Not verified yet
- Real Windows run of the merged app, the Windows Assist engine, the installer.
- Linux Assist with a real keyring and real accounts; Linux build from `build/package.py`.
- Build version: `build/package-rc2.py` and `windows-installer.nsi` still say 1.0.0-rc.8.
