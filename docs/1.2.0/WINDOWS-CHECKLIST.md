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

- [ ] **Edit OBS scene on screen** (OBS sources → Edit on screen…, or Tools → Edit OBS scene on screen):
  - [ ] The scene's picture shows with a box around each visible source, in the same places as in OBS.
  - [ ] Drag a source: it moves in OBS too. Near an edge, the centre or another source it snaps (yellow line); hold Ctrl to place freely.
  - [ ] Drag a corner handle: it keeps its shape. Hold Shift: it stretches. Edge handles stretch one side.
  - [ ] Alt+drag a handle: it crops, like Alt in OBS.
  - [ ] Right-click: Fit to screen, Stretch, Centre, Rotate 90°, Flip, Reset, Bring forward, Send backward, Hide and Lock all match OBS.
  - [ ] Arrow keys nudge 1 px (Shift: 10 px); Ctrl+Z undoes the last change.
  - [ ] Lock a source (🔓 → 🔒): it can't be moved here or in OBS. Rotated sources move but are not resized by handles.
  - [ ] Edit a scene that is not live (e.g. BRB): the stream does not change.

- [ ] **Relay layout handles** (Stream layout): select an item; it has 8 handles. Corners keep the shape, Shift stretches, edges stretch one side and snap. Right-click: Fit to screen, Stretch to screen, Centre horizontally / vertically, Undo. Ctrl+Z undoes moves and resizes.
- [ ] **Post-stream report:** end a relay broadcast. The report pops up with length, drops, dropped frames, peak viewers, markers and clips, and "Stream report <date> <time>.txt" is next to your recordings. Tools → Stream reports shows it again.

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
- [ ] **Recording scene** (Settings → OBS → Recording scene; needs the Source Record plugin):
  - [ ] Without the plugin: it says Source Record is not installed, and **Get Source Record** opens its page. Install it with OBS closed, start OBS, then **Check again** says it is installed.
  - [ ] Make a second scene in OBS (e.g. "Recording" without alerts or chat). Choose **The recording scene only** and that scene.
  - [ ] Stream the other scene and press Start Recording (button, Stream Deck or Ctrl+Alt+R). The status bar shows REC. Stop Recording: the file in the recordings folder ends in "Recording scene" and shows the recording scene, not the stream.
  - [ ] The recording-scene file has sound: your mic and desktop audio, the same as the stream (Recording sound → Same as the stream). Try another track or "Only sources inside the recording scene" too.
  - [ ] **Both, as two files** saves the normal recording and the recording-scene file.
  - [ ] The choices are greyed out while recording.
  - [ ] Auto-record with the recording scene chosen records the recording scene.
  - [ ] Quit UniversalCollab while recording the recording scene: it asks first, and the file plays afterwards.
- [ ] **Pause and split** (needs OBS 30 or newer):
  - [ ] While recording, **Pause** appears next to Stop Recording. Pause → the status bar shows REC PAUSED; Resume carries on in the same file. Ctrl+Alt+P and the Stream Deck Pause key (lit while paused) do the same.
  - [ ] Recording scene only, and Both: pause pauses both files.
  - [ ] Settings → OBS → "Start a new recording file every" 30 minutes: after 30 minutes a second file starts with no gap. If OBS says it can't, follow the message (Advanced output → Automatic File Splitting → Split Manually) and try again.
- [ ] **Stream markers:** during a broadcast press **Mark** (next to Clip), Ctrl+Alt+K or the Stream Deck Mark key.
  - [ ] The notice line says "Marker 1 at stream 0:12:34, recording …".
  - [ ] Twitch: the marker shows in the Twitch dashboard (Stream Manager → markers, or the VOD).
  - [ ] Recording in Hybrid MP4: the marker is a chapter in the file (e.g. VLC → Playback → Chapter).
- [ ] **Vertical clips** (Settings → OBS → Vertical clips, recording format MP4 or Hybrid MP4):
  - [ ] Turn on, Layout "Facecam on top": it names your webcam source.
  - [ ] Press Clip: after about as long as the clip, "Vertical clip saved: … (vertical).mp4". It is 1080 × 1920, the facecam is on top, the gameplay below, and it has sound.
  - [ ] Press Clip three times, a few seconds apart. The line under Clip shows "Making the vertical copy: 0:42 of 1:00 · 2 more waiting", and all three vertical copies are made, one after another.
  - [ ] If one is not made, the line under Clip says why. Send `%APPDATA%\Stream Relay\vertical-clips.log`.
  - [ ] Try "Whole picture over a blurred background" and "Centre of the picture".
  - [ ] With MKV recordings it says to switch to MP4.
- [ ] The status bar shows **This PC <free> free**, and the details show the drive and OBS's recordings folder. Try with OBS recording to a drive other than C: if you have one.
- [ ] **My storage** shows your relay allowance (needs the per-user storage relay change).
- [ ] Optional: fill a USB stick or a small drive below 10 GB and set OBS to record there. "This PC" turns yellow and the notice line warns once.

## 5. Stream Deck

- [ ] Install `UniversalCollab.streamDeckPlugin`.
- [ ] In Tools → Stream Deck: Enable, then Copy pairing token, then paste the token into a key.
- [ ] Start / Stop Stream, Record, Clip, OBS Scene, Relay Scene, Studio Mode, Transition, Mute and Stream Assist keys work and light up.
- [ ] Stop Stream and End Relay need a second press within 3 seconds; the first press shows "Press again" on the key.
- [ ] **Live key (plugin 1.2.4):** while live, a press (and the second press) ends the whole broadcast: OBS stops and the relay broadcast ends. The notice line says "Stream Deck · Stop Stream: …".
  - [ ] In the key's settings, "When stopping → Stop OBS only" stops OBS but leaves the relay on your fallback.
  - [ ] Untick "Needs a second press to stop": one press stops.

## 6. Stream Assist and Kick receiver

- [ ] Assist shows Kick connected; alerts and chat sending work.
- [ ] Revoke the app in Kick → Settings → Connections. Within 5 minutes Assist shows "waiting for sign-in". Reconnect works. (Already passed.)

## 6b. End credits and alerts (Tools → End credits & alerts)

- [ ] Copy credits link. In OBS: Sources → + → Browser → paste it as the URL, 1920 × 1080. The credits roll with your title.
- [ ] Copy alerts link and add it the same way. Send a test alert: the card shows on stream with a chime.
- [ ] To hear the chime on stream, tick "Control audio via OBS" on the browser source.
- [ ] During a stream with Stream Assist running:
  - [ ] Real follows, subs, tips, raids and chatters appear in the credits under their headings, each name once.
  - [ ] Each real event (except chat) pops up on the Alerts overlay.
- [ ] Starting a new relay broadcast starts a new list.
- [ ] Optional: add the credits link to the relay layout as a browser source; it shows in the relay picture.

## 6c. Go-live announcements (Tools → Go-live announcements)

- [ ] In Discord: Server Settings → Integrations → Webhooks → New Webhook → pick a channel → Copy Webhook URL. Paste it and Save webhook: it says "connected", and the link is not shown again.
- [ ] Send test post: the message appears in that channel.
- [ ] Add your Twitch/YouTube/Kick links. The Preview line shows the message with them.
- [ ] Start a relay broadcast: the "You are live: post on Discord?" window appears once. Edit the text, Post to Discord: the edited text is posted.
- [ ] Ping → @here or a role (Role ID from Server Settings → Roles → ⋯ → Copy Role ID): the post pings only that.
- [ ] Next broadcast: Skip posts nothing.
- [ ] "Also post when the broadcast ends" on: End Relay posts the end message.
- [ ] Delete the webhook in Discord, then post: the app says the webhook no longer exists.

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
