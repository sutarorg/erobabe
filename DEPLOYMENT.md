> **Video uploads are retired (2026-10).** Every section below that describes
> Bunny Stream uploads, `BUNNY_*` credentials, `/admin/videos/upload`,
> `CRON_SECRET` or `/api/cron/bunny-publish` is historical. The catalog is now
> embedded from damplips.com; fill it with `npm run import:damplips` or
> **Admin → Videos → Sync from damplips**, and see `docs/DAMPLIPS_EMBEDS.md`.
> Migration `00000000000026_damplips_embeds.sql` drops the upload tables.

# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

Deployment setup and operational checklist for Erobabe. It covers Supabase, guest PayPal advertising checkout, the damplips video catalog, OpenRouter, Resend, hosting, domains, environment variables, testing and rollback. There are no video uploads; section D documents the catalog import.

**Current launch evidence:** see PRODUCTION_READINESS.md and GO_LIVE_CHECKLIST.md. Repository checks are not account-policy approval. Follow the rollout addendum below before using historical setup steps.

**Video-provider guidance audited**: October 14, 2026

**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage), PayPal QR checkout, Resend, OpenRouter (NVIDIA Nemotron 3 Ultra, free route), damplips embeds, Tailwind CSS 4.

---

## A. Prerequisites

### Accounts needed
- Supabase account (https://supabase.com)
- PayPal account that owns the destination encoded in the supplied advertising QR
- Resend account (https://resend.com)
- OpenRouter account for AI metadata (NVIDIA Nemotron 3 Ultra, free route) (https://openrouter.ai)
- GitHub account with access to https://github.com/sutarorg/erobabe
- Domain registrar (e.g., Cloudflare, Namecheap)
- Hosting provider that permits lawful adult content and commercial use (NOT Vercel Hobby — see Hosting Restrictions). Recommended: Fly.io, Render, Railway, or self-hosted VPS with Docker. Verify Acceptable Use Policy before deploying.

### Local software
- Node.js 22.x (`node -v`)
- npm 10+ (`npm -v`)
- Git
- Supabase CLI (optional, for migrations): `npm i -g supabase` or `brew install supabase/tap/supabase`
- Playwright browsers: `npx playwright install`

### Decisions requiring owner authorization before production
1. **Video source**: damplips embeds only. Confirm you have the right to embed each item, then run the import in section D.
2. **Hosting provider**: Vercel Hobby is limited to personal non-commercial use and its Acceptable Use Policy restricts objectionable content. Do NOT deploy commercial Erobabe to Vercel Hobby. Choose a host whose terms explicitly permit adult content and commercial use. Document approval.
3. **Legal identity**: Operator must provide real legal name, business address, registration, contact emails, age-verification procedures. Do not publish fictional identity.
4. **Age assurance**: Evaluate jurisdiction-specific requirements (e.g., UK, EU, US state laws). Frontend age gate alone is not robust assurance. Implement required verification integration where legally required.
5. **PayPal destination and operating approval**: Owner must confirm that the PayPal account encoded in the supplied QR can lawfully receive advertising payments for this business. Keep the account and QR under operator control; staff verify each receipt manually before publishing an ad.

---

## B. Supabase Setup (Click-by-Click)

### 1. Create Supabase project
1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Select Organization (create one if needed)
4. Name: `erobabe-prod`
5. Database password: generate strong, save in password manager
6. Region: choose closest to users (e.g., `us-east-1` or `eu-central-1`)
7. Click **Create new project** — wait 2-3 minutes for provisioning

### 2. Obtain project URL and publishable key
1. In project dashboard, go to **Project Settings** (gear icon bottom left)
2. Click **API** under Configuration
3. Copy **Project URL** — looks like `https://abcdefgh.supabase.co` — this is `NEXT_PUBLIC_SUPABASE_URL`
4. Under **Project API keys**, copy **Publishable key** (starts `sb_publishable_...`) — this is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Copy **Secret key** (starts `sb_secret_...` or legacy `service_role`) — this is `SUPABASE_SECRET_KEY` (server-only, never expose to browser)

### 3. Configure authentication redirect URLs
1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL** to your production domain, e.g., `https://erobabe.com`
3. Under **Redirect URLs**, add:
   - `https://erobabe.com/auth/callback` (implemented PKCE callback)
   - `https://erobabe.com/auth/callback?next=/auth/update-password`
   - `https://erobabe.com/auth/sign-in`
   - `https://erobabe.com/admin`
   - `http://localhost:3000/*` for local dev
4. Click **Save**

### 4. Configure email verification and password reset
1. Go to **Authentication** → **Email Templates**
2. Verify templates for **Confirm signup**, **Magic Link**, **Change Email**, **Reset Password**
3. Ensure links use `{{ .SiteURL }}` and point to your domain
4. Go to **Authentication** → **Providers** → **Email** — ensure enabled, confirm **Secure email change** enabled

### 5. Configure Resend SMTP integration (for Auth emails)
1. In Supabase Dashboard → **Project Settings** → **Auth** → **SMTP**
2. Toggle **Enable custom SMTP**
3. Enter Resend SMTP credentials:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: Your Resend API key (from Resend dashboard)
   - Sender email: `noreply@erobabe.com` (must be from verified domain)
   - Sender name: `erobabe`
4. Click **Save**
5. Alternative: Use Resend Integration: Go to https://resend.com/domains, add domain, then Resend → **Integrations** → **Connect to Supabase** → select project → Configure

### 6. Apply database migrations
**Option A — via Supabase Dashboard SQL Editor (simplest)**
1. Go to **SQL Editor** → **New query**
2. Open `supabase/migrations/00000000000000_initial_schema.sql` in your editor, copy entire content, paste into SQL Editor, click **Run**
3. Repeat for `00000000000001_rls_policies.sql`
4. Repeat for `00000000000002_seed_fixed_data.sql`
5. Apply the remaining checked-in migrations in order through `00000000000022_unique_anonymous_comment_profiles.sql`; do not re-run or edit migrations already recorded as applied.
6. Verify in **Table Editor** that tables exist: `profiles`, `categories`, `videos`, `ad_slots` (should have 10 rows), `site_settings` (1 row), etc.

**Option B — via Supabase CLI**
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
# Or
supabase migration up
```

### 7. Verify RLS policies
1. Go to **Authentication** → **Policies**
2. For each table, ensure RLS enabled (green check)
3. Spot check:
   - `videos` should have policy "Public can read published videos" with condition status=published, visibility=public, rights_status=cleared, moderation_status=approved
   - `ad_slots` should allow anon read
   - `profiles` should restrict to own + admin
4. Test with SQL: try to query `videos` as anon — should only see published

### 8. Application routes, not assumed Edge Functions

This checkout implements payments/IPN, metadata and the damplips catalog importer
as Next.js routes. There are no checked-in Supabase Edge Functions to deploy for
these operations. Do not create retired upload relay functions.

### 9. Configure server secrets on the application host

Set `SUPABASE_SECRET_KEY` (or the legacy service-role alias), `RESEND_API_KEY`,
`OPENROUTER_API_KEY` when using metadata AI, and the site URL settings on the
**Next.js application host**. There are no video-provider or upload-scheduler
secrets any more. Supabase Edge Function secrets alone are not visible to
Next.js. Keep every secret server-only; redeploy after updates. See section D for
the catalog import.

### 10. Create initial administrator using secure documented process
**NEVER allow browser to set role=admin. Use service_role or SQL.**

**Method — SQL Editor (recommended):**
1. First, create user via **Authentication** → **Users** → **Add user** → enter email, password, auto-confirm email
2. Copy the user UUID
3. Go to SQL Editor, run:
```sql
-- Make user admin (replace UUID)
insert into public.profiles (id, email, role, status)
values ('USER_UUID_HERE', 'admin@erobabe.com', 'admin', 'active')
on conflict (id) do update set role='admin', status='active';

-- Verify
select id, email, role from public.profiles where id='USER_UUID_HERE';
```
4. Alternatively, after user signs up as advertiser, promote via SQL:
```sql
update public.profiles set role='admin' where email='admin@erobabe.com';
```

**Security note**: Document this procedure, keep audit log. Do not expose promotion endpoint.

### 11. Verify database and authentication flows
- Sign up as advertiser at `/auth/sign-up` — should receive verification email via Resend
- Verify an existing user can sign in — public users land on `/`; staff use `/admin/signin`
- Sign in as admin — should land on `/admin`
- Try to access `/admin` as advertiser — should redirect to sign-in (middleware + RLS)
- Try to query `payments` as anon via API — should be denied
- Check `ad_slots` has exactly 10 rows

---

## C. Guest PayPal advertising checkout

The active billing flow is account-free and uses the supplied PayPal QR. There is
no advertiser registration, advertiser dashboard, crypto checkout, payment IPN,
or automatic payment confirmation. Historical campaign/payment tables and their
migrations remain for audit compatibility only.

### 1. Publish the authoritative payment artwork and PayPal page

The checkout's fixed right-hand panel shows the operator-supplied artwork:
`https://drive.google.com/file/d/1l1dIKZHIXguLYPmJ0QpAWEe6eHkRYsNq/view?usp=sharing`

It is referenced through `NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL` (default: the Drive
thumbnail for that file) with `public/paypal-qr.png` served as `/paypal-qr.png` as the
bundled fallback. Download the artwork into `public/` and point the variable at that local
file if you prefer not to depend on Google Drive at runtime. Do not accept an image URL or
payment destination from a checkout visitor.

Payment itself is the hosted PayPal page
`https://www.paypal.com/ncp/payment/AZP63KXT9FUNL` (`lib/ads/payment.ts`). Configure that
PayPal page to return the payer to the site homepage: the homepage shows the ten-second
**In review** confirmation when the checkout's local flag is present.

### 2. Apply the advertising migration

Apply every migration in filename order, including
`supabase/migrations/00000000000025_paypal_ad_orders.sql`. It creates the private
`ad_orders` table, server-priced reservation and admin-review RPCs, restrictive
RLS/grants, and the `ad-creatives` storage bucket. Do not substitute a client-side
price or payment status.

Configure the normal Supabase server credentials and Resend credentials from
`.env.example`. The PayPal QR flow has no PayPal API key, webhook secret, or
payment-gateway environment variable.

### 3. Checkout and review behavior

1. A visitor clicks a vacant banner and goes directly to `/checkout?slot=<id>`.
2. The visitor enters campaign/contact details and uploads a real JPG or PNG,
   maximum 5 MB, with an exact 16:9 aspect ratio.
3. The server validates the image bytes and dimensions, recalculates the price
   from `ad_slots`, uploads the creative, and atomically reserves the slot.
4. The visitor scans the QR in PayPal and optionally supplies the transaction ID.
   Clicking **Submit** records an `in_review` order; it does not prove payment.
5. An animated **In review** screen returns the visitor to the public site after
   five seconds.

### 4. Manual fulfilment

1. Open **Admin → Ad Review** and inspect the banner, destination, amount, and
   PayPal transaction reference.
2. In the actual PayPal account, confirm the sender, amount, currency, and date.
3. Choose **Confirm PayPal payment**. This only marks payment verified.
4. After moderation, choose **Approve & make live**. The database starts the
   purchased duration and the route sends the advertiser a Resend email with
   subject **Your ad is live! Erobabe**.
5. If Resend fails, the ad remains live and the admin action displays a warning;
   fix `RESEND_API_KEY` / `RESEND_FROM_EMAIL` and record fulfilment manually.

### 5. Acceptance checks

- `/checkout?slot=1` returns 200 without a session and displays the local QR.
- `/advertiser` and the old crypto billing API routes return 404.
- A non-16:9 or disguised non-image upload is rejected before order creation.
- Two visitors cannot reserve the same available slot concurrently.
- An admin cannot make an order live before payment is manually verified.
- A live order appears in public inventory and expires at its server-set `ends_at`.
- A permitted test payment triggers the exact live-email subject in staging.

## D. Video catalog — damplips embeds

Uploads are retired. Migration `00000000000026_damplips_embeds.sql` drops the
upload tables, the Bunny columns and the upload functions, and the code has no
upload adapter, upload route or cron sweep. Videos are embedded from
damplips.com; full detail is in `docs/DAMPLIPS_EMBEDS.md`.

1. **Apply the migration**: run every file in `supabase/migrations/` in order,
   including `00000000000026_damplips_embeds.sql`.
2. **Check reachability** from the machine that will run the import:
   ```bash
   npm run import:damplips -- --probe=https://www.damplips.com/p/67284/
   ```
   `media: NOT FOUND` means damplips changed its player markup; capture the page
   HTML and update `lib/damplips/parse.ts`.
3. **Fill every category** (100+ each, 110 by default):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     npm run import:damplips -- --categories=all --per-category=110
   ```
   Or use **Admin → Videos → Sync from damplips**, which runs one category per
   request. Both are idempotent; re-run to top a category up.
4. **Confirm the target** in **Admin → System Health** (per-category published
   counts) or with `select * from damplips_category_counts;`.
5. **Playback** goes through `/api/videos/stream?src=…`, which only fetches
   `*.damplips.com` over https, sends the referer the media host expects and
   forwards range requests. Nothing is copied to storage or the server.
6. **Rights and takedowns**: imported rows are written `rights_status='cleared'`
   so categories are visible immediately. If you need review first, import with
   `--rights=pending` (or tick *Stage as private drafts* in the dashboard). Keep
   `/dmca` and `/content-removal` current; deleting a row keeps an operator
   record in `media_retention`.

## D2. Video admin tools

Everything below lives on **/admin/videos** and works on embedded rows; there is
no uploader, no encoder queue and no server-side thumbnail generation.

- **Library table** — search by title, filter by category and status, replace a
  poster URL, publish or unpublish a row, and delete one row or a filtered
  selection (200 per request). Deleting a row removes the embed and keeps an
  operator record in `media_retention`.
- **Publish** requires a real playback destination: a `playable_url` or an
  `embed_url`. Publishing sets `status='published'`, `visibility='public'`,
  `rights_status='cleared'`, `moderation_status='approved'` and writes a
  `video_published` audit entry.
- **Homepage carousel (migration 00000000000010 + 20)** — `videos.carousel_position`
  (1–3) drives the three hero cards. Assigning a slot asks OpenRouter for a
  headline (≤5 words) and teaser (≤10 words), stored in `videos.carousel_title`
  and `videos.carousel_description`. If `OPENROUTER_API_KEY` is missing or the
  model answers unusably, the listing title is shortened to the same budget, the
  slot is still saved, and the row says a fallback was used.
- **Sync from damplips** — the panel above the table fills categories from the
  catalog importer (section D).
- **Retired here**: the upload page, `PublishVideoButton`, automatic
  frame/thumbnail generation (ffmpeg), the thumbnail ranking pipeline, the
  storage-token session route and `/api/cron/bunny-publish`. Migration 26 drops
  their tables and functions.

---

## E. AI Metadata Setup (OpenRouter · NVIDIA Nemotron 3 Ultra free route)

Model listing: https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free —
code: `lib/metadata/` (`openrouter.ts` for the client, `suggestion.ts` for the
prompt and validation), route: `/api/metadata/suggest`.

1. Go to https://openrouter.ai/keys → **Create key**. The selected model route
   is listed as free, but free-tier rate limits and provider availability apply.
2. Copy the actual OpenRouter key — this is `OPENROUTER_API_KEY` (server-only,
   never expose it in a `NEXT_PUBLIC_*` variable). Keys start with `sk-or-`.
   **The model ID is not an API key.**
3. Set `OPENROUTER_API_KEY=<key>`. With no `OPENROUTER_MODEL` override, the app
   uses `nvidia/nemotron-3-ultra-550b-a55b:free` (the currently listed OpenRouter
   ID for NVIDIA Nemotron 3 Ultra). If this hosting environment already sets
   `OPENROUTER_MODEL` to an older model, remove that override or update it to
   the desired slug.
4. In the hosting provider's server environment, set the key for Production
   (and Preview if needed), then redeploy. Supabase *Edge Function* secrets are
   a different store that this Next.js app never reads — the key must be
   configured where the Next.js server runs.
5. Test: open **Admin → System Health** and press **Test OpenRouter**. It sends
   one tiny real request and reports the model, latency, and any provider error.
   It walks the same route chain an upload uses, so it answers even when the
   preferred model is queueing. Then go to `/admin/videos/upload`, choose a
   category and source, and preview the generated title, description, and tags
   before starting the upload. To check a key from a terminal, run
   `OPENROUTER_API_KEY=sk-or-… npm run test:live` — see `tests/live/README.md`.
   **Model not answering?** The panel also lists the routes and any route that is
   temporarily benched after stalling; upload titles keep coming from the
   remaining routes. A free endpoint that never returns is the usual cause of
   `Waiting for AI title: openRouter did not answer in time`, so keep the
   fallback chain enabled (or set `OPENROUTER_FALLBACK_MODELS` to routes you
   trust), and prefer a paid or dedicated route if the queue keeps stalling.
6. Token and prompt budgets are kept small without shortening the validated
   fields: `OPENROUTER_MAX_OUTPUT_TOKENS` defaults to **512** for a suggestion;
   only an empty or cut-off response gets a larger retry cap, while semantic
   correction retries keep 512. Carousel copy is capped at 128 output tokens.
   Reasoning is disabled, and at most the 32 most relevant existing titles are
   included for near-duplicate avoidance; exact-repeat checks still run locally
   against the full catalog. If the provider rejects JSON mode or the reasoning
   field, the client retries without that optional field.
7. Suggestions still require human review against the actual video. Length
   near-misses are repaired; unusable responses get up to three attempts within
   the route's deadline. A route that *stops answering* — the common failure of
   a free endpoint, which is queued at the provider — is dropped after
   `MODEL_ATTEMPT_TIMEOUT_MS` (20 s) and the next route in the chain is asked
   inside the same budget, and a route that stalls twice in a row is benched for
   two minutes so later retries skip it. Titles are still only ever written by a
   model: there is no offline composer to fall back to, so if every route fails
   the `/api/metadata/suggest` endpoint reports an actionable error and the
   upload queue keeps retrying instead of publishing a filler title.
8. **Data handling:** do not send video bytes, private rights documents, payment
   records, or personal information. Metadata generation uses the selected
   category and a compact recent-title avoid list; carousel copy generation
   sends listing text. The free model listing notes that requests may be logged
   for security and product improvement, so send only non-confidential listing
   metadata. AI output does not prove rights, age, consent, or factual attributes.
9. Diagnose: missing key → 503; rejected key (401/403) → 503; account credit or
   quota limits (402/429) → 429; unavailable/unknown model (404) → 502; malformed
   output → 502. The key never appears in responses or logs; key-shaped text
   echoed by a provider is redacted before it is shown.
10. If the model repeatedly returns cut-off or unparsable JSON, first verify the
    model slug in OpenRouter's catalogue. Raise `OPENROUTER_MAX_OUTPUT_TOKENS`
    only if the model genuinely needs a larger completion; the default is sized
    for this short JSON payload. If a route is slow rather than wrong, remove it
    from `OPENROUTER_FALLBACK_MODELS` or point `OPENROUTER_MODEL` at a faster one
    — stall time is wasted budget, and every route in the chain spends a share of
    it.

---

## F. Resend Setup

1. Go to https://resend.com → **Sign Up**
2. Add sending domain:
   - Go to **Domains** → **Add Domain** → enter `erobabe.com`
   - Resend will show DNS records (SPF, DKIM, DMARC)
3. Configure DNS through domain provider (e.g., Cloudflare):
   - Add TXT records for SPF/DKIM as shown
   - Add MX if required
   - Wait for verification (can take minutes to hours)
4. Verify domain status in Resend — should show **Verified**
5. Create API key:
   - Go to **API Keys** → **Create API Key** → Name: `erobabe-prod` → Permission: Sending access → **Create**
   - Copy key (starts `re_...`) — this is `RESEND_API_KEY` (server-only)
6. Configure sender address:
   - Use `noreply@erobabe.com` or `support@erobabe.com` — must be from verified domain
   - Set `RESEND_FROM_EMAIL=noreply@erobabe.com`
7. Integrate Supabase Auth email delivery:
   - Option A: SMTP (see Supabase Setup step 5)
   - Option B: Resend Integration → **Integrations** → **Connect to Supabase** → select project → select domain → **Add API Key** → sender name `erobabe` → **Configure SMTP Integration**
8. Configure webhook verification if webhooks used:
   - Go to **Webhooks** → **Add Webhook** → URL: `https://YOUR_DOMAIN/api/resend/webhook` (if you implement)
   - Resend docs: verify signatures via `svix` library — our code does not yet implement webhooks, but if you add, verify per current docs
9. Test email flows:
   - Reset password — should receive reset email
   - Submit a guest ad, verify its payment manually, and make it live in staging — the advertiser should receive **Your ad is live! Erobabe**
   - Contact form — submit at `/contact`, check `support_tickets` table and email to support
   - Support ticket — similar
   - Content removal — submit at `/content-removal`, check `reports` table and ack email

---

## G. GitHub and Web Application Hosting

### GitHub
1. Ensure repo https://github.com/sutarorg/erobabe is up to date
2. Branch for this session: `arena/d8fa6809-erobabe` — push changes: `git push origin arena/d8fa6809-erobabe`
3. Open PR from that branch to `main` if needed
4. CI: add GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `npm ci`, `npm run type-check`, `npm run test`, `npm run build`

### Web Hosting — Decision

**Do NOT deploy commercial Erobabe to Vercel Hobby** — limited to personal non-commercial, AUP restricts objectionable content.

**Options:**
- **Fly.io**: Allows adult content if legal, supports Docker, streaming uploads. Check current AUP at https://fly.io/docs/about/acceptable-use/
- **Render**: Check AUP
- **Railway**: Check AUP
- **Self-hosted VPS**: Hetzner, DigitalOcean, etc., with Docker, Caddy/NGINX for HTTPS

**Our code is Next.js — deployment steps for generic host:**

1. **Build**: `npm run build` — should succeed with no TS errors
2. **Env vars**: Set all required env vars in hosting dashboard (see Section I)
3. **Start**: `npm run start` — serves on port 3000
4. **Health check**: `https://YOUR_DOMAIN/api/health` (if you add) or `/` should return 200
5. **Preview deployments**: Enable for PRs, but ensure env vars set

**If using Vercel Pro (commercial, with approval):**
1. Go to https://vercel.com → **Add New Project** → Import `sutarorg/erobabe`
2. Framework preset: Next.js
3. Build command: `next build`
4. Output directory: `.next`
5. Add env vars in **Settings** → **Environment Variables** — mark `NEXT_PUBLIC_*` as exposed, others as secret
6. **Before deploying**, contact Vercel support to confirm adult content and commercial use permitted on chosen plan — document approval
7. Deploy

**If using Fly.io:**
```bash
fly launch --dockerfile Dockerfile (create Dockerfile for Next.js)
fly secrets set NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... RESEND_API_KEY=... etc
fly deploy
```

---

## H. Domain and DNS

1. **Purchase or use existing domain**: e.g., `erobabe.com` via Cloudflare, Namecheap
2. **Configure DNS**:
   - If using Vercel: add domain in Vercel dashboard → Vercel will show DNS records (A, CNAME) → add to registrar
   - If using Fly.io: `fly ips list`, add A/AAAA records
   - For Resend: add SPF/DKIM TXT records as per Resend dashboard
   - For Supabase: no extra DNS needed, but ensure Site URL matches domain
3. **Verify HTTPS**: Hosting should auto-provision Let's Encrypt cert — check `https://YOUR_DOMAIN` loads with valid cert
4. **Canonical domain**: Choose `https://erobabe.com` (no www) or `https://www.erobabe.com` — set `NEXT_PUBLIC_SITE_URL` to canonical, and configure redirect from non-canonical to canonical in hosting or Next.js config
5. **Auth redirect URLs**: Update Supabase Auth URL Configuration to use production domain (see Supabase Setup step 3)
6. **Retired billing endpoints**: Old crypto checkout/IPN/status/reconciliation URLs must return 404. The PayPal QR flow has no callback endpoint; fulfilment is manually reviewed under **Admin → Ad Review**.
7. **Sitemap**: `https://YOUR_DOMAIN/sitemap.xml` and `https://YOUR_DOMAIN/video-sitemap.xml` must be accessible

---

## I. Environment Variables Reference

| Variable | Purpose | Browser-visible? | Where to obtain | Where to configure | Required in | How to verify | Redeploy? |
|----------|---------|------------------|-----------------|--------------------|-------------|---------------|-----------|
| `SITE_URL` | Canonical site URL for server | No | Your domain | Hosting env, Supabase secrets | prod | `echo $SITE_URL` | Yes |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for client metadata, sitemap | Yes | Your domain | Hosting env, Vercel env | dev, preview, prod | Check page source canonical | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes | Supabase Dashboard → Project Settings → API → Project URL | Hosting env, .env.local | dev, prod | `https://xxx.supabase.co` | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (safe for browser with RLS) | Yes | Supabase Dashboard → API → Publishable key | Hosting env | dev, prod | Starts `sb_publishable_` | Yes |
| `SUPABASE_SECRET_KEY` | Supabase secret key (service_role, bypasses RLS) — server only | No | Supabase Dashboard → API → Secret key | Hosting env secrets, Supabase Edge Functions secrets | prod | Never in client bundle, check server logs not exposed | Yes |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI metadata suggestions | No | https://openrouter.ai/keys → Create key | Hosting secrets | prod (optional) | Test via System Health → Test OpenRouter, or `/api/metadata/suggest` as admin | Yes |
| `OPENROUTER_MODEL` | OpenRouter model slug (the preferred route) | No | `nvidia/nemotron-3-ultra-550b-a55b:free` (default) | Hosting env | prod (optional) | Check https://openrouter.ai/models for the slug | No |
| `OPENROUTER_FALLBACK_MODELS` | Comma/space-separated routes tried, in order, when the preferred route stops answering | No | Unset → `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-super-120b-a12b:free`; set empty for the preferred model only | Hosting env | prod (optional) | Admin → System Health lists the chain and any benched route; `Waiting for AI title: openRouter did not answer in time` means the chain ran out — check the slug and the account's free-tier quota | No |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | First-attempt output-token cap for one metadata suggestion | No | `512` (default) | Hosting env | prod (optional) | Raise only if suggestions are truncated | No |
| `VIDEO_TITLE_STYLE` | Voice of generated listing titles | No | `explicit` (default); `editorial` for the older euphemistic voice | Hosting env | prod (optional) | Generated title names the act in the explicit voice and stays non-graphic in the editorial voice; both keep the same age/consent guardrails | No |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |
| `DAMPLIPS_BASE_URL` | Optional mirror/base for the catalog importer | No | `https://www.damplips.com` (default) | Hosting env or the import shell | optional | `npm run import:damplips -- --probe=/p/67284/` resolves against it | No |

**Security**: Never place `SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

---

## J. Testing and Go-Live Checklist

### Automated tests

```bash
npm ci
npm run type-check
npm run test
npm run build
npx playwright test
```

### Manual test cases

**Authentication:**
- [ ] Guest checkout at `/checkout?slot=1` loads without sign-in and never asks for an advertiser account
- [ ] Sign in with wrong password → error shown
- [ ] Sign out → session cleared, redirect to `/`
- [ ] Access `/admin` as unauthenticated → redirect to staff sign-in
- [ ] Access `/admin` as a non-admin → denied
- [ ] `/advertiser` and `/auth/sign-up` return 404
- [ ] Browser roles cannot read `ad_orders` or execute its service-only RPCs

**Admin:**
- [ ] Admin sign-in → `/admin` dashboard shows real counts (no mock)
- [ ] Device uploads at `/admin/videos/upload` → multiple local files, real progress, local thumbnails and verified completion.
- [ ] `/admin/videos` offers no upload control, and `app/admin/(dashboard)/videos/upload` returns 404.
- [ ] **Sync from damplips** fills a category: the report shows a target, the imported count, and a poster and title for every row; `select * from damplips_category_counts` shows 100+ for every category.
- [ ] A published damplips video plays on `/video/<slug>` through `/api/videos/stream`, seeks (range request), and an HLS row plays every segment through the same route (playlists are rewritten; no request goes to damplips from the browser).
- [ ] `curl -o /dev/null -w '%{http_code}' 'https://your-domain/api/videos/stream?src=https://example.com/x.mp4'` returns 403.
- [ ] Category management at `/admin/categories` → list categories, add new category, and edit label/slug/description/icon
- [ ] Ad slots at `/admin/ad-slots` → the homepage rail layout: five slot cards left, five plus the inventory summary right; sold slots show the live creative, open slots carry the **Available** tag
- [ ] Advertisements at `/admin/advertisements` → review creative, approve/reject, delete permanently
- [ ] Deleting a live ad frees its slot and removes its $99 from **Verified Ad Revenue** on `/admin`
- [ ] `/admin/campaigns` and `/admin/users` return 404 (pages removed with their API actions)
- [ ] Payments at `/admin/payments` → list real payments, no fake
- [ ] Reports at `/admin/reports` → list real reports, resolve
- [ ] Logs at `/admin/logs` → shows real audit_logs
- [ ] System health at `/admin/system-health` → shows real checks, Unknown if not configured, not hardcoded green

**Guest PayPal advertising:**
- [ ] Click a vacant banner → direct `/checkout?slot=<id>` navigation, with no billing modal or account wall
- [ ] Checkout is split between campaign/banner fields and the supplied PayPal QR
- [ ] Real JPG/PNG, maximum 5 MB and exact 16:9 → accepted; disguised or other ratios → rejected
- [ ] Client-supplied price/payment status is ignored; the RPC uses the slot price and creates `in_review` / `unverified`
- [ ] Two submissions cannot reserve the same slot; an occupied slot reports unavailable
- [ ] Submit → animated **In review** page → public homepage after five seconds
- [ ] Admin verifies the receipt in the real PayPal account before **Confirm PayPal payment**
- [ ] **Approve & make live** is blocked until payment verification, then starts the purchased duration
- [ ] Going live sends **Your ad is live! Erobabe** through Resend; email failure is shown honestly and does not unpublish the ad
- [ ] Live ads appear publicly and disappear after `ends_at`
- [ ] Old advertiser, crypto checkout, IPN, status, and reconciliation routes return 404

**Video hosting:**
- [ ] Bunny device upload publishing, category/metadata/duplicate handling and required automatic thumbnails work with an active staging administrator
- [ ] Historic retired-provider records remain intact and show an unsupported message; no API calls occur
- [ ] Bunny Stream has passed section D authorized live acceptance
- [ ] Before launch: genuine device upload, accurate byte progress, verified completion/readiness, stable embed playback and failure/cancellation/idempotency tests all pass
- [ ] Bunny jobs never expose keys or upload authorization publicly

**Email:**
- [ ] Resend domain verified (check Resend dashboard)
- [ ] Auth verification email sent via Resend
- [ ] Password reset email
- [ ] Guest ad go-live email uses the exact subject **Your ad is live! Erobabe**
- [ ] A Resend failure leaves the ad live and surfaces an admin warning
- [ ] Support ticket notification
- [ ] Removal request acknowledgement
- [ ] Email delivery failure does not lose underlying request/payment/ticket — our code logs warning but persists

**SEO:**
- [ ] Root URL `/` opens public website, no hash routing
- [ ] Public URLs contain no hash dependency — e.g., `/video/my-slug`, `/category/mature`
- [ ] Each published video has unique URL
- [ ] Watch pages return correct title and metadata (check View Source, not just client)
- [ ] Canonical URLs correct (e.g., `<link rel="canonical" href="https://erobabe.com/video/slug">`)
- [ ] Required structured data valid JSON-LD and matches DB records (use Google Rich Results Test: https://search.google.com/test/rich-results)
- [ ] Sitemap XML valid: `https://YOUR_DOMAIN/sitemap.xml` — includes only eligible public URLs
- [ ] Video sitemap entries match published DB records: `https://YOUR_DOMAIN/video-sitemap.xml` — includes thumbnail, title, description, player_loc, duration, publication_date
- [ ] Removed/unpublished videos disappear from sitemap (publish then unpublish, check sitemap)
- [ ] Private dashboard routes do not enter public sitemap (check sitemap does not contain `/admin`)
- [ ] Robots rules allow public videos and thumbnails while disallowing `/admin/`, `/checkout`, and `/api/`
- [ ] Missing video URLs return genuine 404 (not 200) — test `/video/nonexistent-slug`
- [ ] Internal navigation uses crawlable `<a href>` links (check VideoCard uses `<a href="/video/...">`)
- [ ] No placeholder videos or false SEO claims remain — search codebase for `pexels`, `mock`, `demo` in production

### Rollback and recovery

**Failed deployment:**
1. Hosting: rollback to previous deployment via dashboard (Vercel: Deployments → previous → Promote, Fly.io: `fly releases`, `fly deploy --image ...`)
2. Check logs for env var missing or build error

**Failed database migration:**
1. Supabase Dashboard → **Database** → **Backups** → Restore to point in time (if PITR enabled) or use snapshot
2. Or revert migration via SQL: `drop table if exists ...` then re-apply previous migration
3. Verify RLS policies still enabled

**Guest advertising fulfilment issues:**
1. Inspect the `ad_orders` row and the actual PayPal receipt; never treat the visitor's Submit action or transaction-ID text as proof.
2. Check `audit_logs` for `ad_order_verify_payment`, `ad_order_make_live`, or `ad_order_reject_ad` and confirm the acting admin.
3. If the creative upload succeeded but reservation failed, remove the orphan object from `ad-creatives/orders/` after review.
4. If the ad is live but email failed, fix Resend configuration and record the manual follow-up. Do not roll back a valid live placement solely because email delivery failed.
5. Do not manually set `payment_status='verified'` or `status='live'`; use the admin RPC so slot occupancy, payment verification, schedule, and audit invariants hold.

**Video hosting outage:**
1. Check provider status page
2. If Bunny Stream is unavailable, keep failed sessions for reconciliation. Do not create a duplicate or proxy video bytes through the app server.
3. Stored embed identities remain stable, but a provider outage, deletion or security restriction can still prevent playback

---

## Unresolved Provider Approvals and Blockers

1. **Bunny account/content-use confirmation**: AUP is conditional, not evidence this catalogue/account is approved. Obtain support/legal confirmation.
2. **Live acceptance**: authorized staging credentials, forward migration, real TUS upload, generated thumbnail storage, Finished status and desktop/mobile playback must be verified. Automated tests do not prove live Bunny functionality.
3. **Vercel Hobby**: Not suitable for commercial adult site. Hosting decision required — see `GO_LIVE_CHECKLIST.md`.
4. **Age assurance**: Frontend gate alone not robust. Legal review required for jurisdiction-specific verification.
5. **Legal identity**: Owner must provide real business details before publishing Terms/Privacy.
5. **PayPal destination**: Owner must confirm the QR resolves to the intended operational PayPal account and that the account may receive these advertising payments.
6. **Resend domain**: Must verify DNS before emails deliver reliably.

A successful build does NOT imply cleared for commercial launch.

---

## Verification Commands

```bash
# Install
npm ci

# Type check
npm run type-check

# Build
npm run build

# Run dev
npm run dev

# Test SEO endpoints locally
curl http://localhost:3000/sitemap.xml | head -n 50
curl http://localhost:3000/video-sitemap.xml | head -n 50
curl http://localhost:3000/robots.txt

# Check for mock data leakage
grep -R "pexels\|INITIAL_VIDEOS\|mock\|demo" --include="*.tsx" --include="*.ts" app/ | grep -v "node_modules" | grep -v "IMPLEMENTATION_AUDIT"

# Prove the catalog: one post resolves, and the stream proxy refuses foreign hosts
npm run import:damplips -- --probe=/p/67284/
curl -o /dev/null -w '%{http_code}\n' "https://your-domain/api/videos/stream?src=https://example.com/x.mp4"   # expect 403
```


## October 14 audit rollout addendum — mandatory

1. Stop new bookings/uploads during schema rollout. Back up DB and Storage metadata; restore and test the backup in an isolated staging project. Run `docs/LAUNCH_PREFLIGHT.sql`. Resolve overlaps and unsafe historical records deliberately; migrations do not silently delete or relabel payment history.
2. Verify applied migration history. Apply only unapplied SQL in order: **14 launch_integrity**, **15 measured_events**, **16 video_review_and_retention**, **17 operator_actions**, **18 payment_recovery**. Do not edit/reapply 00–13. Migration 14 restricts browser permissions immediately; deploy matching application code in the same maintenance window. All five have transaction wrappers. Use the Supabase CLI's reviewed migration process so migration history stays accurate; dashboard execution alone does not populate CLI history automatically.
3. Backfill/review historic confirmed payments before enabling ads. `eligible_ads` now requires paid/approved/associated/in-date/active-account records. Legacy provider records are retained, not automatically trusted by a new checkout. Current migration 14 adds one-hour holds to existing campaign rows; reconcile pending invoices before exposing inventory. Campaign dates use **[start_date,end_date)** in UTC; a month is the existing 30-day product definition.
4. Use Node **22.x**, `npm ci`, and the full commands in PRODUCTION_READINESS.md. Lint now uses supported ESLint CLI directly. FFmpeg is no longer packaged and no video bytes pass through Next/Supabase; the catalog is embedded from damplips, and the import needs outbound HTTPS to damplips.com.
5. Set NEXT_PUBLIC_SITE_URL to the approved HTTPS domain. SITE_URL is not a runtime environment variable. Register `/auth/callback` and `/auth/callback?next=/auth/update-password` for both staging and production Auth redirect allowlists; test PKCE verification/recovery emails from a real inbox. Never use wildcard production redirects.
6. Fill the catalog before launch (`npm run import:damplips -- --categories=all --per-category=110`, or the dashboard sync), then confirm `damplips_category_counts` reports 100+ for every category. Since the media is embedded, the takedown path is `/dmca` plus deleting the row, which writes a `media_retention` record.
7. Configure a dedicated random ANALYTICS_HASH_SECRET (server-only, preferably 32+ random bytes). The service credential is a fallback. The trusted reverse proxy **must overwrite x-real-ip**. Without a trusted client IP, fallback clients share an abuse budget. Bot/WAF and multi-instance acceptance are launch gates, not supplied by browser events. Schedule `select public.prune_measured_events();` daily under a service/DB operator identity: 7-day pseudonymous events, 2-day rate-key retention. Campaign totals remain after pruning. Impressions mean loaded creative >=50% visible for 1s in a foreground tab; watch-page views mean 5 foreground seconds, not proven playback. Counts are deduplicated (ad type/campaign/creative/visitor/hour; video/visitor/day) and not independently audited human traffic.
8. Guest checkout recovery: inspect the `ad_orders` row and the actual PayPal receipt before taking action. Do not create a duplicate order to retry moderation. Use **Admin → Ad Review** so verification, go-live, slot occupancy, and audit updates stay atomic. Historical provider recovery SQL remains only for legacy records and has no active application endpoint.
9. The ad-creatives bucket is provisioned with image MIME/10MB limits. Browser object overwrite/deletion is denied; creative edits must submit new media for review. Pending assets in this public bucket are accessible by exact object URL; select/implement private premoderation storage if required by your content/data policy before accepting untrusted uploads. MIME declarations alone are not byte-level content scanning.
10. Catalog deletion now creates a durable **media_retention** record (visible in System Health) in the same transaction. Review legal retention/backups, match provider/library/GUID to the deleted catalog record, and obtain two-person deletion approval. Retain or delete the exact remote object in the provider dashboard; verify provider outcome independently, then update that queue row to `retained` or `deleted` with `reviewed_at=now()` and record the change ticket in the operator audit. Never bulk-delete by title or erase the queue to hide billing inventory. No remote deletions were made in this audit.
11. Roll back application code only with compatible schema permissions; do **not** restore permissive advertiser RLS to make old checkout code work. A failed migration transaction rolls back itself. For post-rollout issues, disable writes and use forward fixes; database restore is a separately approved disaster-recovery operation, tested on staging first.


## Historical October 15 payment-recovery follow-up — legacy records only

- Apply **00000000000018_payment_recovery.sql** after 14–17, in the same controlled maintenance window as the matching application. It replaces the four-argument `bind_nowpayment` with a five-argument version requiring the authenticated active admin ID. Old recovery handlers deliberately cannot bind through the removed signature; do not roll back the application alone and assume recovery is compatible.
- The RPC row-locks the payment, validates bounded positive decimal amounts, rejects replacement identities/addresses/amounts, and atomically records the recovering actor in `payment_events` and `audit_logs`. Repeating the same valid reference is harmless, including after settlement. Recovery **does not itself mark a payment paid**.
- Initial checkout and recovery now share quote validation: a real matching order and asset, exact USD price (no rounding mismatches), bounded nonempty address, positive decimal pay amount with at most 18 fractional digits, and valid provider ID. Invalid/absent evidence stays unbound for investigation. Do not manually replace a bound address or quote.
- Automatic fulfillment requires provider `finished` plus exactly matching received crypto at the supported 18-decimal working precision; it no longer uses the comparison utility's legacy 2% tolerance. Shortfalls/excesses are recorded for manual reconciliation, not silently forgiven or auto-delivered. Missing `actually_paid` never falls back to quoted funds.
- If provider snapshots disagree, IPN/recovery returns a retry rather than directly changing only the payment. Retry with current provider evidence; terminal outcomes must pass through the transactional settlement RPC. Inspect the added historical payment/invoice preflight query: past mismatches are **not automatically repaired**. Any repair needs verified provider evidence and an audited, approved operator action.
- Local tests prove route behavior, SQL authorization, identical retries and rollback on audit failure. They are not evidence of real-provider API delivery or independent concurrent PostgreSQL sessions; both remain release gates.

## October 15 upload-session follow-up — required

- Apply **00000000000019_auto_publish_and_ai_metadata.sql** (Supabase → SQL Editor, or `supabase db push`). It adds `bunny_uploads.description` and the auto-publish versions of `stage_bunny_upload`/`finish_bunny_upload`. Until it is applied, uploads still succeed, but AI descriptions are not saved, finished videos wait in the video library for manual publishing, and the upload page shows a notice naming the migration. Running it also **publishes every Bunny video currently in `pending_review`** (the auto-publish behaviour), so check that queue first. It is safe to re-run: one transaction, `add column if not exists`, `create or replace function`.
- Re-selecting a file that was attempted before (failed, cancelled, interrupted or reloaded) no longer fails with "Session already reserved or database unavailable": the server resumes that file's existing session. Database failures while reserving a session now report their actual cause and PostgreSQL/PostgREST code (also logged as `[bunny] Could not …`).


## 16 October recommendation system deployment addendum

Migration **00000000000024_recommendations.sql** is a new forward migration and is not part of the earlier 00–23 migration list above. Review the actual applied migration ledger, take a restorable backup, apply migration 24 in staging first, and verify the PGlite RLS tests plus real Supabase grants/indexes before production. Do not edit or replay already-applied migrations.

1. Deploy the matching application and migration together. Personalized feeds are no-store; do not add CDN/shared caching to `/api/videos/feed`, `/api/recommendations/*`, or cookie-varying home/watch responses.
2. Configure dedicated server-only `ANALYTICS_HASH_SECRET` and existing `SUPABASE_SECRET_KEY` (never a `NEXT_PUBLIC_*` secret). Set the canonical `SITE_URL` for the recommendation-retention job; the upload-publish sweep workflow has been removed.
3. Confirm `.github/workflows/recommendation-retention.yml` is enabled, run it manually, verify `/api/cron/recommendation-retention` returns 2xx only with the secret, and verify expired rows are removed. It runs daily; cleanup failure is a privacy incident. The retention RPC removes event rows older than 30 days and feedback/profile rows after their 180-day lifetime.
4. Stage the default-on profile flow (cookie requested by `RecommendationProfileInit` on the first public page view), profile cookie attributes, disable/reset deletion, feedback suppression, cold-start browsing, API origin/rate validation, and no-store cache headers. Confirm recommendation tables are inaccessible to `anon` and `authenticated` and only trusted server RPCs can write.
5. Run `EXPLAIN (ANALYZE, BUFFERS)` against a representative staging catalog for latest, category, like, popularity and tag candidate queries. No production query plan or p95 value is available from this session. Do not report the documented 250 ms/150 ms targets as measured.
6. Verify the embedded player's `play/timeupdate/ended/error` milestones against a real damplips video and a direct-file clip, including the same-origin proxy and a range-seeking browser.
7. Confirm user-facing privacy copy, 18+ controls, legal age assurance, rights/moderation review and adult-content provider approval with the responsible privacy/legal/operator owners. The current localStorage age declaration is not remote age verification.

See `docs/RECOMMENDATION_PRIVACY.md` and `docs/RECOMMENDATION_ALGORITHM.md` for retention boundaries, signals, configuration, evaluation targets and known pagination limitations.
