# Video catalog: damplips embeds

The site no longer accepts uploads and no longer talks to Bunny Stream. Every
video in the catalog is an **embed** of a damplips.com post: we store metadata and
a media destination, and the browser plays what damplips serves. No video file is
copied into this project, Supabase Storage, or the server.

## What was removed

| Area | Removed |
| --- | --- |
| Admin UI | `app/admin/(dashboard)/videos/upload/page.tsx`, the nav item, the thumbnail file upload and the "generate from frame" actions |
| Provider adapter | `lib/video/bunny.ts`, `bunny-validation.ts`, `auto-publish.ts`, `frame-thumbnail.ts`, `thumbnail-quality.ts`, `thumbnail-ranking.ts`, `thumbnail-style.ts` |
| API routes | `/api/videos/bunny/*`, `/api/videos/storage-token`, `/api/videos/status`, `/api/admin/videos/thumbnails` |
| Automation | `/api/cron/bunny-publish` and `.github/workflows/publish-sweep.yml` |
| Client utilities | `src/utils/bunnyUpload.ts`, `src/utils/localVideoThumbnail.ts` |
| Dependencies | `tus-js-client`, `@ffmpeg-installer/ffmpeg` |
| Database | migration `…26_damplips_embeds.sql` drops `bunny_uploads`, `filekosh_uploads`, `upload_jobs`, the Bunny SQL functions, and `videos.bunny_library_id`; provider now defaults to `damplips` |

Thumbnail images for **category cards** still use the `video-thumbnails` storage
bucket (`lib/video/storage.ts`); that is image storage, not a video pipeline.

## What it writes

For each fixed erobabe category (`lib/public/fixed-categories.ts`):

| Column | Value |
| --- | --- |
| `provider` | `damplips` |
| `provider_file_id` | damplips post id (`/p/<id>/`) — the idempotency key |
| `source_name` / `source_url` | `damplips` / the post page |
| `title` | the post headline |
| `thumbnail_url` | the poster the post advertises (`og:image`) |
| `duration_seconds` | `video:duration` / JSON-LD duration when published |
| `playable_url` | the mp4/HLS file the post serves, when it does |
| `embed_url` | the damplips player URL, when the page frames one |
| `status` / `visibility` | `published` / `public` (or `pending_review` / `private`) |
| `rights_status` | `cleared` (or `pending` with `--rights=pending`) |
| `moderation_status` | `approved` |
| `slug` | `<title-slug>-<post-id>` — stable across runs |

A unique index on `(provider, provider_file_id)` keeps one row per post.

## Running the import

Debug one URL first — this needs no database and tells you immediately whether
damplips is reachable from the machine and whether its current markup still
exposes a poster and a media destination:

```bash
npm run import:damplips -- --probe=https://www.damplips.com/p/67284/
#   200 https://www.damplips.com/p/67284/ (… bytes)
#   Post: …
#     poster: https://video.damplips.com/pics/…
#     duration: 754s
#     media: direct https://video.damplips.com/video7/717/79.mp4
#     reachable: 206 Partial Content · video/mp4 · accept-ranges: bytes · 2 bytes
```

The last line is a real `Range: bytes=0-1` request from the machine running the
command, so it answers the only question that matters for a direct file: does
the host hand these bytes to a player on this network?

Exit codes: `0` parsed, `1` host unreachable, `2` nothing recognised, `3` post
found but no media destination (`media: NOT FOUND`), `4` the media URL parsed but
the host did not answer (`reachable: NO`).

```bash
# all 12 categories, 110 targets (100+ minimum after skipped posts)
npm run import:damplips -- --categories=all --per-category=110

# one category, resolve only, no writes
npm run import:damplips -- --categories=hardcore --dry-run

# stage as private drafts for review
npm run import:damplips -- --categories=all --rights=pending

# keep a machine-readable report of the run
npm run import:damplips -- --categories=all --json=.cache/import-report.json

# re-resolve rows that are not storing a direct media file
npm run import:damplips -- --repair --dry-run   # report only
npm run import:damplips -- --repair             # write playable_url
```

`--repair` walks the catalog and, for every row whose `playable_url` is not a
media file (a post page, or a `/api/videos/stream` address an older run wrote),
re-reads the post page and stores the file it publishes — setting `embed_url` to
null. Rows that already hold a direct file are counted as healthy and **never
re-fetched**. Exit code `2` means at least one row could not be resolved
(the post no longer publishes a file).

Environment: `NEXT_PUBLIC_SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` (or
`SUPABASE_SECRET_KEY`). `DAMPLIPS_BASE_URL` may point at a mirror.

The dashboard route is the same importer: **Admin → Videos → Sync from
damplips** posts one category per request to
`/api/admin/damplips/import` (admin session required, 300 s budget, 200 videos
per request maximum) and shows per-category counts as each finishes.

### How a category is sourced

`lib/damplips/categories.ts` maps every fixed category to damplips taxonomy
slugs, in preference order, plus search terms as a fallback:

```ts
{ slug: "milf", categorySlugs: ["milf", "mature", "milfs"], searchTerms: ["milf"] }
```

The importer tries `/c/<slug>/` first and pages through the listing via
`rel="next"`. When a slug does not exist, or the listing runs out before the
quota, it continues with `/?s=<term>` search pages. A category that still cannot
reach 100 reports `fulfilled: false` with the reason — it never silently claims
success. When damplips renames a slug, update this file; no other code changes.

### Counting and deduplication

- A run shares one claim set across categories, so a post listed in several
  categories is imported once and counted for the first category that reached it
  (`skipped.duplicateAcrossCategories` reports the rest).
- A post is skipped when it has no poster and no media
  (`skipped.missingThumbnail`, `skipped.missingMedia`); unreadable pages are
  reported in `errors`.
- Re-running is safe: rows already in the category count towards the target and
  are not re-fetched.

## Playback

`selectPlaybackSource` (`lib/video/playback.ts`) is the only gate between a row
and a player:

- **direct** — `playable_url` is an http(s) file (mp4/webm/HLS) **or a damplips
  post page**. A post page stored as a "file" is resolved to real media by the
  proxy below, so it plays in our own player instead of being framed. Retired
  provider hosts (`streamtape`, `tapecontent`, `mediadelivery.net`) and retired
  provider values (`bunny`, `ufoload`, `uqload`, `filekosh`) are rejected as
  `unsupported`.
- **embed** — a YouTube/Vimeo player URL only. Nothing else is mounted in an
  iframe, and no damplips page is ever framed: damplips does not allow it, and
  every damplips row has a direct destination the proxy can resolve.

### Order of destinations

`playbackCandidates` decides what the element is handed, best first:

| Destination | Tried first | Why |
| --- | --- | --- |
| Direct file (`…/video7/717/79.mp4`) | **the host itself** | damplips publishes these on a public host, exactly like the `<source>` tag on its own post page. The element streams them directly — nothing is "prepared" — and the proxy is only the fallback for a host that refuses the request. |
| HLS playlist (`.m3u8`) | the proxy | a playlist is a document: every segment, key and rendition URI has to be rewritten to this origin before a frame can play. The raw URL is kept as a second attempt for Safari, which plays playlists natively. |
| Post page (`/p/<id>/`) | the proxy | it is HTML; only the proxy can turn it into a file. Never framed. |

A damplips file is requested with `referrerPolicy="no-referrer"`: hotlink
protection on these hosts rejects a **foreign** referer but allows a request
with none, which is why the poster already loads from the same host. The media
host itself is CDN-cached, sends `Content-Type: video/mp4`,
`Accept-Ranges: bytes` and `Access-Control-Allow-Origin: *`, so nothing about a
direct file needs a server in between.

**A file is never "prepared".** The "Preparing video…" line is rendered only for
a destination that genuinely has to be built first — a playlist manifest, or a
post page the proxy must resolve (`needsPreparation()`). Over a direct mp4 there
is no overlay at all: the element buffers and paints the first frame itself,
exactly as damplips' own player does. This is why the watch page opens on the
poster and starts on the first click instead of showing a preparation screen.

The player still has a safety deadline, but it is not a loading screen. A host
that accepts the connection and then says nothing fires no media `error` event
at all — the element just waits — so once playback has been asked for, an
attempt that has delivered **nothing whatsoever** within `STALL_TIMEOUT_MS`
(12 s) is abandoned for the next destination. An attempt that has any metadata or
bytes is left alone: a 100+ MB file on a slow line is downloading, not stuck, and
cutting it over to the proxy would make it slower.

`/api/videos/stream?src=…` is the proxy behind those destinations, and it:

- accepts a public `https://*.damplips.com` URL, **or** any public https host
  that carries a valid short-lived signature (see HLS below) — never loopback,
  link-local or private hosts, and never a bare foreign URL, so it is not an
  open proxy; a plain-`http` link is upgraded to https,
- **resolves a post page**: when the destination answers with HTML, the page is
  read (capped at 512 KB), the media URL it advertises is extracted with the
  same parser the importer uses, and that file is streamed instead. The
  resolution is cached for five minutes, because a `<video>` element issues
  many requests for one file,
- sends a browser user-agent plus `Referer: https://www.damplips.com/` and
  `Origin`, retries without `Origin` and then without either header when the
  host answers 401/403/451 (hotlink protection is configured differently on
  each host),
- forwards `Range`, passes through `content-type`, `content-range`,
  `content-length`, `content-encoding` and `accept-ranges`, and streams the body
  without storing it. Upstream is asked for `accept-encoding: identity`, so a
  re-encoded body can never reach a video element,
- **answers or gives up within `MEDIA_UPSTREAM_TIMEOUT_MS`** (12 s by default).
  The clock covers the response **headers** only and is cleared the moment they
  arrive, so a ten-minute file still streams for ten minutes — but a host that
  never answers can no longer hold the request, and therefore the player, open,
- names the container (`video/mp4`, `video/webm`, …) when the host labels the
  file `application/octet-stream`. Every response from this app carries
  `X-Content-Type-Options: nosniff`, so a generic binary type is not something a
  `<video>` element should have to guess at,
- only advertises `accept-ranges: bytes` when the host actually offered ranges
  (or answered with `206`). Claiming range support a host does not have makes a
  seeking player re-download the whole file on every seek,
- follows at most four redirects. A redirect may leave damplips for a media CDN,
  but only to a public https host; anything private is refused.

HLS (`.m3u8`) is the reason the proxy also *rewrites*: a playlist is a document
whose segment, key, init-map and rendition URIs are fetched separately by the
player. Those requests would otherwise go straight to damplips (blocked by CORS)
or be resolved against `/api/videos/stream` (404). `lib/video/hls.ts` rewrites
**every** URI to a proxy URL, so the player never talks to damplips itself.

Segments of a damplips playlist frequently live on a media CDN outside
`damplips.com`. Those URIs used to be left alone, which is what made HLS videos
fail with "the video could not be loaded" while plain mp4s played. They are now
proxied too, and stamped with a signature over that exact URL
(`lib/video/media-token.ts`, 6-hour lifetime). The route verifies the signature
before fetching a foreign host, so a genuine playlist plays end to end without
the endpoint becoming an open proxy. Set `MEDIA_PROXY_SECRET` to a dedicated
random string; without it the key falls back to the Supabase service key, and in
local development to the configured site URL.

Playlists play natively in Safari and through `hls.js` everywhere else. Because
a playlist is not always named `.m3u8`, and a file is not always what its URL
claims, the player tries the **other** strategy at the same address before it
gives up on a destination: `MEDIA_ERR_DECODE` / `MEDIA_ERR_SRC_NOT_SUPPORTED`
sends the source to `hls.js`, and an hls.js fatal error sends it back to the
plain element. A network failure is never retried in the other strategy, so a
dead destination still fails over quickly.

In the browser, the player tries that row's destinations in the order above: a
direct file first, the proxy behind it; and for a playlist or a post page, the
proxy first. Only when every destination has failed is the error shown — and the
"Preparing video…" label can no longer outlive the attempt that caused it. A
damplips **post page** is never framed: it has no direct fallback, because only
the proxy can turn it into media.

## Grid layout

Every video section on the public site shows **ten videos vertically on a phone** (one video per row), and four rows on desktop.
`src/hooks/useGridColumns.ts` measures the grid element: below 448px of
container width (the same 28rem `@md` container-query breakpoint the
Tailwind-driven listings use) a shelf is a single column, above it 2–4 whole
columns fit. The class-driven listings use
`grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4`, so measured
shelves and class-driven pages switch together. A caller-supplied `columnCount`
(Up Next) is a **cap**, never a way to force two cards into a phone.

Shelf sizing lives in `lib/public/shelf.ts` so the server queries and the
client grids use the same numbers:

| Constant | Value | Meaning |
| --- | --- | --- |
| `MOBILE_SHELF_LIMIT` | 10 | videos a phone shows in one recommendation/latest/featured shelf |
| `SHELF_VIDEO_LIMIT` | 16 | videos a wide panel can show — four rows of four — and the size every feed request asks for |
| `UP_NEXT_VIDEO_LIMIT` | 8 | cards (and impressions) for the decorative two-column Up Next shelf |

Asking for `SHELF_VIDEO_LIMIT` means a desktop shelf is never padded with a
partial row, while a phone still renders exactly the first ten cards. The
homepage requests **featured** and **recommended** at that limit, and any shelf
that comes back short is topped up from the public catalog: newest published
videos first, then the most-viewed ones (`getPopularVideos`), deduplicated by
slug. A shelf therefore fills up even when the hero carousel and Latest have
already claimed every recently published row, and it never repeats a card within
one shelf. A search result page uses the same catalog but its own layout.

## Player buffering

- The player is the first thing the watch page renders. A direct file is
  server-rendered as `<video src=… preload="auto">`, so the browser's preload
  scanner starts fetching media while the document is still parsing — before
  React hydrates and without waiting for recommendations.
- A playlist (`.m3u8`, or a file the browser cannot decode) starts on `hls.js`,
  but a browser that can play HLS itself — Safari and every iOS browser, where
  Media Source Extensions do not exist — is detected with `canPlayType` before
  the `hls.js` chunk is imported. The element then streams the playlist
  directly, which is both the first byte and the only working path on iOS.
- The watch page emits a `preconnect` for a directly contacted media host (the
  damplips stream proxy is same-origin, so it needs none), a `preconnect` for an
  embed host, and a high-priority `preload` of the poster whenever a poster is
  shown. An embed is mounted with `loading="eager"`; no poster is fetched for it.
- The browser still chooses how much media to buffer; `auto` can use more data
  than metadata-only loading, which is the deliberate tradeoff for fast
  playback.

## Streaming recommendations

The watch page fetches its video row once (`cache()` around the query, shared
with `generateMetadata`), streams the player and metadata, and then streams each
recommendation shelf in **its own `Suspense` boundary**: More like this,
Recommended for you / Discover videos, Most Liked, and Top Categories. A slow
ranking query therefore delays only its own skeleton (labelled
`Loading <shelf>`), never the player or the other shelves. Every feed request
asks for `SHELF_VIDEO_LIMIT`; More like this starts from the current category and
asks the ranked feed only when that category is too small to fill a shelf.

## Latest feed batching

`src/components/LatestVideoFeed.tsx` pages `/api/videos/feed` with the
timestamp/id cursor and loads **two shelves per request**: `columns × rows × 2`,
never less than two phone screens (`LATEST_FEED_MIN_BATCH`, 20) and never more
than the route accepts (24). The first request is sent before the grid has been
measured, so the minimum keeps a phone from needing a second request after its
first screenful. The IntersectionObserver sentinel uses a `2400px` root margin —
the next batch is requested about two screens before it is seen — and duplicate
rows are dropped as batches arrive. A spinner marks the fetch; the manual
retry button appears only after a failure.

## Playback latency

Playback has to feel instant, so the path from page to first frame is short by
construction:

| Cost | What removes it |
| --- | --- |
| Discovering the file behind a stored post page | The watch page resolves it **on the server** before rendering, so the `<video src>` in the HTML is already the media file (bounded to 1.2 s; past that the proxy resolves it instead). |
| Reading a 400 KB, ad-heavy page for a 60-byte tag | The page is read chunk by chunk and abandoned the moment a media URL appears — usually a few KB — and the connection is cancelled, not drained. |
| Paying that cost again for every byte range | Resolutions are cached in-process for 30 minutes (500 entries) and concurrent lookups are collapsed into one request. |
| Re-downloading the file on the next visit | Media responses carry `public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400`, so a browser or CDN copy is reused. Playlists stay short-lived (`max-age=30`). |
| Re-downloading after a reload | `If-None-Match` / `If-Modified-Since` are forwarded and a `304` is passed straight back; `If-Range` is forwarded so a seek resumes. |
| A cold connection to the poster host | The watch page emits `preconnect` + `dns-prefetch` for the poster host and `preload` for the poster, plus `preconnect` for any direct media host. |
| Waiting for a JavaScript chunk before buffering | The `<video>` ships with `preload="auto"` and its `src` in the server HTML; Safari/iOS stream playlists natively, and `hls.js` is only loaded where it is actually needed (`startFragPrefetch` on). |
| A slow shelf starving the player | Every recommendation shelf streams inside its own `Suspense` boundary, below the player. |

The one thing the proxy cannot remove is its own hop: bytes travel
damplips → proxy → browser. Deploying the app in a region close to damplips'
CDN is the single biggest remaining lever, and the edge cache headers above let
a CDN absorb repeat traffic instead of hitting a function per range request.

## Why playback is direct-first, and why the proxy cannot rescue it

Measured against production (`https://erobabe.vercel.app`), 2026-10-28:

```
GET /api/videos/stream?src=https://video.damplips.com/video7/717/43.mp4&debug=1
profiles: chrome / firefox / chrome-cross-site / curl / plain
  → all 403, text/html, reason "Just a moment..."
```

`Just a moment...` is **Cloudflare's managed challenge**. It is passed by running
JavaScript in a browser and returning a `cf_clearance` cookie bound to that
browser's IP and user-agent. A Node function cannot satisfy it — not with a
Chrome user-agent, not with client hints, not with a TLS fingerprint, not by
retrying. The same file answers `200 video/mp4`, `Accept-Ranges: bytes` to a
plain HTTP client elsewhere, and loads instantly in a real browser, so the file,
the host and hotlink rules are all fine; only our datacenter egress is
challenged.

Consequences, which the code follows:

- **Playback is direct-first.** The browser fetches `video.damplips.com`
  itself (`referrerpolicy="no-referrer"`, `preload="auto"`). That is the request
  Cloudflare expects from a browser and the one that works.
- **The proxy is a fallback, not a rescue.** For a visitor whose network blocks
  the media host it will fail with `502` and `x-media-block: challenge`, because
  our function meets the same challenge. Do not "fix" that by adding headers —
  `?debug=1` will show the same `Just a moment...` for every client.
- **The player explains it.** On failure it shows the destination, host
  reachability and the element's own error, and offers *Open the video
  directly*: a top-level navigation can solve the challenge a `<video>` cannot,
  and after that *Retry playback* returns to the direct file.
- **Do not chase this with fingerprints again.** Check `?debug=1` first: a
  `challenge: true` means the host wants a browser, and no request shape helps.

## Operational notes

- **Source credit.** The watch page does not display a "Source: damplips.com"
  line; the `source_url` column is still stored for takedowns and audit.
- **Rights and takedowns.** Imported rows are marked `cleared` so categories are
  populated immediately. That is a product decision, not a legal one: you are
  responsible for having the right to embed each item. Keep `/dmca` and
  `/content-removal` current; deleting a catalog row in the dashboard removes the
  embed and records a `media_retention` entry for review. Use
  `--rights=pending` if you prefer to review before anything is public.
- **Posters.** Damplips posters are hotlinked (`video.damplips.com` is allowed in
  `next.config.mjs → images.remotePatterns`). If a poster disappears, replace it
  with **Edit thumb** on the row.
- **Failure modes.** A listing that returns no cards, an off-site next link, a
  post without media, or an unreachable host are all reported per source; the run
  continues with the next source.
- **Category health.** The `damplips_category_counts` view and **Admin → System
  Health** show published damplips videos per category, which is how you confirm
  the 100-per-category target survived later curation.
