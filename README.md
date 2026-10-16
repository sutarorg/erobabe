# Erobabe — Premium Adult Entertainment Platform

Next.js application under production-readiness review with Supabase backend, NOWPayments crypto payments, Bunny Stream resumable device uploads, Resend email, AI metadata (NVIDIA Nemotron 3 Ultra free route via OpenRouter), and SEO optimization.

## Quick Start

```bash
npm ci
cp .env.example .env.local
# Fill env vars per DEPLOYMENT.md
npm run dev
```

Open http://localhost:3000

## Documentation

- `AUDIT_REPORT.md` — current findings and fixes
- `PRODUCTION_READINESS.md` — verified evidence and release blockers
- `CLEANUP_MANIFEST.md` — removed code and proof of non-use
- `docs/WORKFLOW_MAP.md` — inspected business/data flows
- `IMPLEMENTATION_AUDIT.md` — historical implementation notes (not current launch evidence)
- `DEPLOYMENT.md` — click-by-click production setup
- `GO_LIVE_CHECKLIST.md` — operational requirements and blockers
- `IMPLEMENTATION_REPORT.md` — what changed, tests, blockers
- `.env.example` — env vars reference (no secrets)

## Stack

- Next.js 15 App Router
- Supabase (Auth, Postgres, Storage, RLS)
- NOWPayments (crypto payments)
- Resend (transactional email)
- OpenRouter API, NVIDIA Nemotron 3 Ultra (free route; server-generated video metadata)
- Bunny Stream direct pre-signed TUS uploads (`tus-js-client`)
- Tailwind CSS 4

## Video Uploads

`/admin/videos/upload` accepts multiple local videos through drag-and-drop or
**Choose videos**. Bytes go directly to Bunny Stream's TUS endpoint, never through
Next.js, Vercel functions or Supabase Storage. The optional `BUNNY_UPLOAD_MAX_BYTES` sets an operator upload budget; without it there is no application-level video
size cap, and four files upload in parallel with per-file progress. Bunny encoding
runs asynchronously: each accepted upload appears immediately in `/admin/videos`
with status **Encoding**, while upload workers continue to the next files. Closing
the tab does not stop it — a scheduled sweep (`/api/cron/bunny-publish`, armed by
`CRON_SECRET` plus the `Publish finished uploads` GitHub Actions workflow) reads
Bunny's status server-side and publishes
each video as soon as encoding finishes, with no browser involved. Cancellation
pauses transfer; reselecting the same source
recovers its server session and resumable upload identity.

Ten actual frames throughout each clip are scored for detail, contrast, colour,
exposure and composition. The best frame becomes a restrained, sharpened 1280×720
JPEG stored via a signed upload to `video-thumbnails`. Thumbnail failure is
recoverable and prevents publication. Optional consent-gated OpenRouter vision
ranking is disabled by default and always falls back to local scoring.

Publication requires Bunny's documented Finished status (4), a verified stored
thumbnail, atomic session/video/job completion, and explicit rights/moderation approval. Playback uses the validated
stored library ID/GUID at `iframe.mediadelivery.net`. Existing direct-media playback
and administrative tools remain; retired hosted records are unpublished and marked
**requiring re-upload**, with metadata preserved. No media migration is claimed.

AI titles and descriptions come from OpenRouter only — never composed offline.
One request drafts several titles at a time and all waiting queue entries share
one retry loop, so a batch upload neither exhausts the request budget nor stalls
on rate limits; a provider outage simply keeps retrying until the model answers.

Apply the forward migrations `00000000000012_bunny_stream_uploads.sql` and
`00000000000013_bunny_background_encoding.sql` after existing migrations; do not
edit applied history. See [deployment section D](DEPLOYMENT.md#d-bunny-stream-device-uploads)
for credentials, content policy, recovery and a genuine staging upload test.
**Automated mocks/build are not live Bunny acceptance evidence.**

## Homepage carousel

`/admin/videos` places up to three videos in the homepage hero carousel (slots
1–3). The card is a thumbnail with two short lines, so the listing title — written
for search — is never printed there. Assigning a slot also generates that video's
own copy through the AI (NVIDIA Nemotron 3 Ultra free route via OpenRouter): a
headline of **at most 5 words** and a description of **at most 10 words**, stored in
`videos.carousel_title` / `videos.carousel_description` (migration
`00000000000020_carousel_ai_copy.sql`). The admin page shows the copy and can
regenerate it per slot. If OpenRouter is unconfigured or answers with something
unusable, the listing text is shortened to the same budget instead — the slot is
always saved, and the row says which happened. `lib/metadata/carousel-copy.ts`
holds the word budget, so every path (AI prompt, API, public card) agrees.

## Routes

Public: `/`, `/categories`, `/category/[slug]`, `/latest`, `/popular`, `/video/[slug]`, `/about`, `/terms`, `/privacy`, `/contact`, `/faq`, `/content-removal`

Advertiser: `/advertiser`, `/advertiser/slots`, `/advertiser/campaigns`, `/advertiser/campaigns/new`, `/advertiser/payments`, `/advertiser/invoices`, `/advertiser/analytics`, `/advertiser/profile`, `/advertiser/support`

Admin: `/admin`, `/admin/videos`, `/admin/videos/upload`, `/admin/categories`, `/admin/advertisements`, `/admin/ad-slots`, `/admin/advertisers`, `/admin/campaigns`, `/admin/payments`, `/admin/reports`, `/admin/users`, `/admin/logs`, `/admin/system-health`

SEO: `/sitemap.xml`, `/video-sitemap.xml`, `/robots.txt`

## Testing

```bash
npm run type-check
npm run test
npm run build
npm run test:e2e
```

## Production Blockers

See `GO_LIVE_CHECKLIST.md`. The current blockers are:

- **Hosting** must permit adult/commercial content (Vercel Hobby does not).
- **Legal identity, age assurance, NOWPayments approval, Resend domain verification.**

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.