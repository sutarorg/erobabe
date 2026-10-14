# Instant playback on the watch page

The visitor should see the first frame right after pressing play. Nothing on the
watch page may wait for a network round trip *after* the click. This document
describes how that is achieved, and what the trade-offs are.

## What used to be slow

1. The `<video>` element did not exist before the click, so the browser had
   fetched nothing: no metadata, no first chunk, no provider ticket.
2. For Streamtape-backed videos, the click started two sequential provider API
   calls (`/file/dlticket` → `/file/dl`), plus any `wait_time` the API asked for.
   Only then did the first byte of video leave the server.
3. Every later range request — the first chunk, each seek — repeated that
   resolution because no link was kept.
4. Nothing hinted the browser at the media host, so the DNS + TLS handshake to a
   direct file's host also happened after the click.

The result was the "Preparing video…" wait the visitor saw.

## What happens now

| Step | What runs |
| --- | --- |
| Page render (before the click) | The site's own `<video>` element is mounted with `preload="metadata"`, the poster and the Erobabe play control on top. The browser starts the media request itself. |
| Same moment | `POST /api/videos/{id}/prepare` asks the server to resolve and cache the media link (Streamtape only; direct files need nothing). |
| 1.2 s later, or on hover / press / focus / touch | The element switches to `preload="auto"` (and `load()` applies it), so it buffers the first seconds behind the poster. |
| Click | `video.play()` on the element that is **already** buffering. No remount, no new source, no ticket. |
| Playing | Seeks are range requests answered from the cached media link. |
| Failure | A branded error panel with **Retry playback**, which remounts the element and resolves a fresh link. |

Direct MP4/WebM sources additionally get `<link rel="preconnect">` to their host
and a poster preload hint from the server-rendered watch page, so the handshake
and the poster start before React hydrates.

## The media-link cache

`lib/video/streamtape-tickets.ts` holds resolved media links for **4 minutes**,
at most 100 of them, in the server process. It is a plain `Map`; there is no
database table and no configuration.

- Concurrent requests for the same file share one resolution (single flight),
  which also keeps the provider's rate limits happy.
- Every link is validated against the HTTPS Streamtape/tapecontent allowlist
  before it is stored, so a bad API answer can never be replayed later.
- A link the media host refuses is forgotten and replaced by exactly one freshly
  issued link, then the visitor sees the failure only if that one fails too.
- Links are still consumed **server-side**; the browser only ever sees
  `/api/videos/{id}/playback` streaming bytes. Nothing is logged or persisted.

Trade-offs, stated plainly:

- The cache is per server instance and disappears on redeploy or a cold start.
  A shared multi-instance deployment therefore warms per instance: the first
  request on an instance pays the ticket cost, every later one does not. This is
  the intended best-effort behaviour, not a correctness requirement.
- Streamtape does not publish the lifetime of a `/file/dl` link. Four minutes is
  a deliberately conservative window; a rejected link is retried with a fresh
  one before any error reaches the visitor.
- Because the element is mounted with the page, a visitor who never presses play
  has still requested the head of the video (metadata, then a little more after
  the buffer-ahead timer). On the watch page that is the right trade for instant
  playback; the grids and cards do not preload any media.

## Endpoints

- `GET|HEAD /api/videos/{id}/playback` — the media source of the element.
  Rechecks published / public / rights-cleared / moderation-approved, streams a
  single byte range with backpressure, `private, no-store`. Unchanged contract;
  only the link resolution is now cached.
- `POST /api/videos/{id}/prepare` — warm-up. Same access checks, same UUID
  validation, answers `{"ready":true,"provider":"streamtape"|"direct"|"embed"}`
  or `{"ready":false,"reason":"…"}`. It never returns a URL, so it cannot be used
  to discover a source the watch page would not already serve, and it performs no
  provider call when a link is already cached.

No environment variables, migrations or hosting changes are required.

## Verification

`npx vitest run` covers, among others:

- `tests/unit/streamtape-tickets.test.ts` — resolve once/reuse, single flight,
  TTL expiry, forget-on-demand, allowlist rejection, upstream rejection is never
  cached, bounded cache, malformed ids ignored.
- `tests/unit/video-prepare-route.test.ts` — warm-up resolves and caches without
  leaking the URL, re-checks access, fails closed, does not cache a non-media
  URL.
- `tests/unit/video-playback-route.test.ts` — the click and every seek reuse the
  cached link, a rejected cached link is replaced by a fresh one, plus the
  existing range/HEAD/access/no-leak contracts.
- `tests/unit/video-player.test.tsx` — the element is mounted on load, the
  warm-up call is made before the click, buffering starts behind the poster,
  play reuses the buffered element instead of remounting it, retry remounts, and
  no iframe or provider link ever appears.

Real latency can only be confirmed on the deployed site with a real file: press
play, seek, and check the browser network log shows no provider URL and no
second ticket round trip.
