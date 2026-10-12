# Erobabe — Premium Adult Entertainment Platform

Production-ready Next.js application with Supabase backend, NOWPayments crypto payments, UFOLOAD video hosting, Resend email, Gemini AI, and SEO optimization.

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
- `tests/live/README.md` — how to run the optional live UFOLOAD tests
- `.env.example` — env vars reference (no secrets)

## Stack

- Next.js 15 App Router
- Supabase (Auth, Postgres, Storage, RLS)
- NOWPayments (crypto payments)
- Resend (transactional email)
- Gemini API (server-generated video metadata)
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

See `GO_LIVE_CHECKLIST.md`. The current blockers are:

- **UFOLOAD approval** — its Terms of Service carry no explicit adult-content clause, so
  uploads stay gated (`UFOLOAD_ADULT_CONTENT_APPROVED=false` fails every upload closed)
  until the provider confirms lawful adult content, commercial use, API uploads and
  embedded playback in writing.
- **Hosting** must permit adult/commercial content (Vercel Hobby does not).
- **Legal identity, age assurance, NOWPayments approval, Resend domain verification.**

Do not launch until the blockers are resolved.

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.
