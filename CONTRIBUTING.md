# Working on UniversalCollab

## Who works where

| Branch | Who may push | Rule |
|---|---|---|
| `main` | JBug20 only | Must always build and pass tests. Other work arrives by pull request, which JBug20 reviews and merges. |
| `experimental` | dragomancer221 and his Claude only | Free to try things. It's fine if it breaks. Nobody else pushes here. |

- dragomancer221 works on this app repo only. He does not work on `universalcollab-obs-plugin`.
- The relay (`universalcollab-relay`) is private. Its code and builds never go on GitHub from this work (see "Relay builds").

## Moving experimental work into main

1. dragomancer221 opens a pull request from `experimental` into `main` on GitHub.
2. He describes what changed and how he tested it.
3. JBug20 reviews it and merges it.

To keep `experimental` from drifting too far, dragomancer221 updates it from `main` regularly:

```
git checkout experimental
git pull origin experimental
git merge origin/main
git push origin experimental
```

## Rules for dragomancer221's Claude

When Claude (or any AI assistant) works for dragomancer221:

1. Push only to `experimental`, with exactly `git push origin experimental`.
2. Never push, merge or force-push to `main` or any other branch, and never push to any other repository. To get work into `main`, open a pull request and leave the merge to JBug20.
3. Start each session from the latest `experimental` (`git fetch origin`, `git checkout experimental`, `git pull origin experimental`).
4. Run `npm test` before pushing and report any failures. If a push is rejected, stop and say so. Never force-push.
5. Never work on `universalcollab-obs-plugin`.
6. Relay and release files are handed to dragomancer221 directly as files, never uploaded to GitHub (see below).
7. If something seems to need a change on `main`, describe it instead of making it.

## Release builds (Windows and Linux)

`build/package.py` builds both versions. It needs:

- a `release-runtime` folder next to this repo with `UniversalCollab-Linux` and `windows-app` (the Electron runtime from an earlier release, checked byte for byte; JBug20 provides it privately, so never download a different Electron instead), and
- NSIS (`makensis`) for the Windows installer.

```
python3 universalcollab-app/build/package.py
makensis uc-rc3-ui-release/installer.nsi
```

Outputs appear next to this repo: `UniversalCollab-Linux-<version>.tar.gz` (Linux/Garuda) and the Windows Setup `.exe`. Hand them over as files; never commit or upload them to GitHub. The build also makes `UniversalCollab-Owner-Source-PRIVATE-*.zip`, which is never shared or uploaded.

## Relay builds (private)

The relay source is shared privately and lives in a folder named `universalcollab-relay` next to this repo. The same build makes `UniversalCollab-ServerUpdate-<version>.zip`, which dragomancer221 uploads to his own server.

- Never create a GitHub repo for the relay, push it anywhere, or copy relay code into this repo.
- The zip never contains `config.json`, `data/`, `recordings/`, `vendor/`, passwords, tokens or keys (the build leaves them out).
- The relay listens on all network interfaces with HTTPS off by default. Put it behind HTTPS before using it on a public server.

## Running the app from source

You need Node.js (LTS). Then, in this folder:

```
npm install
npm start
```

`npm start` opens the app from `DesktopSource/` with Electron. It uses the same saved settings as an installed UniversalCollab on that computer.

## Tests

```
npm test
```

This runs everything in `tests/` and prints OK, FAIL or SKIP per file.

- Tests that start a real relay need `universalcollab-relay` cloned next to this repo (both folders in the same parent folder).
- The two `native-*` tests need a packaged app; set `UC_RUNTIME` to its executable to run them.
- `tests/legacy/` holds tests for older layouts. They aren't run.

Code style is set by Prettier (`.prettierrc.json`). Run `npm run format` before committing.

## Before every commit

- No tokens, stream keys, relay passwords, OAuth secrets or signing keys in any file.
- `DesktopSource/release-oauth.json` must keep blank client IDs.
- Don't describe a feature as working until it's implemented and tested.
