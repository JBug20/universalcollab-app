# Windows test checklist: 1.2.0-preview.2 to .4

Tick each box on a Windows PC with the "with OBS" installer. Everything here was tested in a simulated setup (fake OBS, relay and Stream Deck), not yet on real Windows. Write down anything that doesn't match, with a screenshot.

You need:
- the joined installer `UniversalCollab-Private-Setup-1.2.0-preview.2-with-OBS.exe`;
- a relay connection;
- at least two destinations, ideally Twitch plus YouTube or Kick;
- about an hour.

## 1. Install (preview.2)

- [ ] `join-installer.cmd` shows a SHA-256 ending in `…6c9ed`.
- [ ] Close UniversalCollab and the included OBS (tray icon → Exit) first.
- [ ] Run the installer. Windows may warn about an unknown publisher: choose More info → Run anyway.
- [ ] If UniversalCollab is still open, the installer asks you to close it, with Retry and Cancel.
- [ ] It installs to `%LOCALAPPDATA%\Programs\UniversalCollabPrivate`, the same folder as before.
- [ ] The Start menu has **UniversalCollab Private**; Settings → Apps shows **UniversalCollab Private Preview (with OBS Studio)**, version 1.2.0-preview.2.
- [ ] The app opens with your accounts, relay servers and layout as before.
- [ ] Help → About shows 1.2.0-preview.2.

## 2. OBS start-up and shut-down

- [ ] **Included OBS:** it starts in the tray and the app connects (OBS: Connected). No "Safe Mode" question appears, even after OBS was ended in Task Manager.
- [ ] **Your own OBS** (Settings → OBS → OBS to use → your own):
  - [ ] "Start my OBS with UniversalCollab" starts it in the tray.
  - [ ] "Close my OBS when UniversalCollab closes" closes it with the app.
- [ ] End your own OBS in Task Manager, then open it by hand. It does **not** ask about Safe Mode if UniversalCollab closed it.
- [ ] Open OBS by hand and choose **Safe Mode** when asked. Within about 20 seconds the notice line says "OBS is open but not accepting connections…". Reopen OBS normally: it reconnects and says "OBS connected."
- [ ] Close UniversalCollab, then open it again straight away while it's still closing OBS. There's no "Object has been destroyed" error, and the app opens once the old one has finished.

## 3. Streaming

- [ ] New stream with two or more destinations → Create & prepare → Start Stream: every destination goes green in Destination health.
- [ ] Hovering a Destination health icon shows kbps and fps; clicking it shows Restart and Pause.
- [ ] Kick stays connected (no reconnect loop).
- [ ] **Twitch quality check:**
  - [ ] Set Twitch to 720p while YouTube or Kick is at source size: a yellow warning appears under "Stream to".
  - [ ] Create & prepare then asks first.
  - [ ] Set all destinations the same: no warning.
- [ ] **Destination drop alert:** pause or end one destination on the platform side, or pull its stream key.
  - [ ] After about 20 seconds you hear two falling tones.
  - [ ] The notice line says "<platform> stopped receiving your stream".
  - [ ] Destination health shows the warning.
  - [ ] When it is back: a softer sound and "<platform> is receiving your stream again".
  - [ ] "Alert sound when a destination drops" turns the sound off.
- [ ] Stream controls on a short window (e.g. 1280×800): Destination health is not cut off; scroll if needed.

- [ ] **Readiness check** (Tools → Check stream readiness, or Stream controls ⋯ → Check readiness):
  - [ ] Before preparing a stream it says "Not ready" and lists what's missing.
  - [ ] Set OBS to an HEVC or AV1 encoder: it's listed under "Fix before going live". Set it back to H.264: it's ready.
  - [ ] Nothing in OBS or the relay changes just by checking.

- [ ] **Themes** (Settings → Appearance):
  - [ ] Try each theme. Text stays readable, warnings stay red/yellow/green, and the stream preview stays black.
  - [ ] The chosen theme is still there after restarting the app.
  - [ ] Dark purple puts everything back exactly.

## 4. Recording, clips and storage

- [ ] Start Recording, then stop: the file is in OBS's recordings folder.
- [ ] **Clip** saves the last 60 seconds; Show file opens it.
- [ ] **Recordings folder** (Tools → Recordings folder, or Settings → OBS):
  - [ ] Choose folder… picks a folder on another drive. The next recording and the next clip are saved there.
  - [ ] Open folder opens it in Explorer.
  - [ ] Typing a folder that doesn't exist yet creates it.
  - [ ] A folder you can't write to (e.g. `C:\Windows`) is refused with the reason.
  - [ ] Changing it while recording asks you to stop recording first.
  - [ ] "This PC" in the status bar then shows that drive.
- [ ] **Auto-record** (Settings → OBS, under the recordings folder):
  - [ ] With "Start recording when I start streaming" on, Start Stream also starts a recording, and Stop Stream stops it.
  - [ ] A recording you started yourself keeps going when the stream stops.
- [ ] **Keyboard shortcuts** (Tools → Keyboard shortcuts):
  - [ ] Turn them on. Ctrl+Alt+C saves a clip and Ctrl+Alt+R starts/stops recording, even while a full-screen game has focus.
  - [ ] A shortcut another program uses (e.g. one set in Discord) shows in red.
  - [ ] **AFK** (Ctrl+Alt+A, during a live relay broadcast with a collaborator chosen in End Relay ⚙ → fallback):
    - [ ] Viewers see the collaborator's stream, and the AFK banner shows.
    - [ ] Pressing it again, or I'm back, returns your stream.
    - [ ] Check what viewers see and hear on each platform.
  - [ ] Stream Deck AFK key (install the new 1.2.1 plugin) does the same and lights up while AFK.
- [ ] The status bar shows **This PC <free> free**, and the details show the drive and OBS's recordings folder. Try with OBS recording to a drive other than C: if you have one.
- [ ] **My storage** shows your relay allowance (needs the per-user storage relay change).
- [ ] Optional: fill a USB stick or a small drive below 10 GB and set OBS to record there. "This PC" turns yellow and the notice line warns once.

## 5. Stream Deck

- [ ] Install `UniversalCollab.streamDeckPlugin`.
- [ ] In Tools → Stream Deck: Enable, then Copy pairing token, then paste the token into a key.
- [ ] Start / Stop Stream, Record, Clip, OBS Scene, Relay Scene, Studio Mode, Transition, Mute and Stream Assist keys work and light up.
- [ ] Stop Stream and End Relay need a second press within 3 seconds.

## 6. Stream Assist and Kick receiver

- [ ] Assist shows Kick connected; alerts and chat sending work.
- [ ] Revoke the app in Kick → Settings → Connections. Within 5 minutes Assist shows "waiting for sign-in". Reconnect works. (Already passed.)

## 7. Automatic updates (needs JBug20 to publish 1.2.0-preview.3)

JBug20 attaches the three update files to a GitHub **pre-release** tagged `1.2.0-preview.3`:
- `UniversalCollab-app-1.2.0-preview.3.zip`
- `update-manifest.json`
- `update-manifest.json.sig`

Then:

- [ ] Help → Check for updates → Check now: "Version 1.2.0-preview.3 is downloaded". An **Update ready** button appears in the menu bar.
- [ ] Restart to update asks first. The app closes (OBS asks if it is streaming or recording) and reopens.
- [ ] Help → About shows 1.2.0-preview.3; accounts, servers and layout are unchanged.
- [ ] Help → Check for updates → **Settings backups** lists "Before updating to 1.2.0-preview.3".
- [ ] Change something small (e.g. move a panel), Restore that backup, and confirm: the app restarts with the old setting and says "Settings restored…".
- [ ] A second backup "Before restoring…" is listed; restoring it brings your change back.
- [ ] "Check for updates automatically" off: no check at the next start (on again afterwards).

## 8. Uninstall (optional, last)

- [ ] Settings → Apps → UniversalCollab Private → Uninstall removes the app and the Start menu shortcut.
- [ ] `%APPDATA%\Stream Relay` (accounts and settings) is still there.
- [ ] `obs-studio\config` (the included OBS's scenes) is still in the install folder.
- [ ] Reinstalling brings everything back.
