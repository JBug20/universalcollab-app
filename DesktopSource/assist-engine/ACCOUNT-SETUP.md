# UniversalStream Assist — connect your accounts

Twitch is already working. Its Client ID and protected sign-in location have been kept through the rename. Install the new version with the old app closed. Use **Accounts** for each service.

## Streamlabs

1. Sign into the Streamlabs website, then open **Settings → API Settings → API Tokens**.
2. Copy **Your Socket API Token**. Do not send it in chat.
3. In UniversalStream Assist, open **Accounts → Streamlabs → Set token** and paste it.
4. Save, then select **Connect Streamlabs**.
5. Send a Streamlabs test donation and check that it appears once. The direct connection receives tips; it ignores Streamlabs copies of Twitch events.

The token is protected for your Windows account. [Streamlabs Socket API documentation](https://dev.streamlabs.com/docs/socket-api).

## YouTube

1. Open [Google Cloud Console](https://console.cloud.google.com/) using the Google account that manages your YouTube channel.
2. Create a project named **UniversalStream Assist** and select it.
3. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and enable it.
4. Open **Google Auth Platform** (or **OAuth consent screen**, depending on the console layout). Set the app name to **UniversalStream Assist** and supply your own support/contact email.
5. Choose **External** audience and keep the app in **Testing** for personal use. Add your Google account under **Test users**. Under data access/scopes, add `https://www.googleapis.com/auth/youtube.readonly`.
6. Open **Clients → Create client**, select **Desktop app**, and name it **UniversalStream Assist Windows**. Do not choose Web application.
7. Download the client's JSON credentials file. Keep it on your computer; do not paste its contents in chat.
8. Open **Accounts → YouTube → Import Google file**, select that JSON, then click **Connect YouTube**.
9. Approve access in Google's browser page using the account/channel that owns your broadcast. The app waits for an active live broadcast.

This build monitors Super Chats, Super Stickers, new memberships, membership milestones and gifted membership batches. It checks about every 20 seconds, or slower if Google requires it. It does not generate notifications for ordinary channel subscribers. Only one active broadcast is monitored at a time; if several are active, the first returned by YouTube is selected. API quotas can stop monitoring; the app reports that condition. Reconnection keeps the current session's message cursor where possible, but historical alerts from before connection are not replayed.

[Google API setup](https://developers.google.com/youtube/v3/getting-started) · [Desktop sign-in documentation](https://developers.google.com/identity/protocols/oauth2/native-app).

## Kick: register the app first

1. Sign into [Kick Developer settings](https://kick.com/settings/developer). Enable two-factor authentication if Kick requires it.
2. Create an application with these values:

| Field                 | Value                                            |
| --------------------- | ------------------------------------------------ |
| App name              | UniversalStream Assist                           |
| Redirect/callback URL | `https://assist.universalcollab.stream/callback` |
| Webhook URL           | `https://assist.universalcollab.stream/webhook`  |
| Website, if requested | `https://universalcollab.stream`                 |

3. Enable webhooks in the Kick app's settings. Save the app.
4. The **Client ID** can be shared for configuration. Keep the **Client Secret** private; it will be entered into Cloudflare's encrypted secrets.

The proposed receiver address is not published yet. Registering the app does not deploy the receiver. The separate receiver package contains the implementation and deployment instructions. It uses its own subdomain and does not replace your main website.

[Kick app registration](https://docs.kick.com/getting-started/kick-apps-setup) · [Kick event authentication](https://docs.kick.com/events/webhook-security).

## Kick: connect after the receiver is deployed

1. In Cloudflare, set up the supplied Worker with `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, and a private `RELAY_TOKEN` of at least 32 random characters. The receiver package README has the exact deployment steps.
2. In the desktop app, open **Accounts → Kick → Receiver settings**.
3. Enter `https://assist.universalcollab.stream` and the same private receiver key. Do not put the Kick client secret in the desktop app.
4. Select **Connect Kick** and approve the browser sign-in with your broadcaster account.

The receiver accepts Kick-signed follows, subscriptions, renewals, subscription gifts and gifted Kicks for your authorized broadcaster only. It retains up to about 1,000 events for up to 24 hours and the desktop polls every five seconds. Connecting starts from the current end of the queue. This is a personal receiver for one broadcaster, not a public multi-user service.

## Current verification

- Twitch direct connection was confirmed working by you before this update; its authentication setup is preserved.
- New Streamlabs socket/heartbeat/deduplication tests passed with a local simulator.
- YouTube event parsing, history filtering, credentials-file checks and PKCE tests passed locally.
- Kick webhook signatures, expired/replayed data, protected polling and OAuth state tests passed locally.
- The new service sign-ins and live account events still need testing. The Cloudflare receiver has not been deployed or tested on Cloudflare.

The optional **Bridge** tab remains available during setup. Events from a platform are ignored on the bridge while its direct connector is running, so avoid running a failing direct connection alongside the bridge as a fallback: disconnect that direct connector first.

The installer continues using the original internal installation/profile locations to preserve existing settings. It creates shortcuts bearing the new name. The Twitch consent screen may still show the developer app's previous name until you rename that app in Twitch's developer console; keep its existing Client ID.
