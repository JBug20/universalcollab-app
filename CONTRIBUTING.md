# Working on UniversalCollab

## Branches

| Branch | Who | Rule |
|---|---|---|
| `main` | JBug20 | Must always build and pass tests. Changes from other people come in by pull request. |
| `experimental` | Collaborator | Free to try things. It's fine if it breaks. |

## Moving experimental work into main

1. Open a pull request from `experimental` into `main` on GitHub.
2. Describe what changed and how you tested it.
3. The other person reviews it, then merges.

To keep `experimental` from drifting too far, update it from `main` regularly:

```
git checkout experimental
git pull
git merge main
git push
```

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
