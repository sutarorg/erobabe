# Erobabe — Premium Adult Entertainment Platform

Next.js application under production-readiness review with Supabase backend, guest PayPal advertising checkout, a video catalog imported from damplips.com, Resend email, AI metadata (NVIDIA Nemotron 3 Ultra free route via OpenRouter), and SEO optimization.

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
- damplips.com catalogue (imported media files, played in our own player), with `/api/videos/stream` and `/api/videos/stream-edge` proxies and `hls.js`
- Tailwind CSS 4

## Video Catalog — imported from damplips.com

There are no uploads. `app/admin/(dashboard)/videos/upload`, the Bunny Stream
adapter, its API routes and the publish-sweep cron were removed, and migration
`00000000000026_damplips_embeds.sql` drops the upload tables and the Bunny
library column.

The catalogue is filled from **damplips.com**. An operator ticks categories at
**Admin → Videos** and presses **Start import**. For every selected category the
importer walks that category's popular listings first, then its other listing
pages, then a search for the category name, and stores the post id, title,
poster, duration, view count and the media file the post page publishes. The
watch page plays that file in our own player (`/api/videos/stream-edge`); the
damplips page itself is never framed.

What a run does:

* **Popular first.** Each category starts with damplips' own popular ordering
  and only then falls back to its other listings and to search, so a half-filled
  category already looks like the category. Every row stores the real view count
  and the grid can sort on it.
* **Only Stop ends it.** A run never finishes on its own. When every listing of
  a category has been walked (the report says `exhausted`), the panel waits — a
  minute, doubling while passes come back empty, capped at ten — and starts
  another pass, picking up whatever damplips has published since. Throttled or
  empty answers pause the run rather than end it. Pressing Stop ends it after
  the slice in flight.
* **No quota.** There is no "videos per category" field and no ceiling. The
  dashboard asks the server for one slice at a time and continues from the
  cursor each slice returns, so no single request outlives its timeout. The
  cursor carries the resolved listing URL, so uneven damplips pagination
  (`rel=next`, `/page/N/`, `?paged=N`) never has to be guessed.
* **No duplicates.** The damplips post id is the identity. It is claimed for the
  run before anything is fetched twice, checked against the rows already in the
  catalogue, and finally enforced by the unique index
  `videos_damplips_identity_idx`, so two runs racing on the same listing cannot
  both insert the same video.
* **High quality.** A post is imported when it advertises a real media file and
  a duration of at least a minute; the tallest rendition the page advertises is
  what gets stored. A post without a usable file is skipped, not imported blank.
* **Posters included, and served by us.** A post without a usable poster is
  skipped, and rows stored before the poster rule are repaired by the first
  slice of a run (`repair`). Every card then asks `/api/videos/poster` for the
  picture instead of the CDN: adult image CDNs are on the ad-block lists and
  some paths hotlink-protect a foreign referer, which is exactly how a grid ends
  up full of empty boxes. The proxy is allowlist-only (`damplips.com`),
  image-only, size-capped and cached for a year.
* **Resumable and polite.** A short pause sits between requests; the cursor is
  what makes a run resumable, so a closed tab loses at most one slice.

The same job runs nightly through `GET /api/cron/damplips-import` (Bearer
`CRON_SECRET`); `.github/workflows/damplips-nightly-import.yml` calls it, and the
route loops slices on its own until the plan has been walked or its time budget
runs out. Imported rows are written as published and public with
`rights_status = 'cleared'` so the category is immediately visible; the panel's
**Stage as private drafts** option stages them as private `pending_review` rows
instead. Use the existing DMCA / content-removal pages as the takedown path.

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
running creative and locked), **Advertiser details** (any-shape JPG/PNG/GIF upload, framed into the 16:9 slot in a
"Frame your banner" card with a draggable window and four corner resize dots, destination URL,
name, company, email, ad name, about), then **Payment** — while the right panel stays
fixed on `public/checkout/advertise-panel.webp` (960 × 1080, exact 8:9, with the PNG
copy as fallback for browsers without WebP). Up to ten 16:9 placements are listed two
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