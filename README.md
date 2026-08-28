# EroBabe — 18+ Video Streaming Platform + Admin CMS

EroBabe is a **production-ready adult video platform** built with **React 19, TypeScript, Vite and Tailwind CSS v4**, with a full **admin CMS** at `/admin` for real uploads, processing, publishing and analytics. It deploys to **Vercel** or **Netlify** as a static frontend + serverless API.

> **18+ Adults only.** The shipped demo content is entirely fictional (invented titles/performers, tasteful stock thumbnails, openly licensed placeholder videos) for interface demonstration.
>
> **The whole platform also runs with zero backend**: without environment variables the site stays a beautiful, fully browsable demo. Connect Supabase + Cloudflare R2 and everything becomes live — uploads, publishing, views and analytics work for real.

---

## Architecture

```
┌────────────────────────┐        presigned URLs         ┌────────────────┐
│  Admin (React, /admin) │ ─────────── direct ─────────▶ │ Cloudflare R2  │
│  Public site (React)   │        500 MB–2 GB multipart  │  (media store) │
└─────────┬──────────────┘                               └───────▲────────┘
          │ fetch /api/* (HttpOnly session cookie)                │
┌─────────▼──────────────┐        PostgREST (service role)        │
│ Serverless API (Vercel │ ─────────────────────────▶┌───────────┴────────┐
│ api/index.js · Netlify │                            │ Supabase / Postgres│
│ functions/api.mjs)     │ ◀────────── RPC/track ──── │ videos, categories,│
└────────────────────────┘                            │ analytics_events,  │
                                                      │ settings, activity │
                                                      └────────────────────┘
```

**Key design choices**

- **Direct-to-R2 uploads** — files (up to 2 GB) never pass through serverless functions (which have 4.5–6 MB payload limits). The browser uploads with short-lived SigV4 **presigned URLs** in resumable 16 MB multipart chunks, 4-way parallel, auto-retry.
- **Zero-dependency server core** (`/server`) shared by two tiny adapters: Vercel (`api/index.js`) and Netlify (`netlify/functions/api.mjs`). No Express, no framework lock-in.
- **Supabase accessed with the service-role key only inside functions.** The browser only ever talks to `/api/*`. Row Level Security restricts anonymous reads to `status = 'published'`.
- **Publish-gated workflow**: `Upload → Process → Draft → Preview → Publish`. Public API never returns non-published rows.
- **Dynamic hot-swap**: on boot the frontend probes `/api/public/health`. If the backend is configured, the entire site (home, search, categories, trending, watch pages) switches to the live catalog before first paint — no code changes or redeploys.

## Local development

```bash
npm install
npm run dev          # static demo (no backend needed)
```

For full-stack work (API + frontend together):

```bash
npx vercel dev       # or
npx netlify dev
```

Both run the Vite dev server **and** the serverless functions locally.

## Setup: Supabase (database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough).
2. Open **SQL Editor → New query**, paste the contents of **`supabase/migrations/0001_init.sql`**, and run it. This creates tables (`videos`, `categories`, `analytics_events`, `settings`, `activity_log`), indexes, RLS policies, the atomic `track_view` function, and seeds categories.
   Then run **`supabase/migrations/0002_video_slugs.sql`** — it adds the unique `slug` column that powers every canonical `/video/{video-slug}` page and the dynamic sitemap.
   Then run **`supabase/migrations/0003_engagement_signals.sql`** — it adds watch-time, completion and likes tracking that feed the discovery ranking engine.
   Then run **`supabase/migrations/0004_category_icons.sql`** — it adds `categories.icon` and seeds the 11 content categories shown on Explore.
   Then run **`supabase/migrations/0005_traffic_analytics.sql`** — it records traffic source, referrer host and device per view, powering the Referral Sources / Traffic and per-video Audience analytics.
   Then run **`supabase/migrations/0006_impressions_ctr.sql`** — it adds `impressions` and `clicks` counters with batched tracking RPCs, powering the Impressions and CTR metrics in both analytics pages.
   Finally run **`supabase/migrations/0007_dedupe_and_scheduling.sql`** — it adds `content_hash` (duplicate detection), `scheduled_publish_at` and `bulk_batch` for the bulk-upload hourly release schedule. All scripts are safe to re-run.
3. From **Project Settings → API**, copy:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (the **service_role** secret — server-only)

## Setup: Cloudflare R2 (media storage)

1. In the Cloudflare dashboard: **R2 → Create bucket** (e.g. `erobabe-media`).
2. **Expose it publicly** so the player can stream files: either enable the `r2.dev` public URL (**Settings → Public access**) or attach a custom domain (recommended for production, e.g. `media.erobabe.com`). The resulting base URL is your `R2_PUBLIC_BASE_URL`.
3. **Set CORS** on the bucket (`aws s3api put-bucket-cors` or the dashboard) using **`r2-cors.json`** — it allows browser `PUT` uploads from your domains and exposes `ETag` (required for multipart).
4. Create an **R2 API token** (Object Read & Write, scoped to this bucket) and record `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Setup: credentials

```bash
node scripts/hash-password.mjs "choose-a-strong-password"
# prints:  ADMIN_USERNAME / ADMIN_PASSWORD_SCRYPT / SESSION_SECRET
```

## Environment variables

Copy `.env.example` → `.env` locally, and add the same values in **Vercel → Project → Settings → Environment Variables** (or Netlify → Site configuration). All are server-side only. **None of these ever appear in the client bundle** — Vite only inlines `VITE_*` vars, and we use none.

| Variable | Purpose |
| --- | --- |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_SCRYPT` | Admin login (scrypt hash, never a plaintext password) |
| `SESSION_SECRET` | HMAC key for signed session cookies |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Database + PostgREST (service role, server-only) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | Object storage |
| `PROCESSING_MODE` | `original` (default) or `callback` |
| `PROCESSING_WEBHOOK_SECRET` | Shared secret for the processing callback |
| `SITE_URL` | Absolute site URL |

## Deploy

### Vercel
Import the repo (framework preset **Vite** is auto-detected). `vercel.json` ships with:
- the `/api/:path* → api/index.js` rewrite for serverless functions,
- SPA fallback for all frontend routes (including `/admin`),
- hardened HTTP headers.

`npx vercel dev` gives you the same stack locally.

### Netlify
Import the repo. `netlify.toml` configures the build (`npm run build` → `dist`), bundles `netlify/functions/api.mjs` with esbuild, and redirects `/api/*` to it before the SPA fallback. Use **`npx netlify dev`** locally.

### Connecting erobabe.com
1. Buy the domain anywhere, then add it in your host's **Domains** page (Vercel or Netlify both auto-issue TLS).
2. Set `SITE_URL=https://erobabe.com`, update the canonical/OG defaults in `index.html`, and update the origins in `r2-cors.json`. `/robots.txt` and `/sitemap.xml` are generated dynamically by the serverless API.

## The upload workflow (real end-to-end)

1. **Upload** — `/admin/upload`: drag-and-drop, validation (type/size ≤ 2 GB), client-side duration + auto poster capture, direct-to-R2 resumable upload with live progress, speed/ETA, cancel & resume-failed-parts. On completion the server finalizes the multipart upload. A unique SEO **slug** is generated immediately, giving the video its own page at `/video/{video-slug}` (the slug refreshes with the title while the video is a draft, then locks on publish so indexed URLs never break).
2. **Process** — with `PROCESSING_MODE=original` the file is marked **ready** immediately (single-file playback). With `callback`, it stays in **processing** until an external worker posts renditions to `POST /api/admin/process/callback` (`x-process-secret` header), which flips it to **ready** and stores `hls_url` (the player then uses HLS via Safari natively and **hls.js** elsewhere — loaded lazily).
3. **Draft** — metadata (title, description, category, tags, thumbnail override) is saved privately; nothing is public.
4. **Preview** — the editor (`/admin/videos/:id`) streams the actual stored file before publishing.
5. **Publish** — flips `status = 'published'` and it appears on the public site instantly: homepage sections, search, category pages, trending, recommendations.

Every mutation writes to the **activity log**; **views** are tracked through a deduplicating Postgres function (one view per viewer/IP-hash/day) and power the Analytics dashboard (daily series, range totals, top videos, storage).

## Discovery ranking engine

Featured, Trending, Rising Now and Editor's Pick are **fully automatic**. A single scoring service
(`server/ranking.mjs`, mirrored client-side in `src/lib/ranking.ts`) ranks every eligible video from
live analytics and enforces hard section limits:

| Section | Limit | Optimizes for |
| --- | --- | --- |
| Featured | 5 | Balanced popularity + recent performance + engagement + quality + recency + momentum |
| Trending | 8 | Recent views, velocity and acceleration — lifetime views barely count |
| Rising Now | 3 | Acceleration, growth and performance relative to age (popularity actively penalized) |
| Editor's Pick | 5 | Admin-flagged pool, ranked on quality, engagement and recent performance |

### Automatic video optimization

Every upload is re-encoded in the browser before it reaches R2, targeting the smallest size that
still looks like the original (`src/admin/compress.ts`):

1. **Codec** — VP9/Opus is preferred where supported (~35% smaller than H.264 at equal quality),
   falling back to H.264/AAC, then VP8.
2. **Resolution** — capped at 1080p with aspect ratio preserved.
3. **Content-aware bitrate** — the source is sampled at seven points to measure spatial edge energy
   and frame-to-frame motion. Flat, static footage gets a multiplier as low as 0.6×; busy action up
   to 1.4×. A one-size-fits-all rate wastes most of the bits on simple content.
4. **Refinement pass** — when the first encode is still large and the video is short enough to
   justify the wait, a second pass runs at 0.65× the bitrate and the smaller file wins.

The bitrate never exceeds 95% of what the source already carries, audio uses 96 kbps Opus / 112 kbps
AAC, and the minimum worthwhile saving is 5%. If the browser can't re-encode, the video is over 45
minutes, or a result would be *larger* than the original, the untouched original is uploaded — the
engine never makes a file worse.

### Duplicate detection

Before anything is uploaded, the **original** source file is fingerprinted in the browser: SHA-256
over three sampled 1 MB windows (head / middle / tail) mixed with the exact byte length. Hashing a
2 GB file end-to-end would take minutes; this completes in milliseconds and still identifies exact
re-uploads reliably. The optimized output is never hashed, since encoder bytes vary between runs.

The hash is checked against `videos.content_hash`. A match blocks the upload button and shows the
existing video's title, status, upload date and a link to it — with an **Upload anyway** override,
because re-uploading is sometimes intentional.

### Bulk upload (up to 20 videos)

`Admin → Upload Videos → Bulk` accepts up to 20 files in one action. Per video the admin edits only
the **title** and **thumbnail**; everything else is automated:

| Field | Source |
| --- | --- |
| Description | One of 20 built-in descriptions, assigned sequentially so consecutive uploads never share copy |
| Tags | Generated from the title + assigned description against live trending tags |
| SEO title | `{title} \| Watch Free 18+ Video on EroBabe` |
| SEO description | Derived from the assigned description |
| Thumbnail | Auto-captured poster frame unless the admin uploads one |
| Category | Inferred from the title where it matches a category name |

Every video uploads as a **draft**, then publishes **one per hour** — first an hour after the batch
finishes. Three independent triggers run the schedule, so it holds on any plan:

1. **Platform cron** — `/api/cron/publish` (daily safety sweep on Vercel Hobby; hourly on Netlify). Vercel Hobby rejects schedules that run more than once per day, so `vercel.json` uses `0 0 * * *`.
2. **Lazy sweep** — public API reads check for due videos at most once a minute. Works with no cron
   at all, which matters on Vercel Hobby where cron frequency is limited.
3. **Manual** — `POST /api/admin/publish-due` from the CMS.

Only bulk actions schedule. A single upload keeps the existing flow: manual metadata, auto-tagging,
and publish-when-you-choose.

### Impressions & CTR

Impressions are counted by an `IntersectionObserver` in `VideoCard` when a card genuinely enters the
viewport, once per video per page load, and are **batched** so a 20-card grid sends one request
rather than twenty. Clicks fire on card navigation. CTR is `clicks ÷ impressions`, reported on both
the Analytics and Video Analytics pages. Both counters only apply to published videos.

**Signals**: 1/3/7/14/30-day view windows, unique viewers, watch time, completion rate, likes,
engagement rate, velocity, acceleration, age-adjusted performance, recency and log-damped lifetime
popularity. Every signal is **percentile-normalized**, so one viral video cannot flatten the catalog,
and Rising Now applies an explicit popularity penalty plus excludes the top of Trending — historically
huge videos can never permanently occupy every slot.

Scores are recomputed whenever new analytics arrive (views, watch-time beacons and likes invalidate a
60-second cache), and ineligible videos — unpublished, deleted or without playable media — are filtered
out automatically. Missing migrations degrade gracefully: whatever signals exist are used.

Tune the model in one place — `SECTION_WEIGHTS` and `SECTION_LIMITS` in `server/ranking.mjs` — and every
discovery surface follows without UI changes.

## Admin features map

- **Dashboard** — totals (videos/published/drafts/processing/views/storage), 14-day chart, top videos, recent activity
- **Videos** — search, status/category filters, sorting, pagination, bulk publish/unpublish/delete, quick publish toggles

### Category icons

Icons are stored as short keys (`categories.icon`) and resolved through one shared registry,
`src/lib/categoryIcons.ts`, so the Explore page, sidebar, category pages and the CMS always render the
same glyph. The 14 default Explore categories each ship with a unique icon; the CMS picker offers 9
options. To add a glyph, import it in the registry and add an entry to `CATEGORY_ICONS` (plus
`ICON_OPTIONS` to expose it in the picker).
- **Editor** — full metadata, Editor's Pick flag (the only manual discovery control), SEO fields, thumbnail replace, **video file replace**, live preview, publish/unpublish/delete
- **Categories & Tags** — CRUD with slugs/gradients/cover uploads, **icon picker (20 options)**, sort order, usage counts, safe delete protection, tag cleanup
- **Analytics** — 7/14/30-day series, lifetime totals, storage monitoring, top-performers, full audit log
- **Settings** — site title, announcement, homepage hero toggle, pinned featured video, age-gate copy, infrastructure status

## Self-learning recommendations

Every rail — homepage discovery, Related, Recommended, Up Next — is ranked by one adaptive model
that learns from what each viewer actually does.

**Layer 1 — content & taste** (`src/lib/recommend.ts`). A weighted taste profile is built from watch
history, likes and saves, with exponential recency decay (14-day half-life) and interaction weights
(`watch 1 · like 2.5 · save 3`). Candidates are scored on content similarity (category, Jaccard tag
overlap, title tokens, performer, duration fit) plus quality, popularity, momentum and recency —
every feature percentile-normalized so one viral video can't flatten the scale.

**Layer 2 — online learning** (`src/lib/learning.ts`). Each recommendation records the normalized
feature vector that produced it. When the outcome lands, a perceptron-style update nudges the
weights along the error gradient:

| Outcome | Reward | Detected from |
| --- | --- | --- |
| Completion (≥85%) | +1.0 | playback progress |
| Like / Save | +1.0 | explicit action |
| Watch (≥30s) | +0.7 | playback progress |
| Click | +0.45 | card navigation |
| Skip (<8s then leave) | −0.35 | unmount with low watch time |

Weights are clamped to `0.2–2.6`, so the model can emphasise what predicts engagement for *this*
viewer without any single signal running away.

**Layer 3 — contextual bandit.** Each content facet (category, tag, duration bucket, time-of-day)
keeps a Beta(α, β) posterior sampled Thompson-style. Unseen facets start at an optimistic prior, so
genuinely new content keeps surfacing instead of the model collapsing onto one narrow taste.
Exploration is wide early and tightens as evidence accumulates (`min(1, events/40)`), and posteriors
decay at `0.995` per update so stale tastes fade.

**Retention loop.** Up Next draws from the same ranking, autoplay continues the chain, and each
completed video feeds the model — so the `watch → next → watch` loop measurably sharpens with use.

Everything is per-browser `localStorage`, bounded (300 facets / 120 pending impressions), needs no
account or server round-trip, and degrades cleanly to the static model for first-time visitors.

## Two-factor authentication (TOTP)

Admins can protect `/admin` with an authenticator app (Google Authenticator, 1Password, Authy,
Bitwarden — anything TOTP). Enroll at **Admin → Security**: scan the QR code, confirm one code, then
save the 10 single-use recovery codes shown once.

**How the login flow changes**

1. Username + password → if 2FA is enrolled, the server issues a **5-minute "pending" session** whose
   scope is `pending`.
2. That pending session can reach exactly one endpoint: `/auth/2fa/verify`. Every other admin route
   rejects it, so a stolen password alone grants nothing.
3. A correct TOTP or recovery code exchanges it for a normal 12-hour `admin` session.

**Security properties**

- **Encrypted at rest** — the shared secret is sealed with AES-256-GCM using a key derived from
  `SESSION_SECRET`, so a database leak alone doesn't yield a working second factor.
- **Replay-proof** — each accepted time counter is recorded; the same code cannot be reused inside
  its own 30-second window.
- **Tight drift window** — ±1 step (30s) only.
- **Rate limited** — 5 verification attempts per 5 minutes per IP, on top of the existing 5/min
  login limit.
- **Constant-time comparison** for both codes and recovery codes.
- **Recovery codes are scrypt-hashed**, single-use, and removed the moment they're spent.
- Disabling 2FA requires the password *and* a current code.

**If you lose your device and your recovery codes**, clear the enrollment row directly in Supabase:

```sql
delete from public.settings where key = 'admin_2fa';
```

No new migration is required — 2FA state lives in the existing `settings` table, which anonymous
users cannot read under RLS.

## Security model

- Server-side verification of an **HttpOnly, Secure, SameSite=Lax** cookie containing an HMAC-signed token (12 h)
- Passwords hashed with **scrypt** (per-user salt, timing-safe compare); constant-time path on unknown usernames
- **Rate limiting** on login (5/min/IP) and on all mutations (in-memory sliding window — best-effort on serverless; front with Cloudflare WAF for hard guarantees)
- CSRF: custom `X-Requested-With` header required on all mutations
- Strict input validation and field whitelists on every endpoint; UUID-checked ids; PostgREST-parameterized queries only
- Uploads accepted only for `video/*` ≤ 2 GB; thumbnails are validated data URLs ≤ 4 MB
- R2 credentials and the Supabase service key exist **only** in server env; short-lived signed URLs (4 h) for upload parts
- RLS: anonymous DB role can read published videos/categories only — everything else is behind the service role
- Tight outbound headers (nosniff, frame, permissions-policy, referrer)

## Video processing (optional transcoding to 360p–1080p + HLS)

Serverless functions shouldn't run ffmpeg. The honest, extensible contract is:

1. Set `PROCESSING_MODE=callback` and `PROCESSING_WEBHOOK_SECRET`.
2. Point any worker (a small ffmpeg container, a queue consumer, or a Cloudflare Stream bridge) at new rows in `processing` status.
3. When renditions exist, the worker calls:
   ```http
   POST /api/admin/process/callback
   x-process-secret: <secret>
   { "videoId": "…", "hlsUrl": "https://media…/master.m3u8",
     "renditions": [{"label":"1080p","url":"…"}, …], "durationS": 1523, "thumbnailUrl": "…" }
   ```
4. The row becomes `ready` with `hls_url`; the public player automatically prefers HLS (360p/480p/720p/1080p ladder).

Until a worker exists, `original` mode streams the uploaded file directly — fully functional.

## Project structure (additions over the static base)

```
api/index.js                  # Vercel serverless adapter
netlify/functions/api.mjs     # Netlify functions adapter
server/
  handler.mjs                 # router shared by both adapters
  public-api.mjs              # public read API (published content only)
  admin-api.mjs               # auth, uploads, CRUD, taxonomy, analytics, settings
  r2.mjs                      # SigV4 presigning + multipart lifecycle (zero deps)
  db.mjs                      # PostgREST client (service role)
  util.mjs                    # sessions, scrypt, rate limiting, HTTP helpers
supabase/migrations/0001_init.sql
src/admin/                    # the /admin CMS (React)
src/data/dynamic.ts           # hot-swap of demo catalog ←→ live catalog
.env.example · r2-cors.json · scripts/hash-password.mjs
```

---

© EroBabe. 18+ Adults Only. Demo content is fictional; connect your own licensed media and policies before operating a real service.
