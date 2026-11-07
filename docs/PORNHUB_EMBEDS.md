# Video catalog: Pornhub embeds

The site no longer accepts uploads and no longer talks to Bunny Stream. Every
video in the catalog is an **embed** of a Pornhub video: we store the metadata
and the video's `viewkey`, and the watch page frames Pornhub's own player at
`https://www.pornhub.com/embed/<viewkey>`. No video file is copied into this
project, Supabase Storage, or the server.

## What was removed

| Area | Removed |
| --- | --- |
| Admin UI | `app/admin/(dashboard)/videos/upload/page.tsx`, the nav item, the thumbnail file upload and the "generate from frame" actions |
| Provider adapter | `lib/video/bunny.ts`, `bunny-validation.ts`, `auto-publish.ts`, `frame-thumbnail.ts`, `thumbnail-quality.ts`, `thumbnail-ranking.ts`, `thumbnail-style.ts` |
| API routes | `/api/videos/bunny/*`, `/api/videos/storage-token`, `/api/videos/status`, `/api/admin/videos/thumbnails` |
| Automation | `/api/cron/bunny-publish` and `.github/workflows/publish-sweep.yml` |
| Client utilities | `src/utils/bunnyUpload.ts`, `src/utils/localVideoThumbnail.ts` |
| Dependencies | `tus-js-client`, `@ffmpeg-installer/ffmpeg` |
| Database | migrations `…26_damplips_embeds.sql` (upload tables, Bunny functions, `videos.bunny_library_id`) and `…29_pornhub_embeds.sql` (Pornhub provider, viewkey unique index) |

Thumbnail images for **category cards** still use the `video-thumbnails` storage
bucket (`lib/video/storage.ts`); that is image storage, not a video pipeline.

## How the import works

The operator opens **Admin → Videos → Import from Pornhub**, ticks the
categories they want and presses **Start import**. For every selected category
the importer:

1. types the category's name into Pornhub's search
   (`https://www.pornhub.com/video/search?search=<category name>`), exactly as a
   visitor would;
2. reads the result pages in order, collecting each card's viewkey, title,
   poster and duration;
3. keeps only videos Pornhub marks **HD** — or, when a listing carries no HD
   badge at all, videos whose watch page advertises **720p or taller**;
4. skips teasers shorter than a minute and cards without a poster;
5. inserts the new videos and skips everything already in the catalog.

There is **no target and no cap**. The dashboard asks the server for one slice at
a time (`pages` search pages per request, four by default, twenty-five at most)
and continues from the cursor each slice returns until the response says
`exhausted`.

### What it writes

For each fixed erobabe category (`lib/public/fixed-categories.ts`):

| Column | Value |
| --- | --- |
| `provider` | `pornhub` |
| `provider_file_id` | the viewkey — the idempotency key |
| `source_name` / `source_url` | `pornhub` / `https://www.pornhub.com/view_video.php?viewkey=<viewkey>` |
| `title` | the video title |
| `thumbnail_url` | the poster the listing (or watch page) advertises, from `phncdn.com` |
| `duration_seconds` | the listing duration, or the watch page's when verified |
| `playable_url` | `NULL` — Pornhub media is never streamed through this site |
| `embed_url` | `https://www.pornhub.com/embed/<viewkey>` |
| `quality` / `resolution` | `HD` or `4K` / `1080p`, `720p`, … |
| `status` / `visibility` | `published` / `public`, or `pending_review` / `private` when staging drafts |
| `rights_status` | `cleared`, or `pending` when staging drafts |
| `moderation_status` | `approved` |
| `slug` | `<title-slug>-<viewkey>` — stable across runs |

### Why a video can never be imported twice

Three independent guards, in order:

1. the viewkeys already in the catalog are read before each insert;
2. a viewkey is claimed once per run, so two result pages (or two search
   phrases) cannot offer the same video twice;
3. `videos_pornhub_identity_idx` — a unique index on `provider_file_id` where
   `provider = 'pornhub'` — rejects a second row even if two runs race.

A conflict is not an error: it is counted as "already present".

## Running it

### From the dashboard

**Admin → Videos → Import from Pornhub** → tick categories → **Start import**.
Progress is shown per category ("search exhausted" or "in progress"), with the
running totals of new videos and already-present videos. **Stop** ends the run
after the slice in flight; everything imported so far stays.

### Nightly

`.github/workflows/pornhub-nightly-import.yml` calls
`GET /api/cron/pornhub-import?category=<slug>` for every category at 00:00 IST
and repeats the call until the route reports `exhausted`. The route authenticates
with `Authorization: Bearer $CRON_SECRET` and stops starting new slices after
about 220 seconds, so it answers inside a 300-second function limit.

Required repository secrets: `SITE_URL` and `CRON_SECRET`. Optional environment
variable: `PORNHUB_BASE_URL` (only for pointing the importer at a fixture host).

### Checking the result

```sql
select * from pornhub_category_counts;                       -- published per category
select provider, count(*) from videos group by provider;     -- catalog by source
select provider_file_id, count(*) from videos
  where provider = 'pornhub'
  group by 1 having count(*) > 1;                            -- must return no rows
```

## Limits and failure modes

* **Egress matters.** Pornhub answers its public search pages to browsers and
  refuses many datacenter addresses. A `403` is surfaced by the panel as
  "Pornhub refused the request from this server", never as "no new videos".
  There is no credential, login or bypass involved — the importer only performs
  plain GETs of pages any visitor can open.
* **Markup changes.** Discovery is anchored on the viewkey
  (`data-video-vkey` / `view_video.php?viewkey=`), which is product-stable rather
  than styling. If Pornhub renames everything, `tests/unit/pornhub-parse.test.ts`
  is the first thing to update, together with `lib/pornhub/parse.ts`.
* **No HD badge on a page.** The importer falls back to reading each watch page
  (bounded to 25 per request) and imports only 720p+ videos; unverified videos
  are reported as `unknownQuality` and retried by the next run.
* **A phrase that stops producing new videos** is abandoned after twelve pages,
  and the next configured phrase for that category is tried.
* **Takedown.** Because nothing is hosted, removing an embedded video is
  deleting its row (Admin → Videos → Delete), which writes a `media_retention`
  record with the original Pornhub URL. The `/dmca` and `/content-removal`
  pages are the published route for rights holders.

## Legacy damplips rows

Rows imported before this change keep playing: a stored direct host file is
streamed by our own player (`video.damplips.com`), with `/api/videos/stream` as
the proxy fallback and for HLS playlists whose segments must be rewritten.
`lib/damplips/parse.ts` survives only for that playback path — nothing imports
from damplips any more, and the old importer, CLI and cron job are gone.
