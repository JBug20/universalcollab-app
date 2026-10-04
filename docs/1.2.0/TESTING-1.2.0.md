# 1.2.0-preview.1 test record

Run `work/collab-merge/run-tests.sh` from the archive root. It needs:

- Node 22+
- FFmpeg/ffprobe on PATH
- Playwright: set `PLAYWRIGHT_MODULE` to its folder; `CHROME_PATH` is optional

Last run: **33 of 33 passed** (Linux sandbox, Node 22.22, FFmpeg 7, Playwright Chromium).

## What passed

| Area | Test | What it proves |
|---|---|---|
| Relay sources | test-media-sources.mjs | Source validation; upload, refresh and missing-frame flow; checksum and type rejection; host switch; real FFmpeg decode to YUVA; alpha compositing; budget fallback; pruning |
| Relay output | test-media-output.mjs | A PNG with transparency goes through the real Session → x264 → OutputHub → FLV. Pixels in the **encoded output** are checked: opaque area visible, transparent area shows fallback, outside untouched. Removing the source clears it |
| Relay video | test-live-remux.mjs | Real FFmpeg 1440p60 relay stream → fragmented MP4 preview (first bytes ~0.65 s), decodes cleanly, revoking the login closes it |
| Relay video | test-video.mjs, test-video-auth.mjs | Stream copy, viewer limit, cleanup, owner-only access |
| Desktop modules | test-desktop-modules.cjs | Pictures by verified hash, bounded and tamper-checked backups. Browser page isolation (sandbox, no preload, separate session, permissions denied, no pop-ups or file navigation, muted), 4-page limit, size cap, JPEG/PNG choice, errors, resize, reload, close with the app |
| Desktop UI, end to end | test-layout-sources-ui.mjs | Real UI in headless Chromium against a **real relay portal server/store**. Offline text, picture and browser sources; no `prompt()`; snapping guide and Alt bypass; 2×2 split; pictures kept out of localStorage; reload keeps the draft; the offline-layout choice on connect; relay saves 3 sources; frames uploaded while broadcasting and the text frame decoded to verify white text; scene restore; editing settings from the right-click menu; disconnect keeps the layout; no page errors |
| Live video | test-relay-video-recovery.cjs | Reconnects after a clean end and after a stall. The 1.1.0 code fails this test (it freezes) |
| Assist | test-controller.cjs, test-assist-spawn-failure.cjs | The existing IPC guard and lifecycle, plus the new failed-start recovery (the 1.1.0 code fails this test) |
| Existing UI | test-full-ui.cjs, test-ui.cjs, test-inline-video.cjs, test-preview-resolution.cjs | No regressions in the Assist UI, inline video placement or OBS preview widths |
| Existing relay and desktop | 19 older tests (portal, destinations, host features, canvas, routing, collab, release, OBS, vault, platforms, server store, studio) | No regressions. The same set failed or passed identically on the 1.1.0 code; the older UI tests that need an Electron binary or 0.6-era folders fail on both versions and were left as they are |

## Not verified — check on your machine before relying on it

- **Real Electron.** Electron could not be installed in the sandbox, so `browser-sources.cjs` (off-screen rendering, transparent pages, frame rate) and `layout-media.cjs` were tested with a fake Electron API, not the real one. Check them in the app first.
- **C# engine.** The engine, installer and uninstaller compile with 0 errors and 0 warnings as C# 5 against .NET Framework 4.8 reference assemblies (`tools/csharp-linux`). That is a compile check only: rebuild with Build.ps1 and run test-engine.cjs on Windows.
- **H.264 playback** in the app's player (test-video-playback.cjs needs Google Chrome). Recovery logic was tested with VP8.
- **Your relay server.** Real deployment, six simultaneous 1440p60 broadcasters, and long sessions (memory, CPU, browser snapshot bandwidth of roughly 0.2–2 MB/s per page while broadcasting).
- **Live platforms.** Live Twitch/YouTube/Kick, OAuth, real OBS, the Windows installer, DPAPI accounts, and live alerts and audio.
- **Fonts.** These depend on what Windows has installed. "Rounded" and "Display" fall back if Arial Rounded or Impact are missing.
