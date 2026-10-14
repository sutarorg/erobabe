# Streamtape “Client blocked” and ad-free playback

## Cause and fix

The watch page used Streamtape's third-party player in a sandboxed iframe. Its
sandbox disallows popups and top-level navigation, which conflicts with hosts
that detect these restrictions. Removing the sandbox or adding `allow-popups`
would permit advertising windows/redirects; it is not an ad-free fix.

Streamtape `/e/`, `/v/`, and `/d/` links on the recognised `.com`, `.net`, and
`.to` domains now use the site's native `<video>` player instead:

1. The watch page renders the site's own player. No provider iframe or ad
   script is loaded. As soon as the player mounts it sends
   `POST /api/videos/{catalog-uuid}/playback`, asking the server to prepare the
   media link (see [Instant start](#instant-start)); the response is an empty
   `204` and never contains a URL.
2. `GET /api/videos/{catalog-uuid}/playback` checks that the video is published,
   public, rights-cleared and moderation-approved using the regular Supabase
   client (no service-role bypass).
3. The server calls the official `/file/dlticket` and `/file/dl` APIs and
   **consumes the resulting download URL on the server**, rather than sending it
   to the browser. Download URLs can be IP-bound: a ticket created on the server
   can fail with HTTP 403 when fetched from a visitor's different IP. Reissuing
   another server-bound link to the browser does not fix that failure.
4. The native player uses `/api/videos/{catalog-uuid}/playback` as its media
   source. This endpoint streams bytes with backpressure (no full-file buffer),
   forwards single byte ranges, preserves 200/206/416 and media/range headers,
   and supports HEAD probes. Links are resolved on, and only used by, the
   instance that streams them, and are reused across requests (see
   [Instant start](#instant-start)). Cancelling a media response aborts
   its upstream fetch. The connection timeout ends once media headers arrive;
   it does not cut off an active video after 30 seconds.
5. The response is `private, no-store`. Tickets and API credentials stay
   server-side and are never saved to the DB. Redirects are followed manually,
   validating each destination against the HTTPS Streamtape/tapecontent
   allowlist. HTML/player pages, API hosts, credential-bearing URLs and upstream
   error bodies are not relayed. Browser cookies and authorization are not
   forwarded to the media host.
6. Playback failures show a retry button. Retry reloads the media element and
   starts a new non-cacheable media request, resuming at the same position. A
   link the media host rejected has already been discarded on the server, so
   that request resolves a fresh ticket. There is deliberately no fallback to
   the ad-supported iframe or a provider website.

Existing independent direct `playable_url` values take priority over embeds and
require no Streamtape credentials or relay. Legacy Streamtape watch pages
accidentally stored in `playable_url` are recognised too. An old Streamtape or
tapecontent download URL accompanied by a durable Streamtape embed ID is
refreshed through the endpoint instead of replaying the stale ticket. Other
providers retain their existing iframe sandbox; their in-frame ads are not
removed by this change.

## Instant start

### Why Play used to take 10–30 seconds

Streamtape issues a media link in two steps: `/file/dlticket`, then — only after
the ticket's `wait_time`, documented as 10 seconds — `/file/dl`. The relay used
to run that handshake for **every** request. A browser needs several byte-range
requests to start an MP4 (a probe, the `moov` index that is often at the end of
the file, then the first frames), and iOS Safari always probes with
`Range: bytes=0-1` first. Each one paid the full wait, so visitors watched
"Preparing video…" for 10–30 seconds, and every seek waited ~10 more seconds.
The player also only created its `<video>` element after the click.

### What happens now

- **One handshake per file, shared.** `lib/video/playback-cache.ts` keeps each
  resolved link in the memory of the server process that resolved it.
  Concurrent requests for the same file share a single in-flight handshake.
  Range, seek and HEAD requests reuse the link, so they start streaming at once.
- **Prepared before Play.** The player's `POST` on page open runs the handshake
  while the visitor is still reading, so pressing Play normally finds the link
  ready. The `POST` goes to the playback route itself (not the page render) so
  the prepared link lands in the same server function that streams it, also on
  platforms that deploy pages and API routes as separate functions.
- **Ageing links refresh in the background.** After 20 minutes a link keeps
  serving while a replacement is resolved; after 2 hours it is never used.
- **Self-healing.** If the media host rejects a cached link (expired,
  egress-IP change, HTML instead of media), the link is discarded and the
  request transparently retries once with a fresh one. A link that was resolved
  for the current request is never retried, and a visitor cancelling or a host
  that never answers does not discard a working link.
- **Fewer database round trips.** A positive access decision is reused for 60
  seconds; failures are never cached. Unpublishing a video stops new playback
  requests within a minute.
- Links are only ever cached if they pass the same media-URL validation used
  for streaming, and they never leave server memory: not the database, not a
  shared cache, not logs, not responses.

### The site's player

`src/components/VideoPlayer.tsx` renders Erobabe's own controls on a native
`<video>` (used for direct files and the Streamtape relay; other providers keep
their sandboxed iframe):

- The `<video>` exists from the first paint, so Play calls `play()` on a ready
  element inside the click (which also lets browsers start with sound). A
  spinner appears only after Play is pressed and data is still arriving.
- Direct files preload metadata immediately and buffer more once the pointer is
  over the player. Relayed Streamtape media starts fetching on intent (pointer,
  focus or touch) rather than on page load, so a page view that never plays
  costs no relayed video bandwidth or long-running server request.
- Design: dimmed poster with the quality badge and the pink play button, an
  auto-hiding gradient control bar with play/pause, mute and volume, accent seek
  bar with buffered range and time preview, elapsed/total time (catalogue
  duration until metadata loads), playback speed, picture-in-picture where
  supported, and full screen on the player itself (iPhone uses the native
  full-screen video view, the only one it allows).
- Mouse: click toggles playback, double-click toggles full screen. Touch: a tap
  starts playback, then shows/hides the controls. Keyboard (once the player has
  focus): Space/K play-pause, ←/→ ±5 s, J/L ±10 s, ↑/↓ volume, M mute,
  F full screen, 0–9 jump to 0–90 %. The volume and mute choice is remembered.

### Hosting notes

The link cache is per server process. On a single long-running Node server
(Fly, Render, Railway, a VPS) every visitor benefits. On serverless platforms
each instance has its own cache: a request served by a cold or different
instance pays the handshake once for that instance. Vercel's Fluid compute
routes concurrent requests to shared instances, which keeps the hit rate high.
The very first play of a file can still wait for the remainder of the ~10 s
ticket if Play is pressed before the preparation finishes. A durable direct
MP4/WebM source on a CDN has no handshake at all and remains the fastest option.

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
recovery, publication/access checks, native playback and retry, byte ranges and
HEAD, redirect allowlisting, HTML rejection, streamed bodies, cancellation,
connection timeouts, and preservation of other providers' sandbox restrictions.
They also cover link reuse across range requests, shared in-flight handshakes,
background refresh and maximum age, one transparent retry for a rejected cached
link (and none for a fresh one), the access-decision TTL, the prepare endpoint,
and the player's controls, intent-based preloading, keyboard/touch behaviour
and error recovery.

Live acceptance must be run on the deployed site with a real authorised file:

- Press Play video with browser ad blocking enabled, and also on mobile Safari.
- Open a video page, wait ~10 seconds, then press Play: playback should begin
  within about a second. Seeking should resume within about a second too.
- Confirm `/api/videos/{id}/playback` returns media bytes (not JSON, HTML or a
  redirect), and the browser successfully receives 200/206, plays, pauses and
  seeks. Test a long video and seek near the end. Signed provider URLs and API
  credentials must be absent from browser network logs.
- Confirm no Streamtape iframe is present, no ad window opens, and the page URL
  does not change. API credentials must be absent from browser network logs.
- Test a missing file/unavailable API and retry. Failure must never open an
  unsandboxed iframe or send the visitor to Streamtape.
- Verify a direct MP4 record still plays without any Streamtape API request.

The implementation sandbox cannot reach Streamtape, so mocked tests do not
prove real-account media playback. Production playback remains to be verified.
