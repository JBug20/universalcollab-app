# Finish UniversalCollab's platform login setup

Your personal Twitch/YouTube developer setup already works. Public distribution needs one application registration owned by you for each platform, bundled with the app, so each user only clicks Connect and signs into their own account. A version number alone does not complete platform approval.

## Twitch

1. Keep a Twitch developer application owned by you, configured as a Public client. UniversalCollab uses Twitch's device authorization flow; it does not need a confidential client secret.
2. Set the public-facing application name/website accurately. A unique registration name can identify your development instance without changing the product's visible name.
3. Use its Client ID as the release default. A Client ID is public application identification; users' access/refresh tokens are separate and remain in their own app's encrypted vault.
4. Test a second Twitch account: Connect, approve requested access, create/prepare a stream, edit title/category, send chat, moderate an authorized channel, disconnect and reconnect.

Current requested scopes: channel:read:stream_key, channel:manage:broadcast, user:read:chat, user:write:chat, moderator:manage:chat_messages, moderator:manage:banned_users. Account permissions still govern moderation. Review requested scopes whenever features change.

Official registration instructions: https://dev.twitch.tv/docs/authentication/register-app/
Device flow: https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/#device-code-grant-flow

## YouTube / Google — work you do in your project

1. Keep YouTube Data API v3 enabled. Use an OAuth client of type Desktop app for this desktop application. Do not replace it with a Web application client or put a confidential web-server secret into the installer.
2. Provide a public UniversalCollab homepage, a privacy policy on a domain you own/control, a support email, and accurate app branding. Verify domain ownership where Google asks. The privacy policy must describe actual use: local platform authorization, metadata/chat/moderation, platform ingest details sent to the user's selected relay, optional relay recordings, retention/deletion and revoking access. It must not claim all data stays local: selected stream destinations/keys and broadcast data go to the chosen relay host.
3. In Google Auth Platform, configure Branding, Audience and Data Access for the intended public audience. Declare the scope the app actually requests: https://www.googleapis.com/auth/youtube.force-ssl. Explain why metadata/broadcast management and live-chat moderation require it. Do not request unrelated scopes just in case.
4. Prepare an unlisted demonstration video showing the entire OAuth consent flow in English, the correct app name/client ID, and every feature that uses the requested access: link a channel, choose/create a broadcast, edit metadata, use live chat and demonstrate moderation on an authorized channel. Do not show passwords, access tokens or ingest keys.
5. Follow the Verification Center workflow to publish branding and submit data-access verification, including scope justification and the demonstration link. Respond to Google's review emails. Setting an audience to production is not itself verification approval. For limited personal testing, Google describes exceptions; they are not a general public-release approval.
6. Check the project's actual YouTube quota before inviting many users. OAuth consent verification and a YouTube quota/compliance audit are different processes. If you need additional quota, Google's quota extension process requires an audit. Do not assume OAuth verification grants unlimited API use.
7. After approval, test a Google account outside your development test-user list, plus token refresh, sign-out/revocation and re-linking.

Official sources:
- Desktop OAuth flow and loopback/PKCE: https://developers.google.com/identity/protocols/oauth2/native-app
- Verification and public app requirements: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Quota and audits: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

## What this patch prepares in the app

DesktopSource/release-oauth.json is a build-time defaults file. It is intentionally blank in this candidate. It accepts:

```
{
  "twitch": { "clientId": "YOUR_PUBLIC_TWITCH_CLIENT_ID" },
  "youtube": { "clientId": "YOUR_GOOGLE_DESKTOP_CLIENT_ID" }
}
```

If Google's Desktop client registration supplies a client secret required by its token endpoint, the YouTube entry can also include clientSecret for that Desktop client. Installed apps cannot keep an embedded client secret confidential; Google documents this distinction. Never use a confidential web application's credentials as a substitute. Do not put personal access tokens, refresh tokens, relay passwords or stream keys in this file.

The app loads release defaults only when there are no existing local application settings for that platform. Your working settings/logins survive this update. Once your registrations are ready, populate the build defaults and rebuild/retest the installers. End users then use Connect rather than registering their own applications. Application setup remains available for developers or self-hosted builds.

I can prepare code/configuration and supporting drafts, but the developer-account owner must submit/maintain registrations, website ownership and platform review. This update has not submitted any verification request or deployed a website.
