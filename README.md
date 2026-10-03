# UniversalCollab (desktop app)

A Windows/Linux Electron app for stream collaboration. It controls OBS over OBS WebSocket, so any plugins installed in OBS keep working. It adds Twitch/YouTube setup, chat and moderation, a relay layout editor, and collabs through an optional self-hosted relay.

This repo is one of three:

| Repo | What it is |
|---|---|
| **`universalcollab-app`** | This repo: the desktop app |
| `universalcollab-obs-plugin` | The same features as a plugin for regular OBS, for people who don't want a separate app |
| `universalcollab-relay` | The optional relay server |

## Branches

- `main`: stable work. Keep it buildable.
- `experimental`: try new things here. Merge into `main` through a pull request once it works.

See `CONTRIBUTING.md`.

## Status

1.0.0-rc.8 (release candidate). Current instructions and known limits are in `docs/START-HERE-1.0.0-rc.8.md`. Older notes are in `docs/history/`.

Not done yet (don't claim these work):

- Text, image and browser sources are **not** rendered into the outgoing relay stream yet.

Deferred work: Kick OAuth, 60 FPS preview, advanced PiP, source recording, Twitch VOD audio track, standalone relay installer (last).

## Layout

- `DesktopSource/`: the Electron app (`main.cjs`, `preload.cjs`, OBS link/controls, platforms, UI)
- `tests/`: desktop tests. Some (`desktop-bridge`, `desktop-studio-07x`, `host-dom`, `release-native`, `release-unit`) also load relay UI files from `../src`. To run those, check out `universalcollab-relay` next to this repo and copy or link its `src/` folder into the repo root.
- `build/`: packaging scripts. They still assume the old combined layout (relay and desktop in one folder) and need updating for the split.
- `docs/`: release notes, the API public release checklist and Kick notes

## Credentials

`DesktopSource/release-oauth.json` stays **blank** in git. The owner fills in the existing registered Twitch client ID and Google Desktop OAuth client ID only for local release builds, and never commits them. Don't create replacement OAuth registrations without the owner's approval.

## License

MIT (see `LICENSE` and `THIRD_PARTY.md`).
