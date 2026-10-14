# Streamtape “Client blocked” and ad-free playback

## Cause and fix

The watch page used Streamtape's third-party player in a sandboxed iframe. Its
sandbox disallows popups and top-level navigation, which conflicts with hosts
that detect these restrictions. Removing the sandbox or adding `allow-popups`
would permit advertising windows/redirects; it is not an ad-free fix.

Streamtape `/e/`, `/v/`, and `/d/` links on the recognised `.com`, `.net`, and
`.to` domains now use the site's native `<video>` player instead:

1. A visitor presses **Play video**. No provider iframe or ad script is loaded.
2. `GET /api/videos/{catalog-uuid}/playback` rechecks that the video is published,
   public, rights-cleared and moderation-approved using the regular Supabase
   client (no service-role bypass).
3. The server calls the existing official `/file/dlticket` and `/file/dl` API
   client to obtain a fresh media URL. Only HTTPS Streamtape/tapecontent hosts
   are accepted; API credential parameters and known player pages are rejected.
4. The browser receives only the media URL. API login/key stay server-side.
   The response is `private, no-store`; the ticket URL is never saved to the DB.
   Media bytes and range requests go directly to the media host, not through
   a serverless video proxy. CDN redirects inside a media request can still
   occur; these do not navigate the page or open advertising windows.
5. Playback failures show a retry button. Retry requests a fresh link. There is
   deliberately no fallback to the ad-supported iframe or a provider website.

Existing direct `playable_url` values take priority over embeds and require no
Streamtape credentials. Legacy Streamtape watch pages accidentally stored in
`playable_url` are recognised too. Other providers retain their existing iframe
sandbox; their in-frame ads are not removed by this change.

## Required deployment setup

- Keep `VIDEO_PROVIDER=direct_url` (or leave it unset). Do **not** reactivate the
  retired Streamtape upload integration.
- Set `STREAMTAPE_LOGIN` and `STREAMTAPE_API_KEY` in the hosting platform's
  **server-only** environment, then redeploy. These are the same variables used
  for Streamtape thumbnail imports. Never use `NEXT_PUBLIC_*` or paste secrets
  into chat/source control.
- Allow server egress to `api.streamtape.com` and browser media requests to
  Streamtape/tapecontent hosts. The route declares a 180-second maximum to fit
  the existing API client's two 60-second timeouts plus its ticket wait. Ensure
  the deployment plan supports that duration.
- No database migration is required.

## Provider limitations — not a guaranteed ad blocker bypass

This uses the provider's download API, not scraping or disabling anti-adblock
checks. API access, file availability, account bandwidth, ticket restrictions,
codec support and the media host's browser access rules still apply. If an
account cannot issue a browser-usable link (including an IP-bound link), retry
cannot fix that. Do not relax the iframe sandbox or proxy advertising HTML.

For reliable ad-free hosting, use an authorised direct MP4/WebM source on a
host/CDN you control, with a browser-supported codec, HTTPS and byte-range
support. Replace the affected video's `playable_url` with that durable media
URL using trusted administrative tooling, or republish it through Admin →
Videos → Upload by link. A native direct URL takes priority over the old embed.
Never save a short-lived Streamtape download ticket as a permanent source.

## Verification

Unit tests cover source detection, direct-source precedence, source validation,
publication/access checks, secret-safe errors, native playback, retry/refresh,
and preservation of popup/navigation restrictions for other providers.

Live acceptance must be run on the deployed site with a real authorised file:

- Press Play video with browser ad blocking enabled, and also on mobile Safari.
- Confirm `/api/videos/{id}/playback` returns a media URL (not HTML or a redirect),
  and the browser successfully fetches media (200/206), plays, pauses and seeks.
- Confirm no Streamtape iframe is present, no ad window opens, and the page URL
  does not change. API credentials must be absent from browser network logs.
- Test a missing file/unavailable API and retry. Failure must never open an
  unsandboxed iframe or send the visitor to Streamtape.
- Verify a direct MP4 record still plays without any Streamtape API request.

The implementation sandbox cannot reach Streamtape, so mocked tests do not
prove real-account media playback. Production playback remains to be verified.
