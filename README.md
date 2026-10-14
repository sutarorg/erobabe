# Erobabe — Premium Adult Entertainment Platform

Production-ready Next.js application with Supabase backend, NOWPayments crypto payments, direct MP4 video publishing, Resend email, AI metadata (DeepSeek V3.2 via OpenRouter), and SEO optimization.

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
- `docs/STREAMTAPE_MIGRATION.md` — historical record of the retired Streamtape integration
- `.env.example` — env vars reference (no secrets)

## Stack

- Next.js 15 App Router
- Supabase (Auth, Postgres, Storage, RLS)
- NOWPayments (crypto payments)
- Resend (transactional email)
- OpenRouter API, DeepSeek V3.2 (server-generated video metadata)
- Direct MP4 URL publishing (no video hosting API needed)
- Tailwind CSS 4

## Video Publishing

Videos are published by pasting direct MP4 URLs into the admin panel
(`/admin/videos/upload`). Erobabe saves the link and plays the video straight
from the original host — it does not copy or host the full video file. Only
frame samples are fetched when generating a thumbnail. No hosting-provider
credentials, relay, or video-upload service is needed.

### Thumbnails, metadata, and video grids

- If no image is uploaded for a direct video link, ffmpeg automatically samples
  frames, rejects blank/dark/washed-out candidates, scores detail, contrast,
  colour, and exposure, and saves a vibrant 1280×720 JPEG. Uploaded images
  take priority; bulk generation also preserves images uploaded during capture.
- Capture needs a Node.js host that can execute the bundled ffmpeg binary (or
  `FFMPEG_PATH`), reach the media URL, and write to Supabase's public
  `video-thumbnails` bucket. Unreachable or unusable footage produces an admin
  warning, not a fabricated image. Embed-only player pages need a supplied
  image or a direct video-file link; they do not expose frames to this app.
- AI titles are descriptive, search-friendly, and non-graphic, up to 160
  characters. Generated descriptions **must contain 30–40 words**. Invalid AI
  descriptions are retried with feedback; prepared metadata and deterministic
  fallbacks obey the same limit. AI failure notices remain in the admin UI,
  not the public description. These rules apply to newly generated metadata,
  not a retroactive rewrite of existing records.
- “More like this”, Featured, and Latest sections share a responsive four-row
  grid with at most four columns (16 cards). At narrower widths the visible
  count follows the column count, preventing a fifth row. The legacy
  five-column video mode has been removed.

Visual-quality scoring is a thumbnail heuristic, not a guarantee of increased
click-through or conversion rates. Review generated metadata and images.

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
npx playwright test
```

## Production Blockers

See `GO_LIVE_CHECKLIST.md`. The current blockers are:

- **Hosting** must permit adult/commercial content (Vercel Hobby does not).
- **Legal identity, age assurance, NOWPayments approval, Resend domain verification.**

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.