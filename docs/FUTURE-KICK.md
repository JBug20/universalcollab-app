# UniversalCollab future feature backlog (not implemented)

## Stream-layout snapping (not implemented)

Add optional snapping in the relay stream-layout editor so chat, friend POVs, and future layout items can align cleanly. Include canvas-edge snapping, center-line snapping, and snapping to the edges and centers of other visible unlocked items. Show a subtle alignment guide while dragging; holding a modifier must temporarily bypass snapping. Keep exact manual positioning available, respect locked items, and preserve existing saved layouts without moving them.

Define a small, resolution-independent snap threshold and verify behavior with overlapping items, different canvas sizes, keyboard movement, scene changes, undo/cancel, and touch or pointer dragging. This is a future editor improvement only; do not implement it as part of the current OAuth approval work.

### Offline layout editing

Let users create, edit, duplicate, rename, and save relay-scene layouts at any time without connecting to a relay. The editor should use a local draft canvas and allow every normal layout action, including corner placement, snapping, source configuration, visibility, locking, ordering, and transforms. On connection, do not overwrite the live relay automatically: clearly offer Apply this saved layout, load the relay's current layout, or keep editing locally. Preserve drafts per local profile and make offline changes available for a later relay/scene selection.

### Quick corner placement and split-screen layouts

Add a right-click Layout/Position submenu for every screen, friend POV, or PiP item. It should offer Top left, Top right, Bottom left, Bottom right, Center, and Reset/manual placement. A corner action must place and size the selected item predictably inside its quadrant, allowing four different people/screens to form a clean 2×2 split screen. Corner placement should work with snapping, remain editable afterward, and never silently rearrange other items unless an explicit future auto-layout command is chosen.

### Broadcast layout sources

Allow text, image, and browser sources to be added directly to a relay scene as broadcast-layout items, distinct from the existing local workspace browser panels. Text needs editable content plus basic font, color, alignment, background, outline/shadow, wrapping, and scale controls. Image sources need local-file selection, fit/fill/stretch behavior, opacity, and safe persistence or upload handling. Browser sources need an HTTPS URL, explicit privacy/security warning, a fixed render size, refresh/reload controls, and a clear failure state for pages that block embedding. All source types should support visibility, lock, ordering, transform, snapping, and scene persistence.

## Remaining original roadmap (not implemented)

### Standalone relay installer — do last

Provide a supported, self-contained installer for creating and managing a new relay server, rather than requiring an already working relay update target. It should guide the host through prerequisites, secure initial ownership, configuration, storage locations, start/stop/update actions, and clear diagnostics. This is explicitly the last backlog feature to implement.

### Expanded pre-stream readiness

Expand the current basic readiness check into a clear pre-flight report for relay reachability/capacity, OBS connection and output state, selected destinations, encoder and codec compatibility, available disk space for recordings, and media/relay prerequisites. It must distinguish blocking failures from warnings and never change live settings merely by checking.

### Stream-health and host-capacity dashboard

Provide a fuller host-authorized health view: relay input/output state, per-destination delivery state, fallback state, recordings, error history, resource use, and safe capacity/throughput benchmarking. Values must be labeled accurately and never present relay frame-pump activity as a platform-delivered FPS guarantee.

### Fallback timeout controls

Allow a relay owner to configure what happens after the main feed is absent for a chosen period, including timeout duration, fallback behavior, recovery behavior, and visible status. Preserve a safe default and avoid ending a stream merely from a brief reconnect.

### Guest invitations and expiry cleanup

Add shareable, time-limited guest invitations with clear scope and revocation. Expired guest accounts/invitations must be cleaned up automatically or by an owner review flow so they do not remain indefinitely or count against account limits.

### Recording retention and administration

Build on the existing optional recordings/history with host-controlled retention rules, storage limits, owner cleanup, finalized-recording management, and clear download/delete permissions. It must avoid deleting active or incomplete recordings.

### Contributor-only POV mode

Allow an approved collaborator to send a POV to the relay without setting up a destination/channel of their own. The host can use that feed for PiP or fallback according to the existing collaboration permissions, while the contributor is not treated as independently live on a platform.

### Appearance themes

Add an optional appearance/theming system for the desktop workspace, without changing stream output or disturbing existing saved layout data.

## Kick OAuth and multistream disclosure

When Kick OAuth/API integration is added, implement and verify its multistreaming disclosure for eligible accounts simultaneously broadcasting to another qualifying platform. Confirm an official API endpoint and scopes first; do not invent an endpoint or treat opening a website as success.

The documented requirement applies to Kick Partner Program multistreaming. Distinguish qualifying long-form services from vertical/short-form exceptions. Derive the setting from actual active destinations, handle changes during streaming, and preserve an existing disclosure when stream state is uncertain. Read back the result if supported. If the API does not support the setting, display an explicit manual action/unverified state.

Explain the platform's documented revenue implications before first use. Test Kick-only, multi-platform, exceptions, eligibility, expired auth, API failure and reconnect. Keep tokens in the main-process vault.

Official reference reviewed during rc.8 design:
https://help.kick.com/en/articles/11091744-multistreaming-on-the-kick-partner-program

Recheck policy/API support during implementation. The help article's dashboard/chat controls do not establish that a public API endpoint exists.
