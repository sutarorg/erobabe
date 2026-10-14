# Erobabe — Premium Adult Entertainment Platform

Production-ready Next.js application with Supabase backend, NOWPayments crypto payments, Bunny Stream resumable device uploads, Resend email, AI metadata (DeepSeek V3.2 via OpenRouter), and SEO optimization.

## Quick Start

```bash
npm install
cp .env.example .env.local
# Fill env vars per DEPLOYMENT.md
npm run dev
```

Open http://localhost:3000

## Documentation

- `IMPLEMENTATION_AUDIT.md` — pre-implementation file-by-file audit
- `DEPLOYMENT.md` — click-by-click production setup
- `GO_LIVE_CHECKLIST.md` — operational requirements and blockers
- `IMPLEMENTATION_REPORT.md` — what changed, tests, blockers
- `.env.example` — env vars reference (no secrets)

## Stack

- Next.js 15 App Router
- Supabase (Auth, Postgres, Storage, RLS)
- NOWPayments (crypto payments)
- Resend (transactional email)
- OpenRouter API, DeepSeek V3.2 (server-generated video metadata)
- Bunny Stream direct pre-signed TUS uploads (`tus-js-client`)
- Tailwind CSS 4

## Video Uploads

`/admin/videos/upload` accepts multiple local videos through drag-and-drop or
**Choose videos**. Bytes go directly to Bunny Stream's TUS endpoint, never through
Next.js, Vercel functions or Supabase Storage. Per-file progress is measured;
concurrency is bounded to two. Cancellation pauses transfer; reselecting the same
source recovers its server session and resumable upload identity.

Ten actual frames throughout each clip are scored for detail, contrast, colour,
exposure and composition. The best frame becomes a restrained, sharpened 1280×720
JPEG stored via a signed upload to `video-thumbnails`. Thumbnail failure is
recoverable and prevents publication. Optional consent-gated OpenRouter vision
ranking is disabled by default and always falls back to local scoring.

Publication requires Bunny's documented Finished status (4), a verified stored
thumbnail and atomic session/video/job completion. Playback uses the validated
stored library ID/GUID at `iframe.mediadelivery.net`. Existing direct-media playback
and administrative tools remain; retired hosted records are unpublished and marked
**requiring re-upload**, with metadata preserved. No media migration is claimed.

Apply the new forward migration `00000000000012_bunny_stream_uploads.sql` after all
existing migrations; do not edit applied history. See [deployment section D](DEPLOYMENT.md#d-bunny-stream-device-uploads)
for credentials, content policy, recovery and a genuine staging upload test.
**Automated mocks/build are not live Bunny acceptance evidence.**

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