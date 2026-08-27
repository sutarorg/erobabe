# EroBabe — Premium Adult Video Streaming (18+)

A production-oriented **adult (18+) video discovery & streaming platform** built with React, Vite, TypeScript and Tailwind CSS — a cinematic dark public site plus a complete admin CMS with secure authentication, direct-to-R2 uploads, a video-processing pipeline abstraction, real view analytics and one-click publishing.

> **Demo content notice:** every title, performer and thumbnail in this
> repository is **fictional or placeholder media** used to demonstrate the
> interface. Nothing explicit is included. The site is RTA-labelled and
> gated for adults.

---

## Table of contents

1. [What this is](#what-this-is)
2. [Tech stack](#tech-stack)
3. [Quick start](#quick-start)
4. [Demo mode vs production mode](#demo-mode-vs-production-mode)
5. [The public site](#the-public-site)
6. [The admin CMS](#the-admin-cms)
7. [Media architecture (replace thumbnails/videos)](#media-architecture)
8. [Supabase setup](#supabase-setup)
9. [Cloudflare R2 setup](#cloudflare-r2-setup)
10. [Admin password](#admin-password)
11. [Deploying to Vercel](#deploying-to-vercel)
12. [Deploying to Netlify](#deploying-to-netlify)
13. [Connecting erobabe.com](#connecting-erobabecom)
14. [Editing the dataset](#editing-the-dataset)
15. [localStorage features](#localstorage-features)
16. [View counting & anti-abuse](#view-counting--anti-abuse)
17. [Costs & free-tier limits](#costs--free-tier-limits)
18. [Backup strategy](#backup-strategy)
19. [Security checklist](#security-checklist)
20. [Project structure](#project-structure)

---

## What this is

- **Public experience** — YouTube-style discovery with a premium dark identity: hero, trending, popular, new releases, categories, most-watched rankings, full-text search with suggestions, watch pages with recommendations, watch history, likes, saves and a share sheet.
- **Admin CMS** (`/admin`) — Vercel-d dashboard meets YouTube Studio: statistics, video library with bulk operations, a 5-step upload wizard, category/tag managers, analytics charts, storage overview, activity log and site settings.
- **Publishing pipeline** — upload (direct browser → Cloudflare R2 via presigned multipart URLs) → optional FFmpeg processing → draft → preview → **Publish**. The public site reflects new content instantly; no frontend redeploy.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide icons |
| Player | Native HTML5 `<video>` (HLS served when processing is configured) |
| API | Provider-agnostic Web-standard router (`server/app.ts`) mounted as Vercel/Netlify functions |
| Database | Supabase Postgres (+ Row Level Security) — metadata only |
| Storage | Cloudflare R2 (S3-compatible, zero egress fees) |
| Auth | Single-owner account, scrypt hash + HMAC-signed HttpOnly session cookies |
| Processing | Swappable `VideoProcessingProvider` (FFmpeg worker reference implementation) |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (static SPA)
npm run preview    # serve the production build locally
```

The project runs out of the box in **Demo Mode** — no external services needed.

## Demo mode vs production mode

`VITE_DEMO_MODE` (default `true`) switches the whole app between two data planes with **identical UI**:

| | Demo mode | Production mode |
| --- | --- | --- |
| Catalog | `src/data/videos.ts` + admin state in localStorage | Supabase via `/api` |
| Admin login | `admin` / `erobabe-demo` (client-side, clearly labelled) | scrypt-verified, HttpOnly cookie session |
| Uploads | Browser-local object URLs, honest "provider not configured" messages | Presigned multipart → R2 → processing job |
| Analytics | Real local view events + clearly-marked seed data | `view_events` table |

Nothing in demo mode pretends to be a server: the UI explicitly says *"Demo mode"*, *"not configured"*, or *"session-only"* wherever a real backend would take over.

## The public site

| Route | Purpose |
| --- | --- |
| `/` | Hero + trending / popular / new / categories / most watched / editor's picks |
| `/explore` | Filter chips (All, Trending, New, Popular, Most Viewed, Recently Added) |
| `/trending` | Podium #1–#3, rising list, trending grid, hot categories |
| `/popular`, `/new` | Sorted listings |
| `/categories`, `/category/:slug` | Category browsing with sort controls |
| `/watch/:id` | Player, metadata, like/share/save/copy, tags, description, recommendations |
| `/search?q=` | Results with count, empty state, recent searches |
| `/history` | Locally-stored watch history (remove items / clear all) |
| `/legal/:page` | Privacy, Terms, DMCA, Age Policy, Contact, About placeholders |

Design system: near-black `#050505` surfaces, pink→violet accent gradient, Space Grotesk display + Inter body type, muted micro-animations (150–300 ms), full `prefers-reduced-motion` support, skeleton loaders on every async surface.

## The admin CMS

| Route | Purpose |
| --- | --- |
| `/admin/login` | Rate-limited login (lockout after 5 failures) |
| `/admin` | Dashboard: 8 real stat cards, views chart, recent activity, recent uploads |
| `/admin/videos` | Library: search, status filters, sort, pagination, bulk publish/unpublish/feature/trending/delete |
| `/admin/videos/new` | Upload wizard: Upload → Details → Thumbnail → SEO → Review → Publish |
| `/admin/videos/:id/edit` | Full editor: metadata, thumbnail replace, source replace, SEO, publish workflow, delete |
| `/admin/categories` | Create / rename / delete / reorder with usage counts |
| `/admin/tags` | Create / rename / multi-select merge / delete with usage counts |
| `/admin/analytics` | 24h · 7d · 30d · All-time ranges, top videos, category performance, avg watch time |
| `/admin/storage` | Breakdown chart, R2 status, orphan-object review with confirmations |
| `/admin/activity` | Full audit log |
| `/admin/settings` | Site identity, homepage sections, age gate, view threshold, analytics |

**Status workflow:** `UPLOAD → PROCESSING → READY → DRAFT → PUBLISHED` (+ `UNPUBLISHED`, `FAILED`). Publish validates title, category, thumbnail and a playable source; failures never show fake success states.

## Media architecture

```text
/public/assets/brand/og-cover.jpg     # generated brand/OG art
Thumbnails                            # URL-based (see src/data/videos.ts → THUMBS)
Demo playback                         # public sample MP4s (VIDEO_POOL)
```

Production object layout in R2 (IDs, never user filenames):

```text
originals/{video-id}/source.mp4
thumbnails/{video-id}/poster.webp
previews/{video-id}/preview.mp4
encoded/{video-id}/{360p,480p,720p,1080p}/… + master.m3u8
```

**To replace demo media:** edit `THUMBS` / `VIDEO_POOL` in `src/data/videos.ts`, or simply replace the rows' `thumbnail` / `videoUrl` values — no component changes are required.

## Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → paste `supabase/migrations/0001_init.sql` → **Run**. This creates `videos`, `categories`, `tags`, `video_tags`, `view_events`, `site_settings`, `processing_jobs`, `activity_logs`, plus RLS policies (public can only read `PUBLISHED` videos) and seed categories.
3. Grab **Project URL**, **anon key** and **service_role key** from *Settings → API*.
4. Add them as environment variables (see `.env.example`). The service-role key is used **only** by `server/app.ts` — it is never shipped to the browser.

Video files are **never** stored in Supabase — only metadata and object keys.

## Cloudflare R2 setup

1. Create a Cloudflare account → **R2** → **Create bucket** (`erobabe`).
2. **Manage R2 API Tokens** → create a token with Object Read & Write scoped to the bucket. Copy the Access Key ID, Secret and your Account ID.
3. Attach a custom domain (e.g. `cdn.erobabe.com`) or enable public access for the delivery hostname you set as `R2_PUBLIC_BASE_URL`.
4. Add CORS rules on the bucket allowing your site origin (`PUT/POST/GET` from `https://erobabe.com` and `http://localhost:5173`).
5. Set `R2_*` environment variables. Uploads then flow browser → R2 directly; the server only signs URLs.

## Admin password

The password exists only as a scrypt hash in `ADMIN_PASSWORD_HASH` — never in source control, never readable by the browser.

```bash
# generate a hash (format: scrypt:N:salt_hex:hash_hex)
node -e "const s=require('crypto').randomBytes(16);require('crypto').scrypt('YOUR_PASSWORD',s,64,(e,k)=>console.log('scrypt:16384:'+s.toString('hex')+':'+k.toString('hex')))"
```

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and a random `SESSION_SECRET` (`openssl rand -hex 32`) as deployment secrets.

## Deploying to Vercel

1. Push the repo to GitHub/GitLab → **Import Project** in Vercel (framework preset: Vite; defaults work).
2. Add all environment variables from `.env.example` (Production scope).
3. For uploads, also `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` and commit the updated lockfile (the API imports them dynamically).
4. Deploy. `vercel.json` routes `/api/*` to `api/handler.ts` and everything else to the SPA — deep links like `/watch/12` work out of the box.

## Deploying to Netlify

1. **Add new site → Import from Git.** Build command `npm run build`, publish `dist` (already in `netlify.toml`).
2. Add the same environment variables. Netlify Functions picks up `netlify/functions/api.ts`; `netlify.toml` maps `/api/*` to it and installs the SPA fallback.

## Connecting erobabe.com

The domain is not assumed anywhere in code — only `PUBLIC_SITE_URL`:

1. Purchase `erobabe.com` at a registrar; point its nameservers to Cloudflare (required for R2 custom domains anyway).
2. In Cloudflare DNS: create a `CNAME` for `erobabe.com` and `www` to your Vercel/Netlify target (proxied is fine; SSL on *Full* or managed by the host).
3. Add the domain in your Vercel/Netlify project settings; wait for certificate issuance.
4. Set `PUBLIC_SITE_URL=https://erobabe.com` and redeploy. Update `robots.txt` / `sitemap.xml` hostnames if you use a different domain.

## Editing the dataset

`src/data/videos.ts` holds ~40 fictional videos generated from compact tuples:

```ts
[title, category, durationSec, views, daysAgo, performer, tags, quality, featured, trending]
```

Add/edit rows to change the demo catalog. Categories live beside them (`CATEGORIES`, 10 entries). IDs and slugs are auto-derived. **Removing demo data:** delete the `ROWS` entries (keep the helpers) and, in production, truncate the seeded rows in Supabase.

## localStorage features

| Key | Feature |
| --- | --- |
| `eb:age` | 18+ confirmation |
| `eb:history` | Watch history (max 60, removable, clearable) |
| `eb:likes` / `eb:saves` | Like & save UI state |
| `eb:searches` | Recent searches (clearable) |
| `eb:view-events` | Real view events (demo analytics source) |
| `eb:admin:v1` | Demo admin CMS state — **the same record the public catalog reads**, so publishing in `/admin` is reflected everywhere instantly |
| `eb:prefs`, `eb:sidebar` | UI preferences |

Admin security in production does **not** use localStorage — it uses server-verified HttpOnly cookies.

## View counting & anti-abuse

- A view counts only after the configured watch threshold (default **10 s**, adjustable in Settings).
- Demo mode dedupes by session + 6-hour window; the API additionally rate-limits per IP, validates the video server-side and ignores duplicate session windows.
- Analytics consume the stored events — nothing is fabricated at read time (demo seeds are clearly marked).

## Costs & free-tier limits

| Component | Free allowance (approx.) | What happens beyond |
| --- | --- | --- |
| Vercel/Netlify hosting | Generous static + function quotas | Paid function/compute tiers |
| Cloudflare R2 | 10 GB storage, 10M/1M ops per month, **$0 egress** | Pay-as-you-go storage/ops (egress stays free) |
| Supabase Free | 500 MB DB, 1 GB bandwidth, pauses after inactivity | $25/mo Pro |
| FFmpeg worker | Your own (e.g. a small VM/Worker + Queue) | First likely paid component for heavy libraries |

R2's lack of egress fees is why videos live there and Supabase stores metadata only. If no processing provider is configured, videos publish as single-source MP4 at zero processing cost — the UI says so honestly.

## Backup strategy

- **Supabase:** *Settings → Database → Backups* (daily on free tiers is manual → schedule `pg_dump` via cron/CI); export `videos`, `categories`, `tags`, `site_settings` JSON periodically.
- **R2:** objects are immutable-addressed by video ID; enabling bucket versioning or lifecycle rules is optional. A video's full record can be reconstructed from its DB row (`original_key`, `hls_master_url`, `thumbnail_url`) as long as the objects remain.

## Security checklist

- [x] No credentials in source, Git history, or the public bundle
- [x] Service-role + R2 secrets server-only (no `VITE_` prefix)
- [x] Admin auth via scrypt hash, generic errors, IP rate limit, 5-strike lockout (demo parity included)
- [x] Sessions: HMAC-signed HttpOnly SameSite cookies, Secure in production, verified on every privileged request
- [x] Public API exposes `PUBLISHED` rows only (RLS enforced at the DB too)
- [x] Upload MIME + size validation; UUID object keys; no path traversal
- [x] CSRF origin checks for cookie-authenticated mutations
- [x] Destructive actions require confirmation UI-side and auth server-side
- [x] `.env*` git-ignored; response hardening headers (`nosniff`, `DENY`)

## Project structure

```text
├─ api/handler.ts                 # Vercel API adapter (/api/*)
├─ netlify/functions/api.ts       # Netlify API adapter
├─ server/app.ts                  # provider-agnostic secure API router
├─ supabase/migrations/0001_init.sql
├─ public/
│  ├─ assets/brand/og-cover.jpg   # generated brand art
│  ├─ _redirects · robots.txt · sitemap.xml · manifest.webmanifest · favicon.svg
├─ src/
│  ├─ data/videos.ts              # demo catalog + categories + helpers
│  ├─ lib/ (api.ts · store.ts)    # data plane + local persistence
│  ├─ components/ (chrome · video · ui)
│  ├─ pages/ (home · browse · trending · watch)
│  └─ admin/ (AdminApp · store · dashboard · videos · upload · misc)
├─ netlify.toml · vercel.json · .env.example
```

---

**18+ / Adults Only.** This repository ships a fictional-content demonstration of a premium adult streaming product — interface, CMS and infrastructure included.
