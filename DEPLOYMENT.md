# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

This document gives complete, verified steps to deploy Erobabe from zero to production. It covers Supabase, NOWPayments, video hosting, Gemini, Resend, GitHub, hosting, domain, env vars, testing, and rollback.

**Date**: October 10, 2026  
**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), NOWPayments, Resend, Gemini, internal video provider (Uqload blocked).

---

## A. Prerequisites

### Accounts needed
- Supabase account (https://supabase.com)
- NOWPayments account (https://nowpayments.io)
- Resend account (https://resend.com)
- Google AI Studio account for the Gemini API (https://aistudio.google.com)
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
5. **NOWPayments approval and payout wallet**: Owner must confirm in writing that NOWPayments permits this lawful adult-entertainment business and its advertising use, then configure the payout wallet/addresses and enable the accepted coins (e.g., USDT on Ethereum/Tron/BSC/Solana, BTC, ETH, TRX, BNB, SOL).

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
supabase secrets set RESEND_API_KEY=... GEMINI_API_KEY=... NOWPAYMENTS_API_KEY=...
```

### 9. Add production function secrets
In Supabase Dashboard → **Edge Functions** → **Secrets**, add:
- `RESEND_API_KEY`
- `GEMINI_API_KEY`
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
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

## C. NOWPayments Setup

Everything in this section follows NOWPayments' official documentation
(Payment API: https://nowpayments.io/api, IPN:
https://nowpayments.io/help/what-is/what-is-ipn) and the code in
`lib/nowpayments/`.

How the pieces fit:

- Checkout calls `POST https://api.nowpayments.io/v1/payment` with the
  `x-api-key` header and sends the payer the returned `pay_address` and
  `pay_amount`. The payment starts in the `waiting` status.
- Every payment carries this deployment's IPN URL
  (`https://YOUR_DOMAIN/api/nowpayments/ipn`). NOWPayments POSTs a signed
  JSON notification there on every status change.
- Only a verified `finished` status marks a payment paid. `confirmed` is an
  intermediate provider state and never fulfills anything on its own.

> **Approval blocker (unresolved):** before accepting real payments, confirm in
> writing that NOWPayments permits this lawful adult-entertainment business and
> its advertising use under the account's terms. API access alone is not proof
> of approval. Until that confirmation exists, payments are a launch blocker —
> see `GO_LIVE_CHECKLIST.md`.

### 1. Create or access a NOWPayments account

1. Go to https://nowpayments.io → **Sign Up** (or sign in).
2. Complete the account verification the dashboard asks for (KYC/business
   verification if required for your account type).
3. If you run a store/merchant profile, create one for Erobabe. You need a
   single profile — you do not need one per blockchain.

### 2. Obtain the API key

1. Sign in at https://nowpayments.io and open **Store Settings** (dashboard
   menu).
2. Find the **API key** section and generate/copy the key (dashboard labels it
   the store API key / `x-api-key` value).
3. Keep this value secret. It goes into `NOWPAYMENTS_API_KEY` (step 5) —
   server-side only, never a `NEXT_PUBLIC_*` variable.

### 3. Obtain the IPN Secret Key

1. In **Store Settings**, find the **IPN Secret Key** section and generate a
   secret (the dashboard offers a generate/copy control).
2. Copy it into `NOWPAYMENTS_IPN_SECRET` (step 5). Every incoming IPN is
   rejected unless its `x-nowpayments-sig` header verifies against this
   secret, so a missing or wrong value blocks all payment completions.
3. If you ever regenerate the secret, update the hosting environment variable
   at the same time and redeploy.

### 4. Enable the payout/accepted coins

1. In **Store Settings**, open the coins/currencies section and enable every
   asset the checkout offers (the app's fixed allowlist is `usdterc20`,
   `usdttrc20`, `usdtbsc`, `usdtsol`, `btc`, `eth`, `trx`, `bnbbsc`, `sol` —
   see Admin → System Health for the live availability check).
2. Configure the payout wallet/address the dashboard asks for, so settled
   funds have somewhere to go.
3. Payment creation fails with a clear provider error (surfaced in checkout
   and recorded on the payment) when a coin is not enabled — it never
   silently substitutes another asset or network.

### 5. Configure the production IPN callback URL

The application sends the callback URL with **every** payment
(`ipn_callback_url`), so there is no per-chain dashboard entry to maintain.
The URL is:

```text
https://YOUR_DOMAIN/api/nowpayments/ipn
```

On the current production deployment:

```text
https://erobabe.vercel.app/api/nowpayments/ipn
```

Rules:

- It must be an absolute HTTPS URL ending in `/api/nowpayments/ipn`.
- By default it is derived from `NEXT_PUBLIC_SITE_URL`. Set
  `NOWPAYMENTS_IPN_CALLBACK_URL` only to pin a different absolute URL; an
  invalid value is ignored with a warning in System Health.
- If the NOWPayments dashboard also offers a store-level IPN/default callback
  field, enter the same URL there for consistency.
- The endpoint is public by design (NOWPayments calls it server-to-server)
  and is excluded from the auth middleware. Reachability is necessary but not
  sufficient — every notification must also carry a valid signature.

### 6. Configure the matching Vercel environment variables

Vercel → Project → **Settings** → **Environment Variables** (Production, and
Preview if you test there):

| Variable | Value |
|---|---|
| `NOWPAYMENTS_API_KEY` | API key from step 2 |
| `NOWPAYMENTS_IPN_SECRET` | IPN Secret Key from step 3 |
| `NOWPAYMENTS_DEFAULT_PAY_CURRENCY` | `usdterc20` (must be one of the allowlist identifiers) |
| `NOWPAYMENTS_IPN_CALLBACK_URL` | Optional pin for the URL in step 5 |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, e.g. `https://erobabe.vercel.app` |

Redeploy after changing any of them. Then open Admin → System Health →
**NOWPayments — API & IPN configuration** and confirm: API key configured,
API reachable, IPN secret set, and the expected callback URL shown.

### 7. What the application does with an IPN

`/api/nowpayments/ipn` (POST) treats every notification as untrusted until:

1. The `x-nowpayments-sig` header verifies: the body is parsed as JSON, its
   top-level keys are sorted, and HMAC-SHA512 (hex) is computed with
   `NOWPAYMENTS_IPN_SECRET`, compared in constant time. Missing, malformed,
   or wrong signatures are rejected (401) and touch nothing.
2. The `payment_id` / `order_id` (our invoice number) resolves to a real
   payment row. Unknown references answer 200 as `unknown_payment` with an
   audit row — never retried, never applied.
3. The reported `pay_currency`, receiving address, and USD price match the
   stored payment. Mismatches are rejected and audited.
4. Terminal claims are corroborated with an authenticated
   `GET https://api.nowpayments.io/v1/payment/{payment_id}`. A `finished`
   claim the API does not confirm is recorded, never fulfilled.
5. The paid crypto amount (`actually_paid`, else `pay_amount`) is compared to
   the stored expected amount with integer math (2% tolerance). Under/over
   payments become `underpaid`/`overpaid` for human review — campaigns never
   activate on them.
6. Processing is idempotent: a repeated final IPN answers `already_processed`
   and cannot duplicate a confirmation, invoice payment, campaign activation,
   or business event; stale intermediate IPNs never overwrite a terminal
   state; a `refunded` IPN after completion moves the payment to `refunded`
   and pauses its campaigns.
7. HTTP semantics: 200 for processed/recorded notifications, 401 for bad
   signatures, 400 for invalid or mismatched payloads, 503 when NOWPayments
   (or the network) is transiently unreachable so the IPN is retried — and
   500 on database failure without claiming success.

Status mapping (internal `payments.status` keeps the lifecycle,
`provider_status` keeps the raw value):

| NOWPayments | Internal | Fulfills? |
|---|---|---|
| `waiting` | `awaiting_confirmation` | No |
| `confirming`, `confirmed`, `sending` | `partially_confirmed` | No |
| `partially_paid` | `underpaid` (manual review) | No |
| `finished` | `confirmed` (only after verification) | Yes |
| `failed` / `expired` | `failed` / `expired` | No |
| `refunded` | `refunded` | No (pauses campaigns) |

### 8. Test IPN reachability safely (no money, no payment records touched)

1. Admin → System Health → **NOWPayments** → **Test IPN reachability**:
   performs a real HTTPS GET of the IPN URL from the deployment and reports
   the status code. NOWPayments retries notifications that do not answer 200.
2. Or from any machine:

   ```bash
   curl -i https://erobabe.vercel.app/api/nowpayments/ipn
   ```

   Expect `HTTP/2 200` and
   `{"status":"ok","message":"NOWPayments IPN endpoint is reachable"}`.
3. Prove signatures are enforced (must NOT confirm anything):

   ```bash
   curl -i -X POST https://erobabe.vercel.app/api/nowpayments/ipn \
     -H 'Content-Type: application/json' \
     -d '{"payment_id":"123","payment_status":"finished"}'
   ```

   Expect HTTP 401 `{"status":"rejected",…}` and no new `payment_events` row.

### 9. Process a genuine test payment end to end

1. Sign in to the deployed site with a test advertiser account and create the
   smallest checkout you are willing to pay for (the current minimum is one
   $99 slot for one month — there is no fabricated sandbox amount).
2. The checkout shows the exact crypto amount, asset, network, and receiving
   address, and polls `/api/nowpayments/status` so the state updates without
   a page refresh. Send exactly that amount from your own wallet on the
   matching network; a different token or network will not confirm.
3. Wait for NOWPayments to process the payment to `finished`.
4. Expected result: NOWPayments POSTs the signed IPN → the route verifies the
   signature, correlates the payment, corroborates with the payment API, and
   verifies the amount → `payments.status = 'confirmed'` with `confirmed_at`
   set, the invoice becomes `paid`, `payment_events` gains `ipn_received`,
   `payment_verified`, and `confirmed`, and the campaign becomes `active`
   (creative approved) or `pending_review`.
5. Verify: Admin → System Health shows NOWPayments healthy, Admin → Logs
   shows `payment_confirmed`, and the advertiser's campaign page shows the
   activated campaign.
6. Send the same final IPN again (NOWPayments retries, or replay the exact
   signed body): expect `already_processed` and exactly one `confirmed` event.

### 10. Diagnose missing IPNs, unconfirmed payments, and wrong values

| Symptom | Where to look | What to do |
|---|---|---|
| System Health shows **Unreachable** | NOWPayments panel | `NOWPAYMENTS_API_KEY` missing/invalid or the API cannot be reached; the panel prints the message. |
| System Health shows **IPN secret missing** | Same panel | Set `NOWPAYMENTS_IPN_SECRET` — every IPN is rejected until then. |
| Payment stays `awaiting_confirmation` after a real payment | `payment_events` and `audit_logs` for that payment | `ipn_received` = NOWPayments reached us. `verification_pending` + HTTP 503 = the payment API was unreachable, NOWPayments retries. `verification_failed` / `nowpayments_ipn_unverified` = the API does not report that payment id. `amount_unverified` / `amount_mismatch` = amount evidence missing or mismatched (`underpaid`/`overpaid`). |
| `unknown_payment` | `audit_logs.action = 'nowpayments_ipn_unknown_payment'` | The IPN matched no `payment_id`/`order_id` — usually a notification for another store or a stale replay. |
| Signature rejections | Server logs (`NOWPayments IPN rejected`) | The IPN secret on the server does not match the dashboard value, or the body was altered in transit. |
| Nothing arrives at all | NOWPayments dashboard payment page | NOWPayments never sent the IPN: check the payment exists, its status, and that the `ipn_callback_url` on it is this deployment's URL. Confirm reachability with step 8. |
| Currency errors at checkout | Checkout error + payment `creation_failed` event | The `pay_currency` is not enabled for the account — enable the coin (step 4) or pick another asset. |

Never mark a payment `confirmed` by hand unless you independently verified the
payment in NOWPayments (`GET /v1/payment/{payment_id}` with the API key
shows `finished` for that address and amount) — see "Rollback and recovery".

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
   - `POST https://sX.myvideo.com/upload/01` with FormData **in this order**: `key`, `file_title`, `file_descr`, `tags`, `file_public=1`, `file_adult=1`, then `file`, then `snapshot` (thumbnail) last. ⚠️ Uqload ignores every multipart field sent **after** `file`, so a `file_title` appended behind the file is dropped and the stored title falls back to the file name (`my trip.mp4` → `My_Trip`).
   - Response: `{ status:200, files:[{ filecode, filename, status }] }`
   - `GET https://uqload.vc/api/file/list?key=...&per_page=50` → account library; used to confirm a just-sent upload by **diffing file codes against a pre-upload snapshot** (one request per poll). Do not filter by `title`: it is a literal substring match on the stored title and can never find a file whose stored title is unknown.
   - `GET https://uqload.vc/api/file/info?key=...&file_code=...` → check processing status, thumbnail
4. **Upload path — how large files get in**: Vercel functions reject any request body above **4.5 MB** with a plain-text `413 Request Entity Too Large`. Posting a video to one of our own routes therefore cannot work, and used to surface in the admin UI as `Unexpected token 'R', "Request En"... is not valid JSON`. The current flow keeps `UQLOAD_API_KEY` server-only and never sends a large body through a function:

   1. `POST /api/videos/storage-token` (admin, JSON, `kind: "thumbnail"`) returns a short-lived Supabase **signed upload URL** for a public `video-thumbnails` object. Video bytes must not be posted there — the route answers `410` and points at the Uqload session route instead.
   2. The browser `PUT`s the thumbnail straight to Supabase Storage with `XMLHttpRequest`.
   3. `POST /api/videos/uqload-session` returns the Uqload upload-server URL plus its form fields (`key`, `file_public=1`, `file_adult=1`) so the browser can POST the video bytes **directly to Uqload** (a CORS "simple request" — no custom headers, no `xhr.upload` listeners, `withCredentials=false`; adding any of those forces a preflight Uqload never answers and cancels the upload before a single byte is sent).
   4. `POST /api/videos/uqload-confirm` (`mode: "snapshot"`) snapshots the account's file codes **before** the bytes leave; the browser then re-sends `{ fileTitle, fileName, knownFileCodes, finalAttempt }` until a new code appears (backoff polling, one `file/list` per poll). The title only ranks several new files — the diff identifies the upload, because Uqload's stored title is derived from the file name and never matches a cleaned title.
   5. The browser posts only `{ providerFileId, thumbnailPath, categoryId, fileName }` to `POST /api/videos/upload` (a few hundred bytes). That route generates Gemini metadata and creates the video record.
   6. If the confirmation window closes before the file appears, the admin UI shows **Re-check library** — it re-runs the same diff against the stored snapshot instead of re-uploading the bytes.

   Do not move `UQLOAD_API_KEY` into browser code merely to shorten this path.
5. **Thumbnail behavior**: Each video has its own thumbnail picker — including every iframe embed and every remote link, not just local files. A custom thumbnail is stored in the public `video-thumbnails` bucket; Uqload's `player_img` is used as a fallback once it is available.
6. **Processing status**: A publish click makes the video public immediately. `canplay=1` lets `/api/videos/status` refresh duration/player details and mark its upload job complete.

### If using replacement provider

1. Implement new class in `lib/video/provider.ts` that implements `VideoProvider` interface
2. Update `getVideoProvider()` factory
3. Set `VIDEO_PROVIDER=bunny` (or chosen name) and set its API keys
4. Ensure embed/playable URLs are returned correctly and are not blocked by robots.txt
5. Test: upload via `/admin/videos/upload`, check status via `/api/videos/status`, verify playback on `/video/[slug]`

### Supabase Storage

1. Go to **Storage** → **New bucket** → `ad-creatives` (public, for advertiser creatives)
2. Create bucket `video-thumbnails` (public, for admin-selected video thumbnails). `lib/video/storage.ts` also creates it on first use so a missed migration does not block thumbnail uploads.
3. Optionally create bucket `videos` (private, only if you later implement an internal provider)
4. Set policies: allow authenticated advertisers to upload/delete only within their own `ad-creatives/<user-id>/` folder; public read is needed for creative and thumbnail display.

> **Legacy**: `video-incoming` (from migration `00000000000004_video_transit_storage.sql`) belonged to the abandoned Supabase-transit flow — video bytes now go straight from the browser to Uqload, so the bucket is no longer used. On Supabase projects with a 50 MB global file limit the migration's 2 GB bucket insert can fail; skip/ignore that bucket and do not upload video bytes to Supabase.
6. The campaign and publisher flows now fail clearly if their required bucket is missing. Verify both bucket names before accepting uploads.

---

## E. Gemini API Setup

Docs: https://ai.google.dev/gemini-api/docs/generate-content —
SDK: https://googleapis.github.io/js-genai/ — code: `lib/gemini/`,
route: `/api/gemini/suggest`.

1. Go to https://aistudio.google.com/apikey → **Create API key** (a Google
   Cloud project may be required — follow the current AI Studio flow).
2. Copy the key — this is `GEMINI_API_KEY` (server-only, never expose to the
   browser, never a `NEXT_PUBLIC_*` variable).
3. Set env: `GEMINI_API_KEY=<key>`, `GEMINI_MODEL=gemini-flash-latest` (or
   another currently supported low-latency text model per the docs above).
4. In Vercel → Project → **Settings** → **Environment Variables**, set both
   for Production (and Preview if you test there), then redeploy.
5. Test: go to `/admin/videos/upload`, choose a category and source, then
   publish. The server must generate title, description, and tags with Gemini
   before it creates the video record. Alternatively POST to
   `/api/gemini/suggest` as an admin with `{ "fileName": "clip.mp4" }` and
   expect a `{ suggestion, note }` response.
6. Optional tuning: `GEMINI_MAX_OUTPUT_TOKENS` (default `2048`) is the
   per-suggestion output budget — thinking tokens are counted against it, so
   keep it well above the ~150 tokens the JSON payload needs.
   `GEMINI_THINKING_BUDGET` (default `0`) turns thinking off so the whole
   budget goes to the JSON; set it to `off` to send no thinking config at all
   for models that reject the field.
7. Gemini is an enhancement, not a gate. If it is not configured, returns
   malformed output, or hits quota, the upload still completes: the video is
   created with deterministic metadata built from the file name and category
   (`/api/videos/upload*` answers with `metadataSource: "fallback"` and a
   `metadataWarning`, and the admin UI flags the item for review). The
   `/api/gemini/suggest` endpoint still answers 503/502/429 with an actionable
   message so the AI path can be diagnosed. Title, description, and tags are
   intentionally not browser-editable in this workflow.
8. **Important**: Never send video bytes, private rights docs, payment
   records, or personal info to Gemini. Only the source filename/URL path,
   working title, selected category, and existing tags are sent for metadata
   generation. AI output is not proof of rights, age, consent, or factual
   attributes, and suggestions require human review.
9. Diagnose: `GEMINI_API_KEY` missing → 503 "not configured"; wrong key →
   503; quota/rate limit → 429; malformed model output → 502. The key never
   appears in responses, logs, or client bundles (verified in CI by the
   client-bundle secret check).
10. "Gemini returned malformed JSON" means the model's text could not be parsed
    even after the built-in clean-up (markdown fences, prose around the
    payload, raw newlines inside strings, smart quotes, trailing commas, and
    truncated output are all handled) and a retry. Check the model in
    `GEMINI_MODEL` supports structured output, raise
    `GEMINI_MAX_OUTPUT_TOKENS`, and retry. Uploads are unaffected — they fall
    back to file-name metadata.

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
   - Payment confirmation — requires a real verified NOWPayments `finished` payment (see section C.9); an unsigned or hand-made IPN never confirms a payment, so use a genuine (smallest) payment or the automated tests instead
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
fly secrets set NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... NOWPAYMENTS_API_KEY=... NOWPAYMENTS_IPN_SECRET=... etc
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
6. **Callback endpoints**: `https://YOUR_DOMAIN/api/nowpayments/ipn` must be reachable via HTTPS and must answer HTTP 200 to a parameter-less GET (NOWPayments retries notifications that do not answer 200). It is public by design and excluded from the auth middleware, and every payment sends this URL as its `ipn_callback_url` — see section C.5.
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
| `NOWPAYMENTS_API_KEY` | NOWPayments API key (`x-api-key`) | No | NOWPayments Dashboard → Store Settings → API key | Hosting secrets | prod | Admin → System Health → NOWPayments panel shows API reachable; also used by `/api/nowpayments/create` and IPN corroboration | Yes |
| `NOWPAYMENTS_IPN_CALLBACK_URL` | Optional pin for the IPN callback URL the app sends with every payment (must be an absolute URL ending in `/api/nowpayments/ipn`) | No | Your domain | Hosting env | prod (optional) | Admin → System Health shows `URL source`: `NOWPAYMENTS_IPN_CALLBACK_URL`; an invalid value is reported as a config warning and ignored | Yes |
| `NOWPAYMENTS_DEFAULT_PAY_CURRENCY` | Default NOWPayments asset identifier | No | One of: usdterc20, usdttrc20, usdtbsc, usdtsol, btc, eth, trx, bnbbsc, sol | Hosting env | prod | Must be enabled in the NOWPayments dashboard; checkout validates every selection server-side | Yes |
| `NOWPAYMENTS_IPN_SECRET` | IPN Secret Key for `x-nowpayments-sig` verification | No | NOWPayments Dashboard → Store Settings → IPN Secret Key | Hosting secrets | prod | Admin → System Health shows IPN secret set; every IPN is rejected without it | Yes |
| `VIDEO_PROVIDER` | Video hosting provider | No | Choose: internal, uqload, bunny, etc. | Hosting env | prod | `internal` for fallback | Yes |
| `UQLOAD_API_KEY` | Uqload API key | No | https://uqload.vc → Account → API key | Hosting secrets | prod (if using) | Test via `GET /api/upload/server` | Yes |
| `UQLOAD_ADULT_CONTENT_APPROVED` | Flag confirming written approval for adult content on Uqload | No | Set to `true` only after written provider confirmation | Hosting env | prod | Must be `true` AND `UQLOAD_API_KEY` set for Uqload to be enabled | Yes |
| `GEMINI_API_KEY` | Gemini API key for metadata suggestions | No | https://aistudio.google.com/apikey → Create API key | Hosting secrets | prod (optional) | Test via `/api/gemini/suggest` as admin | Yes |
| `GEMINI_MODEL` | Gemini model name | No | Current docs, e.g., `gemini-flash-latest` | Hosting env | prod (optional) | Check https://ai.google.dev/gemini-api/docs for supported models | Yes |
| `GEMINI_MAX_OUTPUT_TOKENS` | Output-token budget for one metadata suggestion | No | `2048` (default); thinking tokens count against it | Hosting env | prod (optional) | Raise it if suggestions are truncated | Yes |
| `GEMINI_THINKING_BUDGET` | Thinking budget sent with each suggestion | No | `0` (default, thinking off) or `off` to omit the field | Hosting env | prod (optional) | Set `off` for models that reject `thinkingBudget` | Yes |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `UQLOAD_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

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
- [ ] Video publisher at `/admin/videos/upload` → upload multiple local files, paste a public iframe source, or import one or more public direct-video URLs to Uqload
- [ ] Choose only a category and optional thumbnail; title, description, and tags are generated server-side by Gemini (`/api/gemini/suggest` contract: title, description, tags, category) before publishing
- [ ] Publish action sets status=published, visibility=public, rights_status=cleared, moderation_status=approved, published_at=now → appears on public `/` and `/video/[slug]` (Uqload can still be encoding)
- [ ] Category management at `/admin/categories` → list categories, add new category, and edit label/slug/description/icon
- [ ] Ad slots at `/admin/ad-slots` → shows exactly 10 slots, no create/delete
- [ ] Advertisements at `/admin/advertisements` → review creative, approve/reject
- [ ] Campaigns at `/admin/campaigns` → list real campaigns
- [ ] Payments at `/admin/payments` → list real payments, no fake
- [ ] Reports at `/admin/reports` → list real reports, resolve
- [ ] Users at `/admin/users` → list real profiles
- [ ] Logs at `/admin/logs` → shows real audit_logs
- [ ] System health at `/admin/system-health` → shows real checks, Unknown if not configured, not hardcoded green

**Advertiser:**
- [ ] Slots at `/advertiser/slots` → shows 10 slots with real availability (checks active campaigns overlapping)
- [ ] Try to reserve same slot overlapping period as another advertiser → 409 conflict (concurrency-safe)
- [ ] Create campaign at `/advertiser/campaigns/new` → select one or multiple available slots, duration, destination URL, creative (JPG/PNG/GIF, ≤10 MB) → submit → one payment address returned for the selected slots
- [ ] Payment request creation at `/api/nowpayments/create` → verifies session, trusted slot price, validates the asset/network against the server allowlist, prevents overlapping, creates the local payment + pending invoice, then creates the NOWPayments payment (`POST /v1/payment`) and returns address, crypto amount, asset, and network
- [ ] Checkout UX: shows exact crypto amount, USD equivalent, asset, network, address, copy button, expiration, live status (polls `/api/nowpayments/status`, no page refresh needed), instructions for correct network
- [ ] IPN reachability probe: `curl -i https://YOUR_DOMAIN/api/nowpayments/ipn` → HTTP 200 `{"status":"ok",…}` and no row written to `payments` / `payment_events`
- [ ] Synthetic confirmation attempt (must NOT confirm): unsigned `POST /api/nowpayments/ipn` with `{"payment_id":"<real id>","payment_status":"finished"}` → HTTP 401, payment stays `awaiting_confirmation`, nothing written. Only a correctly signed IPN corroborated by `GET /v1/payment/{id}` as `finished` with a matching amount can move a payment to `confirmed`.
- [ ] Genuine payment (real funds, smallest checkout): signed NOWPayments IPN arrives → payment `confirmed`, invoice paid, campaign `pending_review` or `active` if the creative is approved
- [ ] Duplicate final IPN → `already_processed`, no duplicate ledger entries; exactly one `confirmed` event
- [ ] Campaign approval: admin approves creative → campaign becomes active, appears on public site if slot active and schedule valid
- [ ] Billing history at `/advertiser/payments` → real payments, no fake
- [ ] Invoices at `/advertiser/invoices` → real invoices
- [ ] Campaign expiration: after end_date, campaign should not show on public site
- [ ] Profile at `/advertiser/profile` → real data, own only
- [ ] Support ticket at `/advertiser/support` → persisted, email sent if Resend configured

**NOWPayments IPN:**
- [ ] Empty/parameter-less probe → 200 `{"status":"ok"}`, nothing written
- [ ] Missing signature → 401, nothing written; malformed signature → 401
- [ ] Tampered body with a stale signature → 401, payment untouched
- [ ] Malformed JSON body → 401
- [ ] Missing `NOWPAYMENTS_IPN_SECRET` on the server → 503 (fails closed), payment untouched
- [ ] Unknown payment id/order reference → 200 `unknown_payment`, audit row written, not silently discarded
- [ ] `finished` claim the payment API does not corroborate → recorded, never fulfilled
- [ ] Intermediate statuses (`waiting`/`confirming`/`confirmed`/`sending`) → recorded as `awaiting_confirmation`/`partially_confirmed`, never paid — including provider `confirmed`
- [ ] `partially_paid` → `underpaid` for manual review, campaigns not activated
- [ ] Amount mismatch on a finished payment → `underpaid`/`overpaid`, not confirmed, audit row
- [ ] Wrong order reference, pay currency, address, or USD price → rejected with the matching audit action
- [ ] `failed`/`expired` → payment + invoice updated, pending campaigns cancelled
- [ ] `refunded` after completion → payment `refunded`, invoice `refunded`, campaigns paused
- [ ] Payment API unreachable during verification → HTTP 503 (NOWPayments retries), payment untouched
- [ ] Repeated final IPN → `already_processed`, `confirmed` event exists exactly once
- [ ] Out-of-order/stale intermediate after completion → ignored, terminal state kept
- [ ] No API key, IPN secret, or wallet material appears in `payment_events`, `audit_logs`, or server logs
- [ ] No API key, secret or wallet material appears in `payment_events`, `audit_logs` or server logs

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
1. Check `payment_events` for the payment (`ipn_received`, `verification_failed`, `verification_pending`, `amount_mismatch`, `payment_verified`, `confirmed`).
2. Check `audit_logs` for `nowpayments_ipn_unknown_payment`, `nowpayments_ipn_unverified`,
   `nowpayments_ipn_order_mismatch`, `nowpayments_ipn_currency_mismatch`,
   `nowpayments_ipn_address_mismatch`, `nowpayments_ipn_price_mismatch`,
   `nowpayments_ipn_amount_unverified`, `nowpayments_ipn_underpaid`, `nowpayments_ipn_overpaid`,
   `nowpayments_ipn_partially_paid`.
3. Use Admin → System Health → NOWPayments → **Test IPN reachability** to prove the URL answers 200.
4. Only if NOWPayments itself reports the payment as `finished`
   (`GET https://api.nowpayments.io/v1/payment/<payment_id>` with `NOWPAYMENTS_API_KEY`,
   same address and amount),
   reconcile manually:
```sql
update payments set status='confirmed', provider_status='finished', confirmed_at=now() where provider_payment_id='...';
update invoices set status='paid', paid_at=now() where number='...';
```
   Record the reconciliation in `audit_logs` (action `payment_confirmed_manually`) — never
   flip a payment to `confirmed` without that evidence.

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
5. **NOWPayments approval and wallet**: Owner must obtain written confirmation that NOWPayments permits this adult-entertainment business and its advertising use, then configure the payout wallet and enable the accepted coins.
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
