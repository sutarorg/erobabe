# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

This document gives complete, verified steps to deploy Erobabe from zero to production. It covers Supabase, NOWPayments, video hosting, Gemini, Resend, GitHub, hosting, domain, env vars, testing, and rollback.

**Date**: October 12, 2026  
**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), NOWPayments, Resend, Gemini, direct MP4 URL video publishing, Tailwind CSS 4.

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
1. **Video hosting provider**: Streamtape's Terms (https://streamtape.com/terms-and-conditions) neither permit nor ban lawful adult content explicitly, so the owner MUST verify the terms, copyright policy and account content settings (and ideally get Streamtape's written answer) before setting `STREAMTAPE_ADULT_CONTENT_ALLOWED=true`. The upload relay (`relay/streamtape-relay.mjs`) must also be deployed on an always-on Node host. Without both, production video hosting is BLOCKED. See section D.
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
- `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY`, `STREAMTAPE_RELAY_SECRET` (server-only; see the policy gate in section D)
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

## D. Video Hosting — Direct MP4 URLs

### How it works

Videos are published by pasting direct MP4 URLs into the admin panel
(`/admin/videos/upload`). Erobabe saves the URL in `videos.playable_url` and
the browser plays the video straight from the original host. No video bytes
are downloaded, transferred, re-encoded, or stored by Erobabe.

- **Provider:** `direct_url` (the default — no `VIDEO_PROVIDER` variable needed)
- **Playback:** Native `<video>` element with `playable_url`
- **Thumbnail:** Uploaded to Supabase Storage (signed upload URL)
- **Metadata:** Generated by Gemini AI (with file-name fallback)
- **No hosting-provider API, relay, or credentials needed**

### Setup steps

1. Run the database migration `supabase/migrations/00000000000008_direct_video_urls.sql`
   (forward-only; adds `direct_url` to the allowed provider values).
   Older migrations are untouched; legacy rows keep playing from their stored URLs.
2. Open Admin → **System Health**: *Video Provider* should read `direct_url`.
3. Open `/admin/videos/upload`, choose a category, paste a direct `.mp4` URL,
   and press **Generate AI metadata & publish**. The video should appear
   immediately with Gemini-generated metadata (or file-name fallback).
4. Open `/video/[slug]` and confirm playback, seeking, and error handling.

### Thumbnails

Each video has its own thumbnail picker. A custom thumbnail is uploaded to the
public `video-thumbnails` bucket through the existing signed-upload flow
(`POST /api/videos/storage-token` → browser `PUT`).

### Legacy videos

Existing videos from Streamtape, UFOLOAD, Uqload, and embed-only records are
**not affected**. Their stored `playable_url` and `embed_url` values are
preserved and the public player continues to render them correctly.

### Historical: retired Streamtape integration

The Streamtape integration (upload relay, session endpoints, conversion polling)
was removed in October 2026 and replaced with direct MP4 URL publishing. See
`docs/STREAMTAPE_MIGRATION.md` for the historical record. Legacy rows with
`provider='streamtape'`, `'ufoload'`, or `'uqload'` keep their stored playback
data and remain viewable without contacting the retired APIs.

### Active provider: Streamtape (UFOLOAD is retired)

Videos are uploaded **browser → streaming relay → Streamtape upload node**. The
bytes never pass through a Vercel/Next.js function (request bodies above 4.5 MB
are rejected) and never touch Supabase Storage. Supabase only stores thumbnails
(existing signed-upload route) and metadata.

Why a relay instead of a direct browser upload: Streamtape documents
`GET /file/ul` → multipart `POST` to the returned node URL, but does **not**
document the node's CORS behaviour, response body, or limits, and none of that
could be proven from the build environment (see `docs/STREAMTAPE_MIGRATION.md`
§2–§3). A browser can only read the node's reply if the node sends CORS headers,
so the relay removes that unknown instead of shipping a guess. If the live suite
and the browser acceptance spec later prove direct upload works, the relay can be
dropped without touching the data model.

Official documentation used by the implementation (fetched 2026-10-12):

- API reference: https://streamtape.com/api
- Terms: https://streamtape.com/terms-and-conditions · Copyright: https://streamtape.com/copyright
- Credentials: https://streamtape.com/accpanel → *Account Settings*

### Policy gate — owner verification is a launch blocker

Streamtape's Terms prohibit sexual content involving minors and any content that
violates third-party rights, require you to hold the rights/consent for what you
publish, and reserve the right to remove content at any time. They contain **no
explicit clause permitting or banning lawful adult content**, so being able to
generate an API key does not mean your use is permitted.

**Before enabling production uploads, the owner must:**

1. Read the current Terms and Copyright Policy and, if in doubt, ask Streamtape
   support in writing whether lawful adult content, commercial use, API uploads
   and embedded playback are permitted for this account; keep the answer on file.
2. Check the account panel for content/embedding settings that apply to the account.
3. Confirm rights, consent and age documentation for the catalog.
4. Only then set `STREAMTAPE_ADULT_CONTENT_ALLOWED=true`.

**Fail-closed gate.** While `STREAMTAPE_ADULT_CONTENT_ALLOWED` is anything other
than `"true"` — or credentials are missing — every upload/import route answers
`503` with an actionable message naming the variable, and nothing is sent to
Streamtape. `VIDEO_PROVIDER` accepts only `streamtape` and `internal` (embeds
only); `ufoload`, `uqload` and any typo throw a configuration error instead of
falling back.

### Setup steps

1. Create/sign in to the Streamtape account.
2. User Panel → **Account Settings** → copy **API Login** and **API Key/Password**.
   Keep them server-side. Optionally create a folder in the file manager and note
   its id for `STREAMTAPE_FOLDER_ID`.
3. Verify the account's real per-file size limit (not stated in the API docs; a
   2021 community README claims 15 GB) and set `STREAMTAPE_MAX_UPLOAD_BYTES`
   accordingly. The app enforces this limit before any bytes move.
4. **Deploy the relay** (`relay/streamtape-relay.mjs`, zero dependencies, Node ≥ 18):
   ```bash
   STREAMTAPE_RELAY_SECRET=<same random >=16 chars as the app> \
   STREAMTAPE_RELAY_ALLOWED_ORIGINS=https://erobabe.com \
   RELAY_PORT=8787 node relay/streamtape-relay.mjs
   ```
   Requirements: an always-on host (VPS, Docker, Fly.io, Railway, Cloud Run with
   request timeout ≥ the longest upload, …) with **HTTPS in front**; it must **not**
   run as a Vercel/serverless function. It holds no Streamtape credentials — it only
   accepts HMAC-signed, expiring, single-use tokens minted by the app, and refuses
   upload hosts outside `tapecontent.net`/`streamtape.com`
   (`STREAMTAPE_UPLOAD_HOST_SUFFIXES` extends the list). Run **one instance** (the
   single-use cache is in memory) or replace `makeUsedTracker` with a shared store.
   Health check: `GET /health`.
5. Set the app's environment variables (see `.env.example`):
   - `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY` — **server-only**; never `NEXT_PUBLIC_*`,
     never in a browser response, commit, log or audit row.
   - `STREAMTAPE_FOLDER_ID` (optional), `STREAMTAPE_MAX_UPLOAD_BYTES` (recommended).
   - `STREAMTAPE_ADULT_CONTENT_ALLOWED=true` — only after the owner verification above.
   - `STREAMTAPE_RELAY_URL`, `STREAMTAPE_RELAY_SECRET`.
   - `VIDEO_PROVIDER=streamtape`.
6. Run the database migration `supabase/migrations/00000000000007_streamtape_video_provider.sql`
   (forward-only; allows `streamtape`, defaults new jobs to it, adds a processing
   index). Older migrations are untouched; historical `ufoload`/`uqload` rows keep
   playing from their stored URLs and are never contacted.
7. Open Admin → **System Health**: *Video Provider* must read `streamtape · API
   reachable` (it performs a real `GET /account/info`). Any other state names
   what is missing; an environment flag alone is never reported as healthy.
8. Upload one real test video from `/admin/videos/upload` and follow
   `GO_LIVE_CHECKLIST.md` section D.

**Rotating credentials.** Generate new credentials in the Streamtape panel, update
`STREAMTAPE_LOGIN`/`STREAMTAPE_API_KEY` in the hosting secrets, redeploy, run System
Health. To rotate the relay secret, change `STREAMTAPE_RELAY_SECRET` in the relay
and the app **together** (in-flight sessions become invalid; admins just restart them).

### Endpoints the code calls (verified against https://streamtape.com/api, 2026-10-12)

Base `https://api.streamtape.com`, HTTPS only, `login` + `key` query parameters,
envelope `{status, msg, result}` (the envelope `status` — not the HTTP status — decides
success: 200 OK · 400 · 403 · 404 · 451 legal · 509 bandwidth · 50x).

| Purpose | Request |
| --- | --- |
| Health check | `GET /account/info` |
| Upload URL | `GET /file/ul[?folder=]` → `result {url, valid_until}` (upload node, e.g. `https://tapecontent.net/xfsupload/…`) |
| Send bytes | `POST` multipart/form-data to that URL (field `file1` per the docs' curl example) — via the relay |
| File state | `GET /file/info?file={id}` → `result {id: {id,name,size,type,converted,status}}` |
| Folder listing | `GET /file/listfolder[?folder=]` → `{folders, files:[{name,size,linkid,created_at,convert,…}]}` |
| Conversion queues | `GET /file/runningconverts` (`status new\|pending`, `progress` 0–1) · `GET /file/failedconverts` (`status error`) |
| Thumbnail | `GET /file/getsplash?file={id}` → URL string |
| Rename / delete | `GET /file/rename` · `GET /file/delete` |
| Remote upload | `GET /remotedl/add?url&name&folder` → `{id, folderid}` · `GET /remotedl/status?id` → `{id: {status,bytes_loaded,bytes_total,extid,url,…}}` · `GET /remotedl/remove?id` (never `all`) |
| Playback | iframe `https://streamtape.com/e/{fileId}` (stable; download links are ticketed/expiring and are never stored) |

Not documented by Streamtape — and therefore **unverified until the live suite runs**:
the upload node's response body, its multipart field-name tolerance, its CORS
behaviour, the full `remotedl/status` status vocabulary, per-file/concurrency limits.
The code never trusts a file id parsed from the node reply: it is confirmed with
`/file/info` (name + size) or resolved from an unambiguous, unclaimed
`/file/listfolder` match; otherwise the row stays private and `processing`.

### Upload path — how files get in

1. `POST /api/videos/streamtape-session` (admin, JSON) validates name/size/limit,
   calls `GET /file/ul`, stores an `upload_jobs` row, and returns
   `{ uploadUrl: "{STREAMTAPE_RELAY_URL}/upload/{signed-token}", uploadId, jobId }`.
   The token carries the node URL, session id and expiry (≤ 30 min) — the API
   credentials never leave the server.
2. The browser sends one multipart `POST` (XHR: measured byte progress; abort =
   real cancel) to the relay, which streams it to the node and passes the node's
   reply back verbatim. Streamtape documents no chunk/resume protocol, so an
   interrupted upload is restarted, not resumed.
3. `POST /api/videos/upload` posts the *session* id (and the node reply for
   server-side verification — never a file id the server must believe), confirms
   the file, generates/reuses Gemini metadata and creates the video row **private**.
4. The admin page polls `GET /api/videos/status?jobId=…`; the server checks
   `/file/info`, `/file/runningconverts` and `/file/failedconverts` and publishes
   only when the file is **converted**.
5. Cancel aborts the XHR (the relay aborts upstream) and calls
   `POST /api/videos/streamtape-cancel`, which marks the job cancelled, makes the
   row private and — for imports — calls `remotedl/remove?id=<task>`.

`/api/videos/upload-url` starts a **remote upload** (`remotedl/add`): it answers
`queued` (never `published`), stores the task id in `upload_jobs.provider_import_id`,
and `/api/videos/status` follows the task, then the created file, then conversion.
Only public http(s) URLs are accepted (no localhost/private ranges/credentials).

### Thumbnails

Each video — local file, iframe embed or remote URL — has its own thumbnail
picker. A custom thumbnail is uploaded to the public `video-thumbnails` bucket
through the existing signed-upload flow (`POST /api/videos/storage-token` →
browser `PUT`). When none is chosen, Streamtape's splash image
(`/file/getsplash`) is stored once the file is converted.

> `POST /api/videos/storage-token` answers `410` for `kind: "video"`: video bytes
> must not transit Supabase or a function body.

### Readiness rules

- A video is published only when `/file/info` reports `converted: true` with entry
  status 200. `new`/`pending`/not-listed rows stay private; a `failedconverts`
  entry, a 451 or a vanished remote task mark the row failed with the reason in
  `videos.provider_error`, and it stays private.
- `provider_progress` mirrors `runningconverts.progress`.
- A provider outage is reported as a note in the status response — never a 500, and it never publishes anything.
- The public page additionally requires `status=published`, `visibility=public`,
  `rights_status=cleared`, `moderation_status=approved`.

### Legacy UFOLOAD / Uqload videos

Rows with `provider='ufoload'` or `'uqload'` are left exactly as they are: stored
`embed_url`/`playable_url` keep rendering; `/api/videos/status` answers them as
history and contacts no retired API. Posters under `ufoload.com` remain allowed in
`next.config.mjs`. They are never relabelled as Streamtape.

### Supabase Storage

1. Go to **Storage** → **New bucket** → `ad-creatives` (public, for advertiser creatives)
2. Create bucket `video-thumbnails` (public, for admin-selected video thumbnails). `lib/video/storage.ts` also creates it on first use so a missed migration does not block thumbnail uploads.
3. Optionally create bucket `videos` (private, only if you later implement an internal provider)
4. Set policies: allow authenticated advertisers to upload/delete only within their own `ad-creatives/<user-id>/` folder; public read is needed for creative and thumbnail display.

> **Legacy**: `video-incoming` (from migration `00000000000004_video_transit_storage.sql`) is only used as a short-lived transit area if an older deployment still routes bytes there — video bytes now go through the streaming relay to Streamtape, so the bucket is not needed. On Supabase projects with a 50 MB global file limit the migration's 2 GB bucket insert can fail; skip/ignore that bucket and do not upload video bytes to Supabase.
6. The campaign and publisher flows now fail clearly if their required bucket is missing. Verify both bucket names before accepting uploads.

---

## D2. Video admin tools (migration 00000000000010)

Apply `supabase/migrations/00000000000010_admin_video_tools.sql` before deploying
this release. It adds:

- `videos.carousel_position` (1–3): the three homepage hero cards, managed from
  **/admin/videos → Homepage carousel**. If no slot is filled, the homepage shows
  the default artwork.
- `videos.source_key` and an index: used by the duplicate-upload detector.

**Automatic frame thumbnails.** When a direct-link video is published without a
thumbnail, the server captures a frame with a bundled ffmpeg
(`@ffmpeg-installer/ffmpeg`, linux-x64 binary, ~68 MB) and stores a 1280×720
JPEG in the `video-thumbnails` bucket. The binary is included in the
`/api/videos/upload-url` and `/api/admin/videos/thumbnails` functions via
`outputFileTracingIncludes` in `next.config.mjs`. Set `FFMPEG_PATH` to use another
binary. Embed (player-page) links cannot be framed; add those thumbnails by hand.
Existing videos can be filled in from /admin/videos (“Generate thumb” or bulk
“Generate thumbnails”).

**Duplicate uploads.** Publishing skips a link that matches an existing video
(same host and path, ignoring query strings), or one with the same file name on
another host. The upload page shows the match; tick “Publish anyway” to add it.

---

## E. Gemini API Setup

Docs: https://ai.google.dev/gemini-api/docs/generate-content —
SDK: https://googleapis.github.io/js-genai/ — code: `lib/gemini/`,
route: `/api/gemini/suggest`.

1. Go to https://aistudio.google.com/apikey → **Create API key** (a Google
   Cloud project may be required — follow the current AI Studio flow).
2. Copy the key — this is `GEMINI_API_KEY` (server-only, never expose to the
   browser, never a `NEXT_PUBLIC_*` variable). New keys are issued as
   **Authorization keys starting with `AQ.`**; they are supported here the same
   as the older `AIza` traffic keys (`GOOGLE_API_KEY` and
   `GOOGLE_GENAI_API_KEY` are accepted as fallbacks for the same value).
3. Set env: `GEMINI_API_KEY=<key>`, `GEMINI_MODEL=gemini-flash-latest` (or
   another currently supported low-latency text model per the docs above).
   Optional: `GEMINI_API_BACKEND=gemini` (default) or `vertex` to start on
   Vertex AI express mode; `auto`/unset retries the same key against the other
   Google endpoint when one rejects it as "not an API key".
4. In Vercel → Project → **Settings** → **Environment Variables**, set both
   for Production (and Preview if you test there), then redeploy. **Important:**
   this app runs on Vercel, so `GEMINI_API_KEY` must be in the Vercel project's
   environment variables. Supabase *Edge Function* secrets are a different
   store that this Next.js app never reads — a key stored only there produces
   the error “Gemini is not configured — set the GEMINI_API_KEY server variable”
   and every upload falls back to file-name metadata.
5. Test: open **Admin → System Health** and press **Test Gemini**. It sends
   one tiny real request and reports the endpoint that answered (Gemini API or
   Vertex express mode), the model, the latency, and — on failure — exactly why
   Google rejected the call. Then go to `/admin/videos/upload`, choose a
   category and source, then publish. The server must generate title, description, and tags with Gemini
   before it creates the video record. Alternatively POST to
   `/api/gemini/suggest` as an admin with `{ "fileName": "clip.mp4" }` and
   expect a `{ suggestion, note }` response. To check a key from a terminal
   instead (no deploy needed), run `GEMINI_API_KEY=AQ.… npm run test:live` —
   see `tests/live/README.md`. It needs outbound HTTPS to Google.
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
9. Diagnose: `GEMINI_API_KEY` missing → 503 "not configured" (the upload page
   also shows an amber banner before you publish when the server cannot see the
   key); wrong key →
   503 (the message names both endpoints that were tried); quota/rate limit →
   429; unknown model → the next Flash model in `gemini-flash-latest,
   gemini-2.5-flash` is tried; malformed model output → 502. The key never
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
| `VIDEO_PROVIDER` | Video hosting integration | Yes | `streamtape` (real uploads) or `internal` (embeds only); `ufoload`/unknown fail closed | Hosting env | prod | `streamtape` | Yes |
| `STREAMTAPE_LOGIN` | Streamtape API Login | Yes (for uploads) | https://streamtape.com/accpanel → Account Settings | Hosting secrets | prod | Server-only; Admin → System Health performs a real `/account/info` check | Yes |
| `STREAMTAPE_API_KEY` | Streamtape API Key/Password | Yes (for uploads) | https://streamtape.com/accpanel → Account Settings | Hosting secrets | prod | Server-only; redacted from every log/error/audit row | Yes |
| `STREAMTAPE_FOLDER_ID` | Folder new uploads go into | No | Streamtape file manager | Hosting env | prod | Uploaded files appear in that folder | Yes |
| `STREAMTAPE_ADULT_CONTENT_ALLOWED` | Content-policy gate | Yes (for uploads) | Set `true` only after the owner verified Streamtape's terms/copyright policy/account settings | Hosting env | prod | Uploads answer `503` naming this variable until it is `true` **and** credentials are set | Yes |
| `STREAMTAPE_RELAY_URL` | Public URL of the upload relay | Yes (for uploads) | Where you deployed `relay/streamtape-relay.mjs` | Hosting env | prod | Session route answers `503 missing_relay` when unset | Yes |
| `STREAMTAPE_RELAY_SECRET` | HMAC secret shared with the relay (≥ 16 chars) | Yes (for uploads) | Generate randomly; same value in the relay | Hosting secrets + relay env | prod | Relay answers 403 on a token it did not receive from this app | Yes |
| `STREAMTAPE_MAX_UPLOAD_BYTES` | Largest accepted upload | Recommended | Verify the account's real limit | Hosting env | prod | Oversize files rejected with 413 before any bytes move | Yes |
| `STREAMTAPE_UPLOAD_HOST_SUFFIXES` | Extra trusted upload-node host suffixes | No | Only if Streamtape moves its nodes | Hosting env + relay env | prod | Unexpected hosts are rejected | Yes |
| `STREAMTAPE_MAX_ACTIVE_IMPORTS` | Cap on links per remote-upload batch | No | Default 10 | Hosting env | prod | Batches above it answer 400 | Yes |
| `GEMINI_API_KEY` | Gemini API key for metadata suggestions | No | https://aistudio.google.com/apikey → Create API key | Hosting secrets | prod (optional) | Test via `/api/gemini/suggest` as admin | Yes |
| `GEMINI_MODEL` | Gemini model name | No | Current docs, e.g., `gemini-flash-latest` | Hosting env | prod (optional) | Check https://ai.google.dev/gemini-api/docs for supported models | Yes |
| `GEMINI_MAX_OUTPUT_TOKENS` | Output-token budget for one metadata suggestion | No | `2048` (default); thinking tokens count against it | Hosting env | prod (optional) | Raise it if suggestions are truncated | Yes |
| `GEMINI_THINKING_BUDGET` | Thinking budget sent with each suggestion | No | `0` (default, thinking off) or `off` to omit the field | Hosting env | prod (optional) | Set `off` for models that reject `thinkingBudget` | Yes |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY`, `STREAMTAPE_RELAY_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

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
- [ ] Video publisher at `/admin/videos/upload` → upload multiple local files (streamed through the upload relay to Streamtape), paste a public iframe source, or import one or more public direct-video URLs
- [ ] Choose only a category and optional thumbnail; title, description, and tags are generated server-side by Gemini (`/api/gemini/suggest` contract: title, description, tags, category) before publishing
- [ ] Publish action sets status=published, visibility=public, rights_status=cleared, moderation_status=approved, published_at=now → appears on public `/` and `/video/[slug]` **only after Streamtape reports the file converted** (rows still converting stay private)
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
- [ ] Streamtape adapter: upload URL, file info, conversion queues, splash, remote upload, rename and delete use the documented API (`lib/video/streamtape.ts`); upload bytes go through the relay (`relay/streamtape-relay.mjs`)
- [ ] Upload errors do not lead to false Published status — a failed encode keeps the row private (`status=draft`) with `provider_error`
- [ ] Large file uploads never transit a Vercel Function — the browser PUTs chunks to the node URL the provider returned
- [ ] If the approval gate or the API key is missing, uploads return 503 with a clear blocker message

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
2. If Streamtape is unavailable (or returns 509 bandwidth-exceeded), the admin page reports it as a note on the row and pauses publishing; do **not** switch `VIDEO_PROVIDER` to an unknown value (the factory fails closed). `VIDEO_PROVIDER=internal` disables new uploads and is for embed-only deployments.
3. Existing published videos remain accessible because their stored embed/watch URLs do not expire

---

## Unresolved Provider Approvals and Blockers

1. **Streamtape content policy**: the Terms have no explicit adult-content clause (neither permitting nor banning), so production uploads stay disabled until the owner has verified the terms, copyright policy and account settings (ideally with Streamtape's written answer) — then set `STREAMTAPE_ADULT_CONTENT_ALLOWED=true`. Launch blocker — see `GO_LIVE_CHECKLIST.md`.
2. **Upload relay + live acceptance**: the relay must be deployed, and a real upload → conversion → publish → playback run has to be performed on staging (`docs/STREAMTAPE_MIGRATION.md` §7, `tests/live/README.md`). Browser CORS toward Streamtape's node is unproven; the relay is the supported path.
3. **Vercel Hobby**: Not suitable for commercial adult site. Hosting decision required — see `GO_LIVE_CHECKLIST.md`.
4. **Age assurance**: Frontend gate alone not robust. Legal review required for jurisdiction-specific verification.
5. **Legal identity**: Owner must provide real business details before publishing Terms/Privacy.
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
