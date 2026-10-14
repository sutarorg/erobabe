# Streamtape “Client blocked” and ad-free playback

## Cause and fix

The watch page used Streamtape's third-party player in a sandboxed iframe. Its
sandbox disallows popups and top-level navigation, which conflicts with hosts
that detect these restrictions. Removing the sandbox or adding `allow-popups`
would permit advertising windows/redirects; it is not an ad-free fix.

Streamtape `/e/`, `/v/`, and `/d/` links on the recognised `.com`, `.net`, and
`.to` domains now use the site's native `<video>` player instead:

1. The watch page renders the site's own player: a native `<video>` element
   that exists from the first paint, with the poster and the Erobabe play
   control on top. No provider iframe or ad script is loaded — before, during
   or after playback. While the page is still loading it sends
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
   [Instant start](#instant-start)). A cached link the media host refuses is
   dropped and replaced by exactly one freshly issued link before the visitor
   sees an error. Cancelling a media response aborts its upstream fetch. The
   connection timeout ends once media headers arrive; it does not cut off an
   active video after 30 seconds.
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

Pressing Play no longer waits for Streamtape's ticket. The server prepares the
media link while the page is still loading, and keeps it in memory. Every byte
range and seek reuses that link, and ageing links are refreshed in the
background. The site's player has its `<video>` element ready before the click.
Relayed media is not fetched until the visitor shows intent (pointer, focus or
touch), so page views that never play cost no relayed bandwidth.

How it works, its trade-offs (the first play of a file can still wait for the
rest of the ~10 s ticket if Play is pressed very early) and how to verify it are
described in `docs/INSTANT_PLAYBACK.md`. A durable direct MP4/WebM source on a
CDN has no handshake at all and remains the fastest option.

## Required deployment setup

- Keep `VIDEO_PROVIDER=direct_url` (or leave it unset). Do **not** reactivate the
  retired Streamtape upload integration.
- Set `STREAMTAPE_LOGIN` and `STREAMTAPE_API_KEY` in the hosting platform's
  **server-only** environment, then redeploy. These are the same variables used
  for Streamtape thumbnail imports. Never use `NEXT_PUBLIC_*` or paste secrets
  into chat/source control.
- Resolved media links are cached in the server process (refreshed after 20
  minutes, never used after 2 hours). Every instance/replica keeps its own
  cache, so the first request on each one resolves a link and the rest do not;
  no shared store or extra configuration is involved.
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
They also cover the instant-start behaviour listed in
`docs/INSTANT_PLAYBACK.md`: link reuse across range requests, shared in-flight
handshakes, background refresh and maximum age, one transparent retry for a
rejected cached link (and none for a fresh one), the access-decision TTL, the
prepare request, the inline prepare script (sent once, safe against markup
injection, harmless when `fetch` fails), and the player's controls,
intent-based preloading, keyboard/touch behaviour and error recovery.

The real Streamtape behaviour the unit suite can only simulate — how long a new
link really takes, and that one link serves the probe, the first frames and a
seek — is checked by `tests/live/streamtape-playback.live.test.ts` with your
own credentials and any file id (see `tests/live/README.md`):

```bash
STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… STREAMTAPE_PLAYBACK_FILE_ID=… npm run test:live
```

Live acceptance must be run on the deployed site with a real authorised file:

- Press Play video with browser ad blocking enabled, and also on mobile Safari.
- Open a video page, wait ~10 seconds, then press Play: playback should begin
  within about a second, without the old "Preparing video…" wait. Seeking
  should resume within about a second too, with no new provider ticket, and a
  second visit to the same video should be equally quick.
- Confirm `POST /api/videos/{id}/playback` answers an empty `204` (never a
  URL) once the page has opened.
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
