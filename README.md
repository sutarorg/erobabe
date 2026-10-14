# Erobabe — Premium Adult Entertainment Platform

Production-ready Next.js application with Supabase backend, NOWPayments crypto payments, gated FileKosh device uploads, Resend email, AI metadata (DeepSeek V3.2 via OpenRouter), and SEO optimization.

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
- FileKosh presigned browser PUT uploads (provider verification required)
- Tailwind CSS 4

## Video Uploads

`/admin/videos/upload` accepts multiple local video files through drag-and-drop or
**Choose videos**. There is no URL-import method. Videos PUT directly from the
browser to FileKosh storage, with measured per-file progress and bounded concurrency.
Actual local frames are captured into JPEG thumbnails and PUT to Supabase Storage.
A video becomes public only after verified `READY` metadata and atomic database persistence.
Existing direct-media and generic-embed records keep stored playback. Retired
Streamtape records are retained but explicitly unsupported; no provider API or relay remains.

**Not yet live-verified:** The official FileKosh docs still omit the confirmation
body, accepted format matrix and upload headers/CORS details. The implementation
fails closed until the operator supplies a verified contract and browser-upload
configuration. A key alone does not enable uploads. See [deployment section D](DEPLOYMENT.md#d-filekosh-device-uploads)
and [the API research](docs/FILEKOSH_API_RESEARCH.md). Do not fabricate configuration
or treat passing mocks as a successful provider upload.

Apply migration `00000000000011_filekosh_uploads.sql` forward, without editing old
migrations. The generated thumbnail uses `video-thumbnails`; videos never pass
through Next.js or Supabase. Existing manual thumbnail/category/carousel tools,
authentication, advertiser and payment features remain.

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