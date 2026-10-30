# Erobabe — Premium Adult Entertainment Platform

Next.js application under production-readiness review with Supabase backend, guest PayPal advertising checkout, a video catalog embedded from damplips.com, Resend email, AI metadata (NVIDIA Nemotron 3 Ultra free route via OpenRouter), and SEO optimization.

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
- PayPal QR checkout with manual staff payment verification
- Resend (transactional email)
- OpenRouter API, NVIDIA Nemotron 3 Ultra (free route; server-generated video metadata)
- damplips.com embeds (HLS/mp4 playback through a same-origin proxy, `hls.js`)
- Tailwind CSS 4

## Video Catalog — damplips embeds

There are no uploads any more. `app/admin/(dashboard)/videos/upload`, the Bunny
Stream adapter, its API routes and the publish-sweep cron were removed, and
migration `00000000000026_damplips_embeds.sql` drops the upload tables and the
Bunny library column.

The catalog is filled from damplips.com. For each fixed category the importer
reads damplips' listing pages and post pages and stores the title, poster,
duration, source page and the media destination the page serves:

```bash
npm run import:damplips -- --categories=all --per-category=110   # 100+ per category
npm run import:damplips -- --categories=hardcore --dry-run      # resolve only
```

The same job is available in the dashboard at **Admin → Videos → Sync from
damplips** (one request per category, with per-category progress). It is
idempotent: a post already in the catalog is skipped, so a category can be
topped up by re-running it. A post's direct host file (for example
`https://video.damplips.com/video7/717/79.mp4`) is played by the browser
straight from that host — nothing is prepared, and no "Preparing video…" overlay
is ever drawn over a file — and `/api/videos/stream` is the fallback, plus the
only path for a post page and for HLS playlists (whose segments have to be
rewritten; `hls.js` plays them where the browser has no native support).

`npm run import:damplips -- --repair` re-resolves any row that is not already
storing a direct media file (an older post-page or proxy URL) and writes the
file the post publishes; healthy rows are never re-fetched.

Imported rows are written as published and public with `rights_status =
'cleared'` so the category is immediately visible. Use `--rights=pending` (or
the dashboard's Rights selector) to stage imports as private drafts, and use the
existing DMCA / content-removal pages as the takedown path for embedded content.
See `docs/DAMPLIPS_EMBEDS.md` for the full behaviour and limits.

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

## Advertising checkout

Clicking a vacant banner opens `/checkout?slot=<id>` directly; no advertiser account,
billing modal, or dashboard is involved. The checkout is a three-step wizard in the left
panel — **Ads Details** (the ten 16:9 placements, five per row, with sold slots showing the
running creative and locked), **Advertiser details** (any-shape JPG/PNG/GIF upload, framed into the 16:9 slot with a draggable crop window, destination URL,
name, company, email, ad name, about), then **Payment** — while the right panel stays
fixed on the advertiser payment artwork (`NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL`,
bundled local copy `public/Untitled Design (18) (1).png` as fallback). Up to ten 16:9 placements are listed two
columns by five rows. Prices are recalculated from `ad_slots` on the server.
Paying writes an `in_review` order and hands the visitor to the hosted PayPal page
(`https://www.paypal.com/ncp/payment/AZP63KXT9FUNL`). PayPal returns them to the
homepage, where the compact **In review** card animates in, holds for ten seconds and
returns to the homepage. A client payment assertion never verifies payment.

Staff inspect the creative and destination in **Admin → Ad Review**, manually confirm the
payment in their PayPal account, then choose **Approve & make live**. Going live triggers
the Resend email with subject **Your ad is live! Erobabe**. Apply migration
`00000000000025_paypal_ad_orders.sql` before using the flow. Historical campaign/payment
rows remain for audit, but the old NOWPayments checkout, IPN, status, and reconciliation
APIs and the advertiser portal have been removed.

## Routes

Public: `/`, `/categories`, `/category/[slug]`, `/latest`, `/popular`, `/video/[slug]`, `/about`, `/terms`, `/privacy`, `/contact`, `/faq`, `/content-removal`

Guest advertising: `/checkout`, `POST /api/ads/submit`

Admin: `/admin`, `/admin/videos`, `/admin/categories`, `/admin/advertisements`, `/admin/ad-slots`, `/admin/payments`, `/admin/reports`, `/admin/logs`, `/admin/system-health`

Staff-only dashboard: there are no advertiser accounts, so `/admin/campaigns` and
`/admin/users` no longer exist. Deleting an advertisement in **Ad Review** frees its slot
immediately and removes it from **Verified Ad Revenue**.

Mobile advertising: the desktop rails are hidden below 1000px, so the same ten creatives
rotate through in-flow 16:9 banners (home sections, every eighth listing/search/popular
video, the watch-page sections and its Latest feed) plus a mobile-only ad break on every
third video. `lib/ads/rotation.ts` gives each visitor their own even rotation.

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
- **Legal identity, age assurance, an operational PayPal destination for the published QR, and Resend domain verification.**

## Brand

Logo: https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png

Design: dark charcoal/black, hot-pink accent #f51655, 16:9 ad slots, three-column layout.