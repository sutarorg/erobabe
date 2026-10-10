# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

This document gives complete, verified steps to deploy Erobabe from zero to production. It covers Supabase, Bcon, video hosting, Groq, Resend, GitHub, hosting, domain, env vars, testing, and rollback.

**Date**: October 10, 2026  
**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), Bcon Global, Resend, Groq, internal video provider (Uqload blocked).

---

## A. Prerequisites

### Accounts needed
- Supabase account (https://supabase.com)
- Bcon Global account (https://bcon.global)
- Resend account (https://resend.com)
- Groq account (https://console.groq.com)
- GitHub account with access to https://github.com/sutarorg/erobabe
- Domain registrar (e.g., Cloudflare, Namecheap)
- Hosting provider that permits lawful adult content and commercial use (NOT Vercel Hobby — see Hosting Restrictions). Recommended: Fly.io, Render, Railway, or self-hosted VPS with Docker. Verify Acceptable Use Policy before deploying.

### Local software
- Node.js 20+ (`node -v`)
- npm 10+ (`npm -v`)
- Git
- Supabase CLI (optional, for migrations): `npm i -g supabase` or `brew install supabase/tap/supabase`
- Playwright browsers: `npx playwright install`

### Decisions requiring owner authorization before production
1. **Video hosting provider**: Uqload TOS (https://uqload.vc/tos) prohibits pornography, nudity, sexual content. You MUST obtain written confirmation that lawful adult content, commercial use, API upload, and intended playback are permitted, OR approve replacement provider (Bunny.net Stream, Cloudflare Stream, Mux, or self-hosted S3 + transcoding). Without this, production video hosting is BLOCKED.
2. **Hosting provider**: Vercel Hobby is limited to personal non-commercial use and its Acceptable Use Policy restricts objectionable content. Do NOT deploy commercial Erobabe to Vercel Hobby. Choose a host whose terms explicitly permit adult content and commercial use. Document approval.
3. **Legal identity**: Operator must provide real legal name, business address, registration, contact emails, age-verification procedures. Do not publish fictional identity.
4. **Age assurance**: Evaluate jurisdiction-specific requirements (e.g., UK, EU, US state laws). Frontend age gate alone is not robust assurance. Implement required verification integration where legally required.
5. **Bcon wallet**: Owner must configure authorized receiving wallet in Bcon dashboard and choose token/network (e.g., USDT on Ethereum, Tron, etc.).

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
   - `https://erobabe.com/auth/callback` (if you implement callback)
   - `https://erobabe.com/auth/sign-in`
   - `https://erobabe.com/advertiser`
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
5. Verify in **Table Editor** that tables exist: `profiles`, `categories`, `videos`, `ad_slots` (should have 10 rows), `site_settings` (1 row), etc.

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

### 8. Configure and deploy Edge Functions (optional, for small orchestration)
If you use Edge Functions for email or notifications:
```bash
supabase functions new resend
# Edit function, then
supabase functions deploy resend --no-verify-jwt
```
Set secrets:
```bash
supabase secrets set RESEND_API_KEY=... GROQ_API_KEY=... BCON_API_KEY=...
```

### 9. Add production function secrets
In Supabase Dashboard → **Edge Functions** → **Secrets**, add:
- `RESEND_API_KEY`
- `GROQ_API_KEY`
- `BCON_API_KEY`
- `UQLOAD_API_KEY` (if applicable, but see blocker)
- `SITE_URL`

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
- Verify email, sign in — should land on `/advertiser`
- Sign in as admin — should land on `/admin`
- Try to access `/admin` as advertiser — should redirect to sign-in (middleware + RLS)
- Try to query `payments` as anon via API — should be denied
- Check `ad_slots` has exactly 10 rows

---

## C. Bcon Global Setup

### 1. Create/configure provider account
1. Go to https://bcon.global → **Sign Up**
2. Complete KYC if required
3. Create a **Store** per blockchain (Bitcoin, Ethereum, Tron, Binance, Solana)
4. For this launch, create one store for chosen chain (e.g., Ethereum for USDT)

### 2. Configure authorized receiving wallet
1. In Bcon Dashboard → **Stores** → Select store → **Settings**
2. Under **Wallet**, enter your authorized receiving wallet address (e.g., Ethereum address for USDT-ERC20)
3. For Bitcoin, you may need xPub
4. Save

### 3. Choose enabled token and network
1. In Store Settings → **Currencies**, enable token you want customers to pay with (e.g., USDT, USDC, BTC)
2. Choose chain: `ethereum`, `tron`, `binance`, `bitcoin`, `solana` — must match `BCON_CHAIN` env var
3. Set **Payment Currency** = token ticker, e.g., `USDT`

### 4. Find API credentials
1. In Store Settings → **API Keys** → **Copy Generated Keys**
2. Each chain store has its own API key — copy the key for your chosen chain
3. This is `BCON_API_KEY` (server-only)

### 5. Configure real callback endpoint
1. In Store Settings → **Callback URL** (or **Webhook**), set:
   - `https://YOUR_DOMAIN/api/bcon/callback`
   - Example: `https://erobabe.com/api/bcon/callback`
2. Bcon docs show callback example uses query params: `addr`, `txid`, `value`, `status`, `external_id`
3. Save

### 6. Configure callback behavior
- Bcon does NOT document cryptographic signature for callback (as of 10 Oct 2026). Do NOT invent one.
- Our implementation verifies: `external_id` exists, `payment_address` matches, `transaction_id` not already processed, amount within tolerance, status = confirmed (2 confirmations) required before marking paid.
- Callback must be idempotent — repeated callbacks must not duplicate ledger entries.

### 7. Run test payments
- Bcon docs mention **Test Payment** endpoint — use it if available in dashboard
- Create a test payment request via our `/api/bcon/create` endpoint with small amount (e.g., $1) in development
- Simulate callback via curl:
```bash
curl "https://YOUR_DOMAIN/api/bcon/callback?external_id=erobabe-test-123&addr=TEST_ADDR&txid=0xabc...&value=1&status=confirmed"
```
- Check `payments` table status should become `confirmed` only if status=confirmed and verification passes
- Check `payment_events` table has immutable records
- Check invoice becomes `paid`

### 8. Verify transaction status
- Bcon API: `GET https://external-api.bcon.global/api/v1/transactions/<txid>` with Bearer key
- Our `confirmPayment` function marks confirmed only after 2 confirmations per Bcon docs
- Monitor `audit_logs` for `payment_confirmed` actions

### 9. Troubleshoot pending and failed
- Pending: callback not yet received or only unconfirmed — wait for confirmations
- Failed: check `bcon_response` JSON in `payments` table, check `payment_events`
- Underpaid/Overpaid: logged for admin review, never silently discard funds — see `payments` status `underpaid`/`overpaid`
- Expired: invoice expired after 1 hour (configurable) — generate new invoice

---

## D. Video-Hosting Setup

### Hosting Decision — CRITICAL BLOCKER

**Uqload policy gate**: Uqload Terms of Service (https://uqload.vc/tos) states:
> "Pornography, nudity, sexual and any kind offensive videos are prohibited."

**Current status**: PRODUCTION VIDEO HOSTING BLOCKED for Uqload without written approval.

**Before enabling production uploads, you must EITHER:**
1. Obtain written provider confirmation that lawful adult content, commercial use, API upload, and intended playback method are permitted; OR
2. Have owner approve replacement provider whose current terms explicitly support adult-content business.

**Replacement providers whose terms typically support adult (verify current terms before use):**
- Bunny.net Stream (check Acceptable Use, adult allowed with restrictions)
- Cloudflare Stream (check terms, adult may be allowed if legal)
- Mux (check terms)
- Self-hosted S3 + transcoding (AWS S3, Wasabi, etc.) with your own player

**Our implementation keeps provider integration replaceable via `lib/video/provider.ts` abstraction.**

**If approval not available:**
- Leave `UQLOAD_ADULT_CONTENT_APPROVED=false` and `VIDEO_PROVIDER=internal`
- Internal provider stores placeholder and marks video as pending_review — no real streaming
- Document blocker in `GO_LIVE_CHECKLIST.md` and this file
- Do NOT falsely mark production video hosting as ready

### If Uqload remains provider (with approval)

1. **Get API key**: Login at https://uqload.vc → Account Settings → API Key → copy
2. **Set env**: `UQLOAD_API_KEY=your_key`, `UQLOAD_ADULT_CONTENT_APPROVED=true`, `VIDEO_PROVIDER=uqload`
3. **Endpoints used by code**:
   - `GET https://uqload.vc/api/upload/server?key=API_KEY` → returns upload server URL
   - `POST https://sX.myvideo.com/upload/01` with FormData: `key`, `file`, `file_title`, `file_descr`, `tags`, `file_public=1`, `file_adult=1`
   - Response: `{ status:200, files:[{ filecode, filename, status }] }`
   - `GET https://uqload.vc/api/file/info?key=...&file_code=...` → check processing status, thumbnail
4. **Upload worker**: For large files, do NOT route multi-GB through Vercel Function (request body limit ~4.5MB). Use direct upload to provider server returned by `/api/upload/server` (our code does this server-side). If still hitting limits, deploy dedicated upload worker on infrastructure that permits adult content (e.g., Fly.io with streaming).
5. **Thumbnail behavior**: Uqload returns `player_img` in file info — we store as `thumbnail_url`
6. **Processing status**: `canplay=1` means ready — our `/api/videos/status` checks this and updates DB from `processing` to `pending_review`

### If using replacement provider

1. Implement new class in `lib/video/provider.ts` that implements `VideoProvider` interface
2. Update `getVideoProvider()` factory
3. Set `VIDEO_PROVIDER=bunny` (or chosen name) and set its API keys
4. Ensure embed/playable URLs are returned correctly and are not blocked by robots.txt
5. Test: upload via `/admin/videos/upload`, check status via `/api/videos/status`, verify playback on `/video/[slug]`

### Supabase Storage for internal/fallback

1. Go to **Storage** → **New bucket** → `ad-creatives` (public, for advertiser creatives)
2. Create bucket `video-thumbnails` (public)
3. Create bucket `videos` (private, if using internal provider for small files)
4. Set policies: allow authenticated upload to own folder, public read for thumbnails/creatives
5. Our code uses `supabase.storage.from("ad-creatives").upload(...)` — ensure bucket exists or upload will warn but not fail campaign creation

---

## E. Groq Setup

1. Go to https://console.groq.com → **API Keys** → **Create API Key**
2. Copy key (starts `gsk_...`) — this is `GROQ_API_KEY` (server-only, never expose to browser)
3. Set env: `GROQ_API_KEY=gsk_...`, `GROQ_MODEL=llama-3.1-8b-instant` (or current recommended model per docs)
4. Test: go to `/admin/videos/upload` → upload file, click **Suggest with Groq** → should return title, description, tags, category JSON
5. If not configured, rest of app must continue to work without AI suggestions — our code returns 503 with clear message
6. **Important**: Never send video bytes, private rights docs, payment records, or personal info to Groq. Only send file name, title, category, tags for metadata suggestion. AI output must be editable, reviewed, approved by admin before publication. Not proof of rights, age, consent, or factual attributes.

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
   - Sign up new advertiser — should receive verification email via Resend
   - Reset password — should receive reset email
   - Create campaign — should receive submission confirmation (if you wire `sendEmail` in campaign creation)
   - Payment confirmation — test Bcon callback with confirmed status, check if email sent
   - Contact form — submit at `/contact`, check `support_tickets` table and email to support
   - Support ticket — similar
   - Content removal — submit at `/content-removal`, check `reports` table and ack email

---

## G. GitHub and Web Application Hosting

### GitHub
1. Ensure repo https://github.com/sutarorg/erobabe is up to date
2. Branch for this session: `arena/2ee39806-erobabe` — push changes: `git push origin arena/2ee39806-erobabe`
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
fly secrets set NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... BCON_API_KEY=... etc
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
6. **Callback endpoints**: Bcon callback `https://YOUR_DOMAIN/api/bcon/callback` must be reachable via HTTPS, no auth
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
| `BCON_API_KEY` | Bcon Global API key per chain store | No | Bcon Dashboard → Store Settings → API Keys | Hosting secrets | prod | Test via `/api/bcon/create` | Yes |
| `BCON_CHAIN` | Blockchain for payments | No | Choose: ethereum, tron, binance, bitcoin, solana | Hosting env | prod | Matches Bcon store chain | Yes |
| `BCON_PAYMENT_CURRENCY` | Token ticker (USDT, USDC, BTC) | No | Bcon store currencies | Hosting env | prod | Must be enabled in Bcon store | Yes |
| `VIDEO_PROVIDER` | Video hosting provider | No | Choose: internal, uqload, bunny, etc. | Hosting env | prod | `internal` for fallback | Yes |
| `UQLOAD_API_KEY` | Uqload API key | No | https://uqload.vc → Account → API key | Hosting secrets | prod (if using) | Test via `GET /api/upload/server` | Yes |
| `UQLOAD_ADULT_CONTENT_APPROVED` | Flag confirming written approval for adult content on Uqload | No | Set to `true` only after written provider confirmation | Hosting env | prod | Must be `true` AND `UQLOAD_API_KEY` set for Uqload to be enabled | Yes |
| `GROQ_API_KEY` | Groq API key for metadata suggestions | No | https://console.groq.com → API Keys | Hosting secrets | prod (optional) | Test via `/api/groq/suggest` | Yes |
| `GROQ_MODEL` | Groq model name | No | Current docs, e.g., `llama-3.1-8b-instant` | Hosting env | prod (optional) | Check Groq docs | Yes |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `BCON_API_KEY`, `UQLOAD_API_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

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
- [ ] Advertiser sign-up at `/auth/sign-up` → verification email received via Resend → verify → sign in → lands on `/advertiser`
- [ ] Sign in with wrong password → error shown
- [ ] Sign out → session cleared, redirect to `/`
- [ ] Access `/admin` as unauthenticated → redirect to sign-in
- [ ] Access `/admin` as advertiser → redirect (403)
- [ ] Access `/advertiser` data of another advertiser via direct API call → denied by RLS
- [ ] Try to set `role=admin` from browser during sign-up → fails, role remains advertiser (check DB)

**Admin:**
- [ ] Admin sign-in → `/admin` dashboard shows real counts (no mock)
- [ ] Upload video at `/admin/videos/upload` → select file, title, category, rights=cleared → upload → check `/api/videos/status?videoId=...` → status moves from uploading → processing → pending_review
- [ ] Edit video metadata (if you implement edit UI) → changes persisted
- [ ] Publish video: set status=published, visibility=public, rights_status=cleared, moderation_status=approved, published_at=now → appears on public `/` and `/video/[slug]`
- [ ] Unpublish video → disappears from public sitemap and listings, watch page returns 404
- [ ] Category management at `/admin/categories` → list 12 fixed categories, add new category, prevent delete if videos reference it
- [ ] Ad slots at `/admin/ad-slots` → shows exactly 10 slots, no create/delete
- [ ] Advertisements at `/admin/advertisements` → review creative, approve/reject
- [ ] Campaigns at `/admin/campaigns` → list real campaigns
- [ ] Payments at `/admin/payments` → list real payments, no fake
- [ ] Reports at `/admin/reports` → list real reports, resolve
- [ ] Users at `/admin/users` → list real profiles
- [ ] Settings at `/admin/settings` → shows real site_settings
- [ ] Logs at `/admin/logs` → shows real audit_logs
- [ ] System health at `/admin/system-health` → shows real checks, Unknown if not configured, not hardcoded green

**Advertiser:**
- [ ] Slots at `/advertiser/slots` → shows 10 slots with real availability (checks active campaigns overlapping)
- [ ] Try to reserve same slot overlapping period as another advertiser → 409 conflict (concurrency-safe)
- [ ] Create campaign at `/advertiser/campaigns/new` → select slot, duration, destination URL, creative (16:9, JPG/PNG/WebP, <5MB) → submit → payment address returned
- [ ] Payment request creation at `/api/bcon/create` → verifies session, trusted price, prevents overlapping, creates pending invoice and unique external_id, returns address, amount, token, network
- [ ] Checkout UX: shows exact amount, USD equivalent, ticker, network, address, QR, copy button, expiration, pending status, instructions for correct network
- [ ] Simulate Bcon callback: `GET /api/bcon/callback?external_id=...&addr=...&txid=0x...&value=...&status=confirmed` → payment becomes confirmed, invoice paid, campaign pending_review or active if creative approved
- [ ] Duplicate callback with same txid → idempotent, no duplicate ledger entries
- [ ] Campaign approval: admin approves creative → campaign becomes active, appears on public site if slot active and schedule valid
- [ ] Billing history at `/advertiser/payments` → real payments, no fake
- [ ] Invoices at `/advertiser/invoices` → real invoices
- [ ] Campaign expiration: after end_date, campaign should not show on public site
- [ ] Profile at `/advertiser/profile` → real data, own only
- [ ] Support ticket at `/advertiser/support` → persisted, email sent if Resend configured

**Bcon:**
- [ ] Malformed callback (missing addr and external_id) → 400
- [ ] Duplicate callback → 200 already_processed, no duplicate
- [ ] Incorrect payment reference → 200 unknown_payment logged for admin review, not silently discarded
- [ ] Incorrect amount → status underpaid/overpaid, admin review
- [ ] Wrong network/token → admin review
- [ ] Delayed confirmation → remains awaiting_confirmation until confirmed
- [ ] Already processed transaction → idempotent

**Video hosting:**
- [ ] Provider adapter abstraction exists in `lib/video/provider.ts`
- [ ] Uqload adapter: `getUploadServer` and `uploadFile` use real API per docs
- [ ] Upload errors do not lead to false Published status — our code sets draft on failure
- [ ] Large file uploads not routed through Vercel Function that exceeds limit — we use provider direct upload server
- [ ] If Uqload disabled (adult content not approved), upload returns 503 with clear blocker message

**Email:**
- [ ] Resend domain verified (check Resend dashboard)
- [ ] Auth verification email sent via Resend
- [ ] Password reset email
- [ ] Campaign submission confirmation (if wired)
- [ ] Payment confirmation email (if wired)
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
- [ ] Private dashboard routes do not enter public sitemap (check sitemap does not contain /admin or /advertiser)
- [ ] Robots rules do not block required public content — `robots.txt` allows `/video/` and thumbnails, disallows `/admin/`, `/advertiser/`, `/api/`
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

**Payment callback issues:**
1. Check `payment_events` table for payloads
2. Check `audit_logs` for `bcon_callback_unknown_payment`
3. Manually confirm payment via SQL if verified on blockchain but callback failed:
```sql
update payments set status='confirmed', confirmed_at=now() where external_id='...';
update invoices set status='paid', paid_at=now() where number='...';
```

**Video hosting outage:**
1. Check provider status page
2. If Uqload blocked, switch `VIDEO_PROVIDER=internal` temporarily and document blocker
3. Existing published videos remain accessible if playable_url stored

---

## Unresolved Provider Approvals and Blockers

1. **Uqload adult content**: TOS prohibits pornography/nudity. Production uploads disabled unless `UQLOAD_ADULT_CONTENT_APPROVED=true` with written approval. This is a launch blocker — see `GO_LIVE_CHECKLIST.md`.
2. **Vercel Hobby**: Not suitable for commercial adult site. Hosting decision required — see `GO_LIVE_CHECKLIST.md`.
3. **Age assurance**: Frontend gate alone not robust. Legal review required for jurisdiction-specific verification.
4. **Legal identity**: Owner must provide real business details before publishing Terms/Privacy.
5. **Bcon wallet**: Owner must configure authorized receiving wallet and choose token/network.
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
```
