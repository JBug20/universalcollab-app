# Notes for Claude

Read CONTRIBUTING.md before making changes. In short:

- `main` belongs to JBug20. Only JBug20's own sessions push to it; everyone else's changes reach it by pull request.
- When working for Lovelesswolf, push only to `experimental` (`git push origin experimental`), never to another branch or repository, and never force-push.
- Don't work on `universalcollab-obs-plugin`.
- The relay is private: hand relay builds over as files, never put relay code on GitHub.
- Windows/Linux builds and the relay zip are handed over as files, never committed or uploaded.
- Run `npm test` before pushing. Never commit tokens, stream keys, passwords, OAuth secrets or signing keys; `DesktopSource/release-oauth.json` keeps blank client IDs.
- When working for Lovelesswolf: every feature you add to `experimental` gets a GitHub issue in JBug20/universalcollab-app, labelled `in experimental`, in the format under "Feature issues" in CONTRIBUTING.md. Create it after the feature is pushed, check first that it doesn't already exist, and update the issue instead when you change that feature later.
