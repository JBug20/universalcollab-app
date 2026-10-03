# UniversalCollab 1.0.0-rc.2 — private licensing and host-controls test

**Do not install this over your working relay until the registry and HTTPS control address are configured.** An unactivated relay can be claimed and administered but cannot start broadcasts. This is a private test release, not stable 1.0.0 or a paid-service launch. Existing platform API verification is a separate task.

## What is included

- Free license: five active members, counting the owner. Plus license: ten. Disabled identities stay in history and do not consume active slots. Restoring access requires a free slot.
- Two guest slots maximum, configurable downward to zero. Guest invitations are host-only, single-use, and reserve a slot until redeemed, revoked or expired. Default maximum duration: 120 minutes; host may select 5–1440 minutes. Guests remain disabled by default unless the host enables invitations. Repeated invitations are not a substitute for a permanent-member plan.
- One-time owner claim, host controls in the desktop app and browser portal, member/guest roles, remove/restore access, immediate broadcast termination, individual recording quotas, total storage, guest policy, simultaneous-broadcast limit and feature switches.
- Explicit owner-login rotation signs other owner devices out without changing OBS keys. Physical-host recovery tool included separately.
- Registry-issued Ed25519 licenses bound to a relay instance, acceptance of a versioned private test notice, replay-resistant response nonces, automatic daily checks and signed 30-day leases plus seven days of grace.
- Expiry or a failed license check never calls the broadcast termination operation. Already-running broadcasts and their reconnects remain allowed. After grace, new broadcasts and new accounts are refused; owner administration, existing logins and recording access remain available. Explicit host removal and guest expiry DO end their broadcasts.
- Account-preserving downgrade: the owner is prioritized, then earlier enabled members. Above-tier identities remain saved; the host can disable chosen members to free slots. Lowering simultaneous-stream limits applies to new sessions, not active broadcasts.
- Exact recording quotas count buffered writes across simultaneous recordings. Quota exhaustion stops recording only; broadcasting continues. No automatic deletion. Zero individual quota disables recording. Values use MiB (1,048,576 bytes), matching existing maxStorageMB behavior.
- Obfuscated bundled relay implementation, with a signed SHA-256 release manifest covering the shipped program and UI assets. Editable config, accounts, certificates, recordings and license state are excluded. These checks are a tampering deterrent, not remote attestation or protection from an administrator reading stream keys in memory.

## Packages and who gets them

- Linux tar.gz and Windows Setup.exe: desktop client; settings and platform logins are preserved.
- ServerUpdate ZIP: obfuscated relay and browser assets, manifest, recovery tool and notices. No readable server module tree, private signing key, config, customer data or vendor binaries. Requires an existing working server installation.
- Registry-Operator ZIP: JBug/operator only. Standalone registry program, public-key export/initialization commands and deployment guide. Do not give this package or registry data to relay customers.
- Owner-Source-PRIVATE ZIP: your development source, tests, pinned build recipe and RELEASE-signing private key. Keep private; never put this ZIP on your public website or give it to relay customers. The registry-signing private key is created later on your own registry host; none is included in any package.

## Setup order

### 1. Registry (operator only)

Run the included registry on your own infrastructure with Node.js 22 or 24. Keep its data directory persistent, private and backed up. Use an HTTPS reverse proxy and protect the machine's administrator account. The registry is not installed or deployed by this download.

From the Registry-Operator folder:

```sh
node registry.mjs init registry-data
node registry.mjs issue registry-data free
node registry.mjs serve registry-data
```

The issue command prints the activation key once. Pass it privately to the intended host. There is no self-service signup or payment collection in this test release. Use `plus` in place of `free` to issue a ten-member TEST entitlement. Default listening address is 127.0.0.1:8099; REGISTRY_BIND and REGISTRY_PORT configure the listener. Terminate public HTTPS at your reverse proxy. Do not expose unencrypted registry traffic to customers.

Copy the public contents of `registry-data/signing-public.pem` into each relay's licensing config. NEVER copy signing-private.pem, licenses.json or the registry data folder to a relay host.

### Before distributing customer relay builds: pin the registry

This private test build deliberately uses the registry URL/public key in config.json so you can test your deployment. That also means a machine administrator could configure a registry they control. **Do not distribute this configurable test build as an enforced commercial license.**

Once you have deployed your registry, rebuild the relay from the private owner source with the publisher's trusted HTTPS URL and public key embedded:

```sh
UC_BUILD_TOOLS=/absolute/path/to/uc-build-tools/node_modules \
UC_REGISTRY_URL=https://YOUR-REGISTRY-HOST/ \
UC_REGISTRY_PUBLIC_KEY_FILE=/private/operator/path/signing-public.pem \
node build/obfuscate.cjs
python3 build/package-rc2.py
```

Only the PUBLIC key goes into this build. A pinned build ignores host-supplied registry URL/public-key overrides. The host still provides their own activation key. Protect and back up the private registry signing key; key rotation requires a compatible relay update. Obfuscation still cannot prevent a determined administrator patching a pinned executable.

### 2. HTTPS control address

Host administration refuses remote HTTP. Either configure the relay's existing controls.tls fields with your certificate/key, or place its control port behind a trusted HTTPS reverse proxy. Set controls.publicOrigin to the exact externally used HTTPS origin, and have the proxy preserve the corresponding Host header. No path prefix is supported. Keep the upstream control listener private when using a proxy. The RTMP/RTMPS ingest configuration is separate.

Your existing plain HTTP control address will still allow ordinary legacy control calls, but not owner claim, licensing or host administration. Change the saved server address in the app to HTTPS before using those operations. This package does not generate certificates or change Cloudflare records.

### 3. Relay update

1. Stop broadcasts, stop OBS and stop the relay. Back up the entire old application plus config.json, data, vendor and fallback.png to a private location for rollback.
2. **Remove the old src directory only**, then extract the ServerUpdate ZIP into the relay root. This avoids leaving the old readable implementation beside the new bundle. Do not delete config.json, data, vendor, certificates or fallback.png. The update ZIP contains none of those persistent files.
3. Merge the following into config.json. Use your actual registry URL and public PEM text; the values below are placeholders, not a deployed service:

```json
"licensing": {
  "registryURL": "https://YOUR-REGISTRY-HOST/",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nYOUR_PUBLIC_KEY\n-----END PUBLIC KEY-----\n"
}
```

4. Start the relay with its existing `node index.js` startup command. Node.js 22 or 24 is required for this tested build. MediaMTX remains separately hash-verified by install.mjs; FFmpeg with libx264 stays supplied by your runtime.
5. Privately read `data/host-setup-code.txt`. For a NEW relay, enter the server address and desired username in the app, open **Relay host administration**, enter that code and click **Claim this relay**. For an EXISTING relay, sign in as your intended owner member first, then claim it with the code. A guest cannot become owner. Owner claim does not change existing OBS publishing keys.
6. The code is consumed after successful claim. Load host controls, read the private test notice, tick acceptance and activate using the issued key.
7. Keep the entire data folder when moving hosts; it contains the relay instance identity and license cache. To intentionally transfer an activation to a new instance, use the registry operator transfer command.

### 4. Desktop update

Windows: close the app and run UniversalCollab-Setup-1.0.0-rc.2.exe. Do not uninstall first. The installer remains unsigned and has not been executed on a real Windows machine here.

Linux/Garuda: close the app, extract UniversalCollab-Linux-1.0.0-rc.2.tar.gz and run `bash install.sh` inside UniversalCollab-Linux. The legacy stream-relay installation/settings paths intentionally stay unchanged. Native Garuda/keyring installation is not tested here.

## Host operation

Open Relay host administration and choose Load host controls while signed in to the owner account. License keys and invitation links are masked. License input is cleared after submission. No other member's OBS key, platform key or personal login token is included in the host overview.

Storage settings apply without restart; new quota limits are checked on the next recording write. Recording availability changes govern new recordings. End broadcast is separate from Remove access. Removal retains the account and recordings, rejects control access and new publishing, and ends that member's current broadcast. Restoration deliberately makes that account's existing credentials usable again; this is access suspension/restoration, not credential replacement. If credentials were compromised, do not restore that account without addressing the compromise.

Owner rotation changes the owner's personal token; keep the updated token privately for other devices. The current app saves it to its existing encrypted profile. If saving fails, use the physical-host recovery procedure.

Guest identity names cannot be reused after expiry, to prevent a new visitor from inheriting someone else's recording access. Ask returning guests to use a new username, or promote a trusted guest to a member before expiry. Historical identities are retained, with a bounded 4096-identity store; the host panel shows active identities plus the latest 200 inactive identities. Do not manually delete account history while recordings still refer to it.

Physical-host owner recovery: stop the relay; from its root run `node host-recovery.mjs`. Read data/host-recovery-token.txt privately, restart, and sign in using that username/token. Delete the recovery file afterward. It rotates the owner control token only; it does not change OBS keys or delete data.

## Registry administration

```sh
node registry.mjs plus registry-data LICENSE_ID
node registry.mjs free registry-data LICENSE_ID
node registry.mjs revoke registry-data LICENSE_ID
node registry.mjs restore registry-data LICENSE_ID
node registry.mjs transfer registry-data LICENSE_ID
```

These operator-only commands use the license ID printed when issuing the key, not the key itself. File operations use an exclusive lock to avoid concurrent CLI/server writes. If the process crashes and leaves registry.lock, stop all registry processes before removing that lock.

Tier changes appear when the host successfully refreshes its license (daily or Check license now). Revocation/transfer does not instantly invalidate a previously issued signed lease: it remains usable until its grace deadline, potentially 37 days. This is an intentional offline-availability tradeoff, not immediate remote enforcement. Do not promise instant revocation or paid subscription automation.

## Security and release limits

There is no remote-attestation claim. A machine administrator can patch checks or inspect decrypted publishing keys in memory. The registry receives the license/instance identifiers, version and integrity status, plus its normal network connection metadata. It receives no streamer lists, account passwords, platform OAuth tokens, destination keys, chat or recordings. Audit logs are local operational records, not tamper-proof evidence.

The testing source contained an MIT license. That notice is preserved. The private test notice is NOT a completed commercial EULA and does not revoke pre-existing MIT or third-party rights. Have a software lawyer review copyright ownership/contributions, the scope of any new restrictions, customer terms, applicable law, refunds/cancellation and privacy before public licensing. No public terms or website policy has been changed.

## Validation

Passed: source and obfuscated-code licensing/admin integration tests; real HTTP authorization and simultaneous registration limits; signature, nonce, instance and acceptance checks; tier change/account retention; lease/grace failure behavior; owner credential rotation; recording quotas including simultaneous buffered writes; full app-script DOM tests exercising real claim/activation/settings/removal endpoints; existing platform/desktop/backup/control regressions. Real FFmpeg/MediaMTX tests cover healthy/failing destinations, continuous fallback and PiP, layout, timeout, recording download and ownership/deletion.

A local Chromium launch was denied by this environment, and the cloud browser does not permit local file URLs. DOM tests are not visual-browser verification. The browser test is retained for an environment that supports it. Actual Windows/Garuda installation, public registry HTTPS deployment, live Twitch/YouTube flows and visual desktop review remain field-test gates before stable release.

## Rollback

Stop broadcasts and relay before rollback. Restore the private pre-update application and its matching config/data backup. Do not extract the old source ZIP over an active relay. Keep recordings backed up separately if you want recordings made after the backup. No registry or license service was deployed automatically by producing these packages.
