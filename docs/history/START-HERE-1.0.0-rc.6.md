# UniversalCollab 1.0.0-rc.6

This update builds on the working rc.5 UI and preserves the rc.3 relay media engine, saved account stores, collaboration permissions, and existing scenes. No registry or activation is required.

## Install or update

Close the desktop app before replacing it. Keep your existing saved settings.

- Windows: run `UniversalCollab-Setup-1.0.0-rc.6.exe`.
- Linux: extract `UniversalCollab-Linux-1.0.0-rc.6.tar.gz`, open its folder and run `bash install.sh`. Launch UniversalCollab from your application menu. The existing installation and saved preferences are reused.
- Relay: stop the relay and back up `config.json` and its entire `data` directory. Extract `UniversalCollab-ServerUpdate-1.0.0-rc.6.zip` over the relay root. Keep config.json, data, recordings, vendor and fallback.png. Restart with the same command.

The server update includes the matching browser UI and mutual Collab support. OBS control is available only in the desktop app. Your OBS installation must already be running.

## First launch and settings

The first launch asks for your name, platform connections, automatic/manual OBS setup, and relay choice. Optional steps can be skipped. Completing setup persists across app restarts and upgrades from rc.5. Settings → General → Run initial setup again reopens those steps without erasing accounts.

Settings are grouped into General, Platforms, Relay, OBS, Preview, Appearance and Advanced. Platform connections, saved relay accounts and encrypted backup controls retain their existing behavior. The OBS “Remember securely on this device” checkbox now has a normal compact size and label alignment. Eye buttons reveal the server address and passwords temporarily.

The standalone relay server installer is still not available. The hosting choice explains that; use an existing relay in the meantime. Twitch/YouTube authorization continues to use your existing application configuration; new OAuth credentials are not included.

## Automatic OBS setup and Start Stream

1. In OBS, enable Tools → WebSocket Server Settings.
2. In UniversalCollab Settings → OBS, select Automatic and enter the local WebSocket port/password. Click Connect OBS. Remembering the password is optional and requires your operating-system keyring. Reconnect saved OBS uses an existing saved password.
3. Connect to your relay. UniversalCollab automatically applies and reads back its permanent URL/key. New Stream also retries this setup. There is no separate Apply URL/key button.
4. Use New Stream to choose destinations and metadata, then Create & prepare. This does not go live. Once ready, click **Start Stream** to configure/verify OBS and start broadcasting. OBS opens separately; this button starts its stream.

Start Stream checks the selected relay and saved destinations. A new draft must be prepared before the button becomes available again. The app will not change a different destination while OBS is streaming. Stop Stream stops OBS input; the relay may continue its fallback until you end the relay broadcast. The existing End my stream action ends the relay broadcast.

Manual mode retains URL/key copy controls under Settings → Relay. If OBS is connected in manual mode, Start Stream verifies that its destination already matches; it does not replace it. If OBS is disconnected, start streaming directly in OBS.

Restore previous OBS destination restores the destination captured before it was changed. It is available for the current app session even without a keyring; an unlocked keyring also persists it. Automatic setup can replace it again on a later relay connection or New Stream action.

## OBS controls on Studio

OBS panels appear only while OBS is connected. They can be moved or hidden in Customize like other panels.

- OBS scenes: switch the program scene; create, rename and delete scenes.
- OBS sources: choose a scene, show/hide or lock sources, reorder them, add an existing input, remove a scene item, and edit position, scale and rotation. Unlock a source before changing its transform. Creating new capture devices and plugin-specific properties remains in OBS.
- OBS audio mixer: live level meters, volume and mute for supported audio inputs. Changes affect OBS audio.
- Start/Stop Recording controls local OBS recording, separately from relay recording.
- Settings → OBS: canvas/output resolution, fractional FPS and recording directory. Stop all OBS outputs before changing video settings. Advanced encoders, filters, devices and plugin settings remain in OBS. Unsupported requests report a clear error.

**OBS scenes** compose your sources before they reach the relay. **Relay scenes** arrange your main feed, chat and approved friend POVs in the relay output. They are separate lists.

## Optional OBS preview

Your main feed can display periodically refreshed images of the current OBS program scene. This is a local preview without audio, not a monitor of the relay's final outgoing fallback/composite.

Settings → Preview controls the switch, refresh rate (0.5–2 fps) and width (320–1280 pixels). The default is 640 pixels at 1 fps. Turning it off stops screenshot requests and removes the image. Requests also pause when the studio/canvas is hidden or the app is minimized. At most one screenshot is in flight; disabling the preview discards any pending image. This is not a smooth 30/60 fps video feed.

## Existing layout and collaboration features

Add item offers chat and approved friend POVs; new relay items start centered. Right-click to lock movement and resizing. Relay scenes save per account on this device. Apply scene to relay sends changes, and switching a relay scene applies it while connected. A saved scene loaded on reconnect does not silently replace the running relay layout.

Customize controls panel position, visibility, sizes, workspace presets and custom browser tools. Unlock movement to drag the floating person-plus Collab button.

The Collab menu has one combined first-use explanation of regular Collab and Super Collab. Incoming requests flash with +N. Both people must approve mutual video access. Regular Collab expires with the session or after 24 hours; Super Collab persists until either person ends it. Approval does not add the feed to a scene automatically. PiP uses video; fallback can include the friend's audio.

Relay Admin appears for the connected owner. To claim an unowned relay, open Settings → Relay → Relay admin access and enter the code from `data/host-setup-code.txt`. There is no universal admin password. Remote administration requires HTTPS.

## Reset and uninstall

Settings → Advanced → Reset layout and preview settings asks for confirmation and resets only panel placement, visibility, sizing and preview preferences. It keeps names, accounts, saved scenes, permissions and completed setup. Encrypted backup controls are in the same category.

Uninstall asks for confirmation. Windows opens the installed Windows uninstaller. Linux removes only the recognized installation made by this version's install.sh and its shortcut. Portable or older Linux installs receive removal instructions instead of an automatic deletion. The app closes; saved accounts/preferences remain for reinstallation. OBS, relay server data and recordings are not removed. No actual uninstall is performed during automated testing.

## Verification and limits

Checks cover the real Chromium UI against a local relay, startup/restart in the actual Linux Electron runtime using its real preload and IPC, and an OBS WebSocket protocol simulator for native scene/mixer/preview actions. Tests verify preview shutdown, connection loss, automatic destination configuration, manual mode, active-stream guards, backup preservation, input validation and safe uninstall cancellation. Runtime binaries and libraries are compared byte-for-byte against the intact rc.3 reference before and after packaging. Release assets are signed and verified.

Real OBS, Windows installer execution, OS keyring behavior and live Twitch/YouTube streaming still need a check on your own machine. This remains a release candidate.

Keep `UniversalCollab-Owner-Source-PRIVATE-1.0.0-rc.6.zip` private. It contains development source and release-signing keys. Historical handoffs describe older releases; this guide is the current reference.
