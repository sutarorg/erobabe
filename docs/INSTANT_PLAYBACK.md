# Instant playback on the watch page

The visitor should see the first frame right after pressing Play, in Erobabe's
own player, with no provider player and no ad script. Nothing should wait on a
provider round trip *after* the click. This document describes how that works,
and what the trade-offs are. The security model of the Streamtape relay itself
is described in `docs/AD_FREE_PLAYBACK.md`.

## What used to be slow

1. The `<video>` element did not exist before the click, so the browser had
   fetched nothing: no metadata, no first chunk.
2. Streamtape issues a media link in two steps: `/file/dlticket`, then — only
   after the ticket's `wait_time`, documented as 10 seconds — `/file/dl`. The
   relay ran that whole handshake for **every** request.
3. A browser needs several byte-range requests to start an MP4 (a probe, the
   `moov` index that is often at the end of the file, then the first frames),
   and iOS Safari always probes with `Range: bytes=0-1` first. Each one paid the
   full wait, so visitors watched "Preparing video…" for 10–30 seconds, and
   every seek waited about 10 more seconds.

## What happens now

| Moment | What runs |
| --- | --- |
| HTML parsed (full page load) | A tiny inline script in the player's HTML sends `POST /api/videos/{id}/playback`. The server starts Streamtape's handshake right away and answers `204` once the link is ready. The answer never contains a URL. The page also preloads the poster and, for direct files, opens the connection to the media host (`<link rel="preconnect">`). |
| Player mounts | The site's `<video>` exists from the first paint, under the dimmed poster, the quality badge and the pink Play button. Direct files load metadata. Relayed Streamtape media fetches **nothing** yet. After a client-side navigation, where inline scripts never run, the player sends the prepare request itself. A production page sends it once either way. |
| Intent: pointer over the player, focus, touch | Direct files switch to `preload="auto"`. Relayed media switches to `preload="metadata"`, so the first bytes flow through the relay with the link prepared earlier. |
| Click | `video.play()` runs on the element that already exists, inside the click, so browsers allow sound. A spinner shows only if data is still arriving. |
| Playing | Every range request and seek reuses the cached link. The catalogue access decision is reused for 60 seconds. |
| Link older than 20 minutes | The old link keeps serving while a replacement is resolved in the background. A link older than 2 hours is never used. |
| Media host rejects a cached link | The link is discarded, and that request retries once with a fresh one before any error reaches the visitor. |
| Failure | A branded panel offers **Retry playback**. Retry reloads the element and calls `play()` inside the same click, which keeps the iOS user gesture, and resumes at the same position. |

## The media-link cache

`lib/video/playback-cache.ts` keeps resolved links in the memory of the server
process that resolved them. There is no database table, no shared store and no
configuration.

- **One handshake per file, shared.** Concurrent requests for the same file join
  a single in-flight handshake, which also keeps the number of provider API
  calls low.
- **Refreshed ahead of time.** After 20 minutes a link keeps serving while a
  replacement is resolved in the background, so seeks during a long video do
  not wait for a new ticket. A link is never used after 2 hours.
- **Self-healing.** A link the media host refuses (expired, egress-IP change,
  HTML instead of media) is dropped and replaced by exactly one fresh link. A
  link resolved for the current request is never retried, because a brand-new
  link would fail the same way. A visitor cancelling, or a host that never
  answers, does not discard a working link.
- **Fewer database round trips.** A positive access decision (published, public,
  rights-cleared, moderation-approved) is reused for 60 seconds. Failures are
  never cached, and unpublishing a video stops new playback within a minute.
- **Validated and private.** Links are cached only if they pass the same
  HTTPS Streamtape/tapecontent allowlist used for streaming. They never leave
  server memory: not the database, not a shared cache, not logs, not responses.
  At most 1,000 entries are kept; the least recently used go first.

### Why the prepare request goes to the playback route

The prepare request is a `POST` to the same route that streams the media, not a
separate endpoint and not the page render:

- Hosting platforms may deploy routes as separate functions, each with its own
  memory. On Vercel, for example, routes with different function settings
  (such as `maxDuration`) cannot share a function. A prepare endpoint in a
  different route can warm a different process than the one that later
  streams, which costs a second provider ticket and saves the visitor nothing.
  The playback route always lands in the streaming function.
- The page render cannot do it either: pages run in other functions, and the
  video cards prefetch watch pages, so preparing during render would start a
  provider handshake for every card on screen. Prefetching never executes the
  inline script, so a page full of cards prepares nothing.

## The site's player

`src/components/VideoPlayer.tsx` renders Erobabe's own controls on a native
`<video>` element. It is used for direct files and the Streamtape relay; other
providers keep their sandboxed iframe.

- **Design:** dimmed poster with the quality badge and the pink Play button. An
  auto-hiding gradient control bar carries play/pause, mute and a volume
  slider, and an accent seek bar with the buffered range and a time preview.
  It also shows elapsed and total time (the catalogue duration until metadata
  loads), playback speed (0.5–2×), picture-in-picture where supported, and full
  screen on the player itself. iPhone uses its native full-screen video view,
  the only one it allows.
- **Mouse:** click toggles playback, double-click toggles full screen.
- **Touch:** a tap starts playback, then shows or hides the controls.
- **Keyboard** (once the player has focus): Space/K play-pause, ←/→ ±5 s,
  J/L ±10 s, ↑/↓ volume, M mute, F full screen, Home/End, 0–9 jump to 0–90 %.
- The volume and mute choice is remembered.

## Endpoints

- `GET|HEAD /api/videos/{id}/playback` — the media source of the element. It
  checks access (a positive decision is reused for 60 seconds), streams a
  single byte range with backpressure, and answers `private, no-store`. Range
  and seek requests reuse the cached link.
- `POST /api/videos/{id}/playback` — prepare. Same UUID validation and access
  checks. Answers an empty `204` once the link is ready, or `404` (not
  published), `422` (not a Streamtape source) or `503` (provider unavailable).
  It never returns a URL, so it cannot reveal a source the watch page would not
  already serve, and it makes no provider call when a fresh link is cached.

No environment variables, migrations or hosting changes are required beyond the
Streamtape setup in `docs/AD_FREE_PLAYBACK.md`.

## Trade-offs

- **First play of a file:** if Play is pressed before the preparation finishes,
  the visitor waits for the rest of the ~10 s ticket. Pressing Play about 10
  seconds after the page opens finds the link ready.
- **Per-instance cache:** each server instance keeps its own cache, and it
  disappears on redeploy or a cold start. On a single long-running Node server
  (Fly, Render, Railway, a VPS) every visitor benefits. On serverless platforms
  a request that lands on a cold or different instance pays the handshake once
  for that instance. Vercel's Fluid compute routes concurrent requests to shared
  instances, which keeps the hit rate high. A shared cache would not help:
  links can be bound to the IP address that requested them.
- **Link lifetime:** Streamtape does not publish how long a `/file/dl` link
  lasts. Refreshing after 20 minutes and stopping at 2 hours are deliberate
  choices, and a rejected link heals itself with one retry.
- **Bandwidth:** relayed media is not fetched before the visitor shows intent,
  so a page view that never plays costs no relayed bandwidth and no
  long-running server request. Direct files load their metadata from their own
  host on page load.
- **Fastest option:** a durable direct MP4/WebM source on a CDN has no handshake
  at all, so even the very first play is instant.

## Verification

`npx vitest run` covers, among others:

- `tests/unit/playback-cache.test.ts` — one handshake per file, single flight,
  no caching of failures, invalidation that never drops a newer link,
  background refresh and maximum age, prepare as a no-op for a fresh link, and
  the bounded access-decision TTL.
- `tests/unit/video-playback-route.test.ts` — one link for the start-up and
  seek ranges, shared in-flight handshakes, the access-decision TTL, one
  transparent retry for a rejected cached link and none for a fresh one,
  keeping a working link when the visitor cancels, the prepare endpoint, and
  the existing range, access, allowlist and no-leak contracts.
- `tests/unit/streamtape-media.test.ts` — telling an expired link apart from a
  visitor who left or a media host that never answered.
- `tests/unit/video-player.test.tsx` — the element exists before the click; no
  relayed bytes before intent; the inline prepare script is server-rendered,
  sent once, injection-safe and harmless when `fetch` fails; the controls,
  keyboard and touch behaviour, and error recovery. No iframe or provider link
  ever appears.

The real provider behaviour — how long a new link takes, and that one link
serves the probe, the first frames and a seek — is checked with your own
credentials by `tests/live/streamtape-playback.live.test.ts` (see
`tests/live/README.md`):

```bash
STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… STREAMTAPE_PLAYBACK_FILE_ID=… npm run test:live
```

On the deployed site: open a video page, wait about 10 seconds, then press
Play. Playback should begin within about a second, and so should seeks. The
browser's network log should show only same-origin `/playback` requests, never
a provider URL.
