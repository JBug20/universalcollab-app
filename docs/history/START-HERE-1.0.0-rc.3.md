# UniversalCollab 1.0.0-rc.3 — free self-hosting

All features are free. This update removes the central registry, activation keys, paid tiers, license leases, renewal checks, and license-based broadcast/member restrictions. No registry service or registry account is needed. Host ownership and member authentication remain required for protected actions. Twitch/Google application registration and OAuth consent are separate and remain necessary.

## Update

Stop broadcasts and the relay. Back up config.json and data. Extract UniversalCollab-ServerUpdate-1.0.0-rc.3.zip into the relay root, replacing the included files, then restart using the existing start command. The update does not include or replace config.json, data, recordings, vendor binaries, or fallback.png. Old licensing configuration and data/license.json are ignored; they may be removed after backup but do not need to be deleted. An old separately running registry service is no longer used; its operator can shut it down if it has no other users.

Update the desktop app too so it displays the new host controls. Linux: close the app, extract UniversalCollab-Linux-1.0.0-rc.3.tar.gz and run `bash install.sh` inside UniversalCollab-Linux. Windows: close the app and run UniversalCollab-Setup-1.0.0-rc.3.exe. Saved accounts, permanent OBS keys, OAuth settings, and local app preferences are retained.

## Host controls

Existing owners stay owners. If the relay is unclaimed, use the private code in data/host-setup-code.txt with “Claim this relay”; sign in first to claim with an existing account. This local ownership check is not product activation. Host administration still requires HTTPS, except loopback testing.

The host can set member slots, guest slots, simultaneous broadcasts, feature switches, and recording quotas. Member capacity starts at 100 or the current active member count, whichever is larger. Existing guest capacity, recording settings, and broadcast limits remain unchanged. Member slots and guest slots may each be configured up to 100,000 (guest slots may be zero); the relay also retains an overall safety ceiling of 4,096 stored accounts, including disabled/expired accounts. These validation bounds do not imply the server has hardware capacity for that many people. Simultaneous broadcasts retain the existing 1–12 safety range. Raising an account limit does not raise encoding capacity automatically.

Lowering member/guest capacity prevents out-of-capacity accounts from starting new broadcasts; it does not delete accounts or recordings or stop an existing broadcast. The owner is prioritized in member slots. Disabled and expired guest accounts remain blocked. One-use invitations, permissions, and owner-only administration continue to apply.

## Validation and release status

The source and packaged relay are regression-tested for offline host operation, migration with obsolete license data, more than ten members and two guests, owner-only limit changes, capacity enforcement, restart persistence, key preservation, and removed activation endpoints. Existing feature and release unit tests are also run. UI behavior is tested with a simulated DOM and real local HTTP server.

This remains a release candidate. Native Windows/Garuda installation and live Twitch/YouTube streaming have not been reverified for this patch. No changes were made to platform OAuth or media encoding.

Use this guide for the current version; older START-HERE and HANDOFF documents in the private source describe historical builds and may refer to removed licensing features. Do not distribute the owner source or private build keys. Donations and stream links can be added separately once their URLs are supplied.
