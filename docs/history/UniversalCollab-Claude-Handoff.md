# UniversalCollab → Claude handoff

Attach this document and the `UniversalCollab-Source-1.0.0-rc.8-Layout-API-Test.zip`
source archive to Claude, then send the prompt below.

---

I am continuing development of **UniversalCollab**, a Windows/Linux Electron
desktop app for stream collaboration. Review the attached source archive before
proposing or changing code.

## New direction

I want to turn this into an **OBS fork**, provisionally named *UniversalCollab
Studio*, instead of making a separate OBS companion app. The goal is an
OBS-style broadcasting app with UniversalCollab built in.

Do not start coding the fork until you have first given me:

1. A realistic migration plan from this Electron app to an OBS fork.
2. Which parts of the current code can be reused, which must be rewritten, and
   which should become OBS plugins/modules.
3. The legal/licensing requirements of distributing an OBS fork (GPL),
   including source availability, attribution, and distinct branding.
4. A smallest practical first milestone that can build and run on Windows and
   Linux.
5. A risk list: authentication security, stream-key handling, platform API
   verification, browser sources, relay security, and update distribution.

Keep the existing project’s intent and do not invent credentials.

## Existing functionality / direction

- Twitch and YouTube account connection, broadcast setup/metadata, chat, and
  moderation are part of the product direction.
- Collaboration uses an optional self-hosted relay; no account credentials,
  OAuth secrets, platform tokens, stream keys, or relay passwords may be baked
  into a desktop release.
- The user wants layouts editable without being connected to a relay.
- Requested layout tools: snapping, right-click move-to-corner, a 4-person
  2×2 split, and canvas text/image/browser sources.
- Existing Electron changes include some layout editing and metadata storage,
  but **text/image/browser sources are not yet rendered into the real outgoing
  relay stream**. Do not claim they work until implemented and tested.

## Do not implement yet

- Kick OAuth/API integration
- 60 FPS preview improvements
- advanced/flexible PiP work
- source-recording feature
- Twitch VOD audio-track feature
- standalone relay installer (this is last)

## OAuth / approval constraints

- Use the existing app name and existing OAuth registrations only.
- Twitch client ID already exists; Google Desktop OAuth client already exists.
- YouTube Data API v3 and `youtube.force-ssl` are configured; development login
  worked.
- Public release preparation still needs a live homepage/privacy policy, Google
  Auth Platform branding/audience/data-access configuration, scope
  justification, an unlisted English demo video, then Google verification.
- Twitch needs public app-details confirmation and real-account testing.
- Never create replacement credentials without explicit owner approval.

## Immediate request

Please give the migration plan first. Do not dump a giant rewrite. Recommend a
small buildable first step, explain it in plain language, and ask before making
any broad architectural changes.

---

## Included source bundle notes

The archive is an rc.8 test source bundle. It intentionally excludes private
keys, runtime configuration, owner-only files, and secrets. The matching server
update is separate and is not required for Claude’s initial migration review.
