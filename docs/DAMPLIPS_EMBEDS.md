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
#     media: direct https://video.damplips.com/videos/67284.mp4
```

Exit codes: `0` parsed, `1` host unreachable, `2` nothing recognised, `3` post
found but no media destination (`media: NOT FOUND`).

```bash
# all 12 categories, 110 targets (100+ minimum after skipped posts)
npm run import:damplips -- --categories=all --per-category=110

# one category, resolve only, no writes
npm run import:damplips -- --categories=hardcore --dry-run

# stage as private drafts for review
npm run import:damplips -- --categories=all --rights=pending

# keep a machine-readable report of the run
npm run import:damplips -- --categories=all --json=.cache/import-report.json
```

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

- **direct** — `playable_url` is an http(s) file (mp4/webm/HLS). Retired provider
  hosts (`streamtape`, `tapecontent`, `mediadelivery.net`) and retired provider
  values (`bunny`, `ufoload`, `uqload`, `filekosh`) are rejected as `unsupported`.
- **embed** — `embed_url` on a damplips host, or a YouTube/Vimeo player URL.
  Nothing else is mounted in an iframe.

Damplips files are played through `/api/videos/stream?src=…`, a small proxy that:

- only starts a request for a public `https://*.damplips.com` URL (no open
  proxy, no loopback/link-local/private hosts); a plain-`http` damplips link is
  upgraded to https,
- sends a browser user-agent plus `Referer: https://www.damplips.com/` and
  `Origin`, retries without `Origin` and then without either header when the
  host answers 401/403/451 (hotlink protection is configured differently on
  each host),
- forwards `Range`, passes through `content-type`, `content-range`,
  `content-length`, `content-encoding` and `accept-ranges`, and streams the body
  without storing it. Upstream is asked for `accept-encoding: identity`, so a
  re-encoded body can never reach a video element,
- follows at most four redirects. A redirect may leave damplips for a media CDN,
  but only to a public https host; anything private is refused.

HLS (`.m3u8`) is the reason the proxy also *rewrites*: a playlist is a document
whose segment, key, init-map and rendition URIs are fetched separately by the
player. Those requests would otherwise go straight to damplips (blocked by CORS)
or be resolved against `/api/videos/stream` (404). `lib/video/hls.ts` rewrites
every URI to a proxy URL, so the player never talks to damplips itself. Playlists
play natively in Safari and through `hls.js` everywhere else.

In the browser, the player tries the proxy first and, if that destination fails,
the direct file (with no referer, which hotlink protection usually allows) before
showing an error. A damplips **post page** stored in `playable_url` is framed as
an embed instead of being fed to a `<video>` element.

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
