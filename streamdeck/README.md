# UniversalCollab Stream Deck plugin

Controls UniversalCollab from an Elgato Stream Deck (Stream Deck 6.5+, Windows). Plugin ID `stream.universalcollab.app`.
It is separate from Stream Assist's own plugin (`stream.universalcollab.assist`).

Actions: Start / Stop Stream, Start / Stop Recording, Clip, End Relay, OBS Scene, Relay Scene, Studio Mode,
Transition, Mute Audio, Stream Assist. Keys light up from the app's state (live, recording, active scene, Studio Mode,
muted). Stop Stream and End Relay need a second press within 3 seconds.

## How it connects

UniversalCollab runs a local WebSocket for the plugin (`DesktopSource/remote-control.cjs`, window side
`remote-control.js`). It is off until **Tools → Stream Deck → Enable Stream Deck control**, listens on
`127.0.0.1:18750` only, needs the pairing token (copied from that window, stored encrypted by the OS), and refuses
web pages (any `Origin` header, or a Host other than this machine). Commands run through the same code as the
buttons.

## Build and install

Built plugins are handed over as files, never committed or uploaded (see CONTRIBUTING.md).

```
npm install -g @elgato/cli                      # once
node streamdeck/tools/make-images.mjs           # only after changing the icons
streamdeck validate streamdeck/stream.universalcollab.app.sdPlugin
streamdeck pack streamdeck/stream.universalcollab.app.sdPlugin --output dist
```

Double-click `stream.universalcollab.app.streamDeckPlugin` to install. Then in UniversalCollab: Tools → Stream Deck →
Enable → Copy pairing token, and paste it into any UniversalCollab key's settings (the connection is shared by all
keys).

`bin/ws` is an unmodified copy of `DesktopSource/vendor/ws` (MIT, see its LICENSE); it is excluded from Prettier.

## Tests

`tests/remote-control-120.cjs` (local control security), `tests/stream-deck-ui-120.mjs` (window side on the real page)
and `tests/stream-deck-plugin-120.cjs` (this plugin against a simulated Stream Deck and the real control module).
Not yet tried on real Stream Deck hardware.
