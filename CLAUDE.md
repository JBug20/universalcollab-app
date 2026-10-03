# Notes for Claude

Read CONTRIBUTING.md before making changes. In short:

- `main` belongs to JBug20. Never push to it; changes reach it by pull request.
- When working for Lovelesswolf, push only to `experimental` (`git push origin experimental`), never to another branch or repository, and never force-push.
- Don't work on `universalcollab-obs-plugin`.
- The relay is private: hand relay builds over as files, never put relay code on GitHub.
- Windows/Linux builds and the relay zip are handed over as files, never committed or uploaded.
- Run `npm test` before pushing. Never commit tokens, stream keys, passwords, OAuth secrets or signing keys; `DesktopSource/release-oauth.json` keeps blank client IDs.
