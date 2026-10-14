# Streamtape “Client blocked” and ad-free playback

## Cause and fix

The watch page used Streamtape's third-party player in a sandboxed iframe. Its
sandbox disallows popups and top-level navigation, which conflicts with hosts
that detect these restrictions. Removing the sandbox or adding `allow-popups`
would permit advertising windows/redirects; it is not an ad-free fix.

Streamtape `/e/`, `/v/`, and `/d/` links on the recognised `.com`, `.net`, and
`.to` domains now use the site's native `<video>` player instead:

1. The watch page mounts the site's native `<video>` element immediately, with
   the poster and the Erobabe play control on top. No provider iframe or ad
   script is loaded — before, during or after playback.
2. `GET /api/videos/{catalog-uuid}/playback` rechecks that the video is published,
   public, rights-cleared and moderation-approved using the regular Supabase
   client (no service-role bypass).
3. The server calls the official `/file/dlticket` and `/file/dl` APIs and
   **consumes the resulting download URL on the server**, rather than sending it
   to the browser. Download URLs can be IP-bound: a ticket created on the server
   can fail with HTTP 403 when fetched from a visitor's different IP. Reissuing
   another server-bound link to the browser does not fix that failure.
4. The resolved link is cached in memory for a few minutes and shared by
   concurrent requests, so the visitor's play click, every seek and every byte
   range reuse it instead of paying for two API round trips each time. The cache
   is per server instance, never persisted, and validated against the media
   allowlist before it is stored. `POST /api/videos/{catalog-uuid}/prepare` warms
   the same link while the poster is still on screen. See
   `docs/INSTANT_PLAYBACK.md`.
5. The native player uses `/api/videos/{catalog-uuid}/playback` as its media
   source. This endpoint streams bytes with backpressure (no full-file buffer),
   forwards single byte ranges, preserves 200/206/416 and media/range headers,
   and supports HEAD probes. Each request rechecks catalog access. A cached link
   the media host refuses is dropped and replaced by exactly one freshly issued
   link before the visitor sees an error. Cancelling a media response aborts its
   upstream fetch. The connection timeout ends once media headers arrive; it
   does not cut off an active video after 30 seconds.
6. The response is `private, no-store`. Tickets and API credentials stay
   server-side and are never saved to the DB. Redirects are followed manually,
   validating each destination against the HTTPS Streamtape/tapecontent
   allowlist. HTML/player pages, API hosts, credential-bearing URLs and upstream
   error bodies are not relayed. Browser cookies and authorization are not
   forwarded to the media host.
7. Playback failures show a retry button. Retry remounts the media element and
   starts a new non-cacheable media request, resolving a fresh ticket. There is
   deliberately no fallback to the ad-supported iframe or a provider website.

Existing independent direct `playable_url` values take priority over embeds and
require no Streamtape credentials or relay. Legacy Streamtape watch pages
accidentally stored in `playable_url` are recognised too. An old Streamtape or
tapecontent download URL accompanied by a durable Streamtape embed ID is
refreshed through the endpoint instead of replaying the stale ticket. Other
providers retain their existing iframe sandbox; their in-frame ads are not
removed by this change.

## Required deployment setup

- Keep `VIDEO_PROVIDER=direct_url` (or leave it unset). Do **not** reactivate the
  retired Streamtape upload integration.
- Set `STREAMTAPE_LOGIN` and `STREAMTAPE_API_KEY` in the hosting platform's
  **server-only** environment, then redeploy. These are the same variables used
  for Streamtape thumbnail imports. Never use `NEXT_PUBLIC_*` or paste secrets
  into chat/source control.
- Allow server egress to `api.streamtape.com` **and** Streamtape/tapecontent media
  hosts. Ticket creation and media consumption must use consistent outbound IP
  routing; avoid different egress proxies for API and media requests.
- The app now relays legacy Streamtape video bytes. Hosting must permit streaming
  responses, the media bandwidth, and sufficiently long requests. The route
  declares a 180-second maximum, including ticket resolution and transfer;
  a hosting platform may enforce a shorter cap. Slow/large transfers that hit
  platform limits need a streaming-capable Node host or a durable direct CDN
  source. This is not a full-file download into serverless memory/storage.
- Direct MP4/WebM sources still go straight from their host to the browser.
- Resolved media links are cached in the server process for a few minutes. Every
  instance/replica keeps its own cache, so the first request on each one resolves
  a link and the rest do not; no shared store or extra configuration is involved.
- No database migration is required.

## Provider limitations — not a guaranteed ad blocker bypass

This uses the provider's download API, not scraping or disabling anti-adblock
checks. API access, file availability, account bandwidth, ticket restrictions,
codec support and the media host's browser access rules still apply. If an
account cannot issue a usable media link, retry cannot fix that. The same-origin
relay addresses server-versus-viewer IP binding, not deleted files, unsupported
codecs, account restrictions, or hosting transfer limits. Do not relax the
iframe sandbox or proxy advertising HTML.

For reliable ad-free hosting, use an authorised direct MP4/WebM source on a
host/CDN you control, with a browser-supported codec, HTTPS and byte-range
support. Replace the affected video's `playable_url` with that durable media
URL using trusted administrative tooling, or republish it through Admin →
Videos → Upload by link. A native direct URL takes priority over the old embed.
Never save a short-lived Streamtape download ticket as a permanent source.

## Verification

Unit tests cover source detection, direct-source precedence, stale-ticket
recovery, ticket caching/single-flight/TTL/eviction, the warm-up endpoint,
publication/access checks, native playback, pre-click buffer-ahead and retry,
byte ranges and HEAD, redirect allowlisting, HTML rejection, streamed bodies,
cancellation, connection timeouts, and preservation of other providers'
sandbox restrictions.

Live acceptance must be run on the deployed site with a real authorised file:

- Press Play video with browser ad blocking enabled, and also on mobile Safari.
- Confirm playback starts without the "Preparing video…" wait, that a seek is
  not followed by another provider ticket round trip, and that a second visit to
  the same video is equally quick.
- Confirm `POST /api/videos/{id}/prepare` answers `{"ready":true…}` (and never a
  URL), and that `/api/videos/{id}/playback` returns media bytes (not JSON, HTML
  or a redirect), and the browser successfully receives 200/206, plays, pauses
  and seeks. Test a long video and seek near the end. Signed provider URLs and
  API credentials must be absent from browser network logs.
- Confirm no Streamtape iframe is present, no ad window opens, and the page URL
  does not change. API credentials must be absent from browser network logs.
- Test a missing file/unavailable API and retry. Failure must never open an
  unsandboxed iframe or send the visitor to Streamtape.
- Verify a direct MP4 record still plays without any Streamtape API request.

The implementation sandbox cannot reach Streamtape, so mocked tests do not
prove real-account media playback. Production playback remains to be verified.
