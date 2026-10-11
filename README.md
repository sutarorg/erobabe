# Erobabe — Premium Adult Entertainment Platform

Production-ready Next.js application with Supabase backend, Bcon crypto payments, video hosting abstraction, Resend email, Groq AI, and SEO optimization.

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
- Bcon Global (crypto payments)
- Resend (transactional email)
- Groq (server-generated video metadata)
- Tailwind CSS 4

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

See `GO_LIVE_CHECKLIST.md` — Uqload TOS prohibits adult content without written approval, hosting must permit adult/commercial, legal identity required, etc. Do not launch until blockers resolved.

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.
