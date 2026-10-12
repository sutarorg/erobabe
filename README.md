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
- `.env.example` — env vars reference (no secrets)

## Video hosting (UFOLOAD)

[UFOLOAD](https://ufoload.com) is the only upload and hosting provider (`VIDEO_PROVIDER=ufoload`; any other value fails closed with a configuration error). Historical Uqload videos are untouched and keep playing from their stored embed URL; nothing new is ever sent to Uqload.

- **Local files** go from the admin's browser straight to UFOLOAD's upload node in resumable chunks (2 GB limit). The server only starts the session (with the server-only `UFOLOAD_API_KEY`) and completes it — no video byte passes through this app.
- **Links** are imported by UFOLOAD itself, asynchronously (up to 10 at a time).
- A video stays **private while UFOLOAD processes it** and is published only when UFOLOAD reports it `ready`. The stable embed URL (`https://ufoload.com/e/{public_id}`) is what the public page plays.
- Finishing unattended work needs something to call `POST /api/videos/reconcile` — see `DEPLOYMENT.md` → “Background reconciliation”.
- Uploads stay **blocked until `UFOLOAD_ADULT_CONTENT_APPROVED=true`**, which must only be set after UFOLOAD confirms in writing that your adult-content use is permitted.

Setup, the live smoke test and the migration test procedure: `DEPLOYMENT.md` section D.

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
npm run test          # unit + contract tests (mocked UFOLOAD — see below)
npm run build
npm run test:e2e      # Playwright (needs browsers: npx playwright install)
```

The UFOLOAD tests run against a mock written from UFOLOAD's OpenAPI document: they prove the code follows the documented contract, **not** that a real upload works. The only test that talks to the real service is `tests/live/ufoload.live.test.ts`, which is skipped unless you switch it on (instructions in the file and in `DEPLOYMENT.md`). The Supabase migration can be checked against a real Postgres engine with `npm install --no-save @electric-sql/pglite && node scripts/verify-ufoload-migration.mjs`.

## Production Blockers

See `GO_LIVE_CHECKLIST.md` — UFOLOAD's written approval for adult content is required (its Terms of Service are a draft that does not address it), hosting must permit adult/commercial, legal identity required, etc. Do not launch until blockers resolved.

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.
