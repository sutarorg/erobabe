# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

This document gives complete, verified steps to deploy Erobabe from zero to production. It covers Supabase, NOWPayments, video hosting, Gemini, Resend, GitHub, hosting, domain, env vars, testing, and rollback.

**Date**: October 10, 2026  
**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), NOWPayments, Resend, Gemini, UFOLOAD video hosting (adult-content approval pending — uploads blocked until recorded).

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
1. **Video hosting provider (UFOLOAD)**: UFOLOAD's Terms of Service (https://ufoload.com/tos) are a *draft* that neither permits nor prohibits lawful adult content (see section D.1). You MUST obtain written confirmation from UFOLOAD that lawful adult content, commercial use, API/direct upload, URL import, and embedded playback are permitted before real adult uploads are run or `UFOLOAD_ADULT_CONTENT_APPROVED` is set to `true`. Without this, production video hosting is BLOCKED.
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
5. Repeat, **in order**, for `00000000000003_admin_publishing_and_profile_security.sql`, `00000000000004_video_transit_storage.sql` (see the note in section D about its legacy bucket), `00000000000005_nowpayments.sql` and `00000000000006_ufoload_video_provider.sql` (UFOLOAD provider — test it first with section D.10). Skipping 03–06 leaves publishing, NOWPayments and UFOLOAD uploads broken.
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
- *(none for video: `UFOLOAD_API_KEY` is only used by the Next.js server routes, so it belongs in the hosting environment, not in Supabase Edge Function secrets)*
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

## D. Video-Hosting Setup (UFOLOAD)

[UFOLOAD](https://ufoload.com) is the **only** upload and hosting provider. `VIDEO_PROVIDER=ufoload` selects it; any other value (including the retired `uqload`) makes the upload routes answer `503` with a configuration error — the app never falls back to another provider. Videos that were already published through Uqload are **not touched**: their rows keep `provider='uqload'` and their stored embed URL, and they keep playing.

> **Status of this section: the code and its mocked tests were verified; a real upload to a real UFOLOAD account was NOT performed** (no account, key or written approval was available). Everything below marked *live* must be done by the owner — the checklist is in D.9.

### D.1 Hosting decision — CRITICAL BLOCKER: written approval for adult content

What UFOLOAD publishes (read on 2026-10-12):

- Its Terms of Service at https://ufoload.com/tos are headed **"DRAFT v0.1 — 2026-10-11 — Draft for legal review; not legal advice."**
- §3.2 is zero tolerance for child sexual abuse material. §3.3 forbids unlawful content, rights infringement, malware, serious violence or hatred, non-consensual intimate imagery, fraud and similar. **Lawful adult content is neither expressly permitted nor expressly prohibited.**
- §3.5: *"the absence of action is not approval of any Content"*. §15.2: UFOLOAD may suspend or terminate an account **with or without notice**. §16: the Terms can change. §4.4: published content is accessible to anyone with the link or embed code.

Because the draft is silent and can change, **the app will not upload anything until you set `UFOLOAD_ADULT_CONTENT_APPROVED=true`, and you must only do that after UFOLOAD confirms in writing** that, for your account:

1. lawful adult content (18+, consensual, rights-cleared) may be uploaded and stored;
2. commercial use of the account is allowed;
3. API/direct upload and URL import may be used for it;
4. embedding the UFOLOAD player on your own adult site is allowed;
5. what happens on a complaint (notice, takedown, appeal) and whether they warn before suspending.

Ask at **contact@ufoload.com** (the address on https://ufoload.com/legal). Keep the reply, and record the date and the person in `GO_LIVE_CHECKLIST.md`. Until then: **do not run real adult uploads, and do not mark the provider approved.** The flag is your statement, not something the code can verify — the System Health page says "approval flag set", not "UFOLOAD approved".

Only the exact value `true` counts (`TRUE`, `1`, `yes` do not). With the flag off, `/api/videos/ufoload-session`, `/api/videos/upload`, `/api/videos/upload-url` and `/api/videos/reconcile` all answer `503` with `code: adult_content_not_approved` and **make no request to UFOLOAD**.

### D.2 Plan considerations (owner decision)

From https://ufoload.com/pricing (2026-10-12; check it again before buying):

| | Free | Pro | Max |
|---|---|---|---|
| Max file size | 5 GB | 10 GB | 25 GB |
| Quality | up to 720p, single quality | up to 1080p, adaptive | up to 4K, adaptive |
| Files with no views | **removed after 30 days** | kept | kept |
| Player ads | **always shown to viewers** | your choice | your choice |
| Custom domain for player | no | yes | yes |

The app's own limit stays **2 GB**, below every plan's ceiling. For a catalogue site the Free plan's 30-day removal rule and forced ads are almost certainly unacceptable — plan for Pro or Max. UFOLOAD's draft terms say advertising in the player is currently disabled (§9.1) while its website says Free viewers always see ads; ask which is true for your plan.

### D.3 Owner setup, click by click

Menu names come from UFOLOAD's public documentation (https://ufoload.com/docs/api: *"Create an API key in your account (Developers section)"*); the logged-in dashboard could not be inspected, so if a label differs slightly, follow the same intent.

1. Open https://ufoload.com/register, create the account with a business e-mail, confirm the e-mail.
2. **Get the written approval described in D.1** before uploading adult content. In the meantime you may test with a *non-adult* sample you own.
3. Pick a plan at https://ufoload.com/pricing → **Get Pro** / **Buy** (pay with CryBit or account balance; nothing renews automatically).
4. Sign in → **Developers** (also labelled *API and keys*) → **Create API key**. Copy the key (`ufo_…`) immediately — **it is shown only once**. Store it in your password manager.
5. In your hosting provider's environment settings (Vercel: Project → **Settings** → **Environment Variables**; Fly.io: `fly secrets set`; Render/Railway: environment tab), add for **Production**:
   - `VIDEO_PROVIDER` = `ufoload`
   - `UFOLOAD_API_KEY` = the key from step 4 (mark it *Sensitive* / secret; it must **never** be a `NEXT_PUBLIC_*` variable)
   - `UFOLOAD_ADULT_CONTENT_APPROVED` = `false` (leave it false until step 12)
   - `CRON_SECRET` = a random string of at least 16 characters, e.g. `openssl rand -hex 32` (used in D.7)
6. Apply the database migration `supabase/migrations/00000000000006_ufoload_video_provider.sql` (section B.6; test it first with D.10).
7. **Redeploy** so the new variables take effect.
8. Open **Admin → System Health**: *Video Provider* must read `ufoload (blocked — see DEPLOYMENT.md)` while the flag is false, and name the missing piece if the key is missing.
9. **Lock playback to your domains** (recommended — an empty list lets *any* site embed your videos): UFOLOAD dashboard → **Player studio** / embed rules (the exact menu name could not be verified without a login) → allowed embed domains, add `erobabe.com` and `*.erobabe.com` (and a staging domain if you use one), save. The same can be done through the API:
   ```bash
   curl -H "Authorization: Bearer $UFOLOAD_API_KEY" \
     "https://api.ufoload.com/embed/domain?domains=erobabe.com,*.erobabe.com"
   curl -H "Authorization: Bearer $UFOLOAD_API_KEY" "https://api.ufoload.com/embed/domain"   # read back
   ```
   The site already sends `Referrer-Policy: strict-origin-when-cross-origin`, which lets the player see your origin for this check. Do not add `referrerpolicy="no-referrer"` to the iframe.
10. Check browser access to the upload nodes (D.6).
11. Set up the scheduler (D.7).
12. Run the **live smoke test** (D.9) with a non-adult sample. Only when it passes **and you hold UFOLOAD's written approval**, set `UFOLOAD_ADULT_CONTENT_APPROVED=true` and redeploy.

### D.4 How an upload works

```
Admin browser                         Erobabe server                       UFOLOAD
─────────────                         ──────────────                       ───────
1  POST /api/videos/ufoload-session ─▶ validates admin, size ≤ 2 GB,
   {fileName,fileSize,mime,category}   category, provider approved
                                       POST /api/v1/files/uploads ───────▶ grant + node URL
                                       (Bearer UFOLOAD_API_KEY)  ◀──────── upload_id,url,authorization,
                                       saves upload_jobs row                chunk_size,max_bytes,expires_at
   ◀── {jobId,uploadId,uploadUrl,authorization,chunkSize,maxBytes,expiresAt}   (never the API key)
2  PUT {uploadUrl}?offset=N  (Authorization: UfoGrant …) ─────────────────▶ upload node  (chunk_size, in order)
   GET {uploadUrl} → {"offset":N}  after any failure, then resumes from N
3  GET /api/videos/ufoload-session ──▶ GET /api/v1/files/uploads/{id} ────▶ keeps the slot (every 4 min)
4  POST /api/videos/upload {jobId,…} ─▶ POST …/uploads/{id}/complete ──────▶ verifies size+sha256, creates file
                                       stores file.id in provider_file_id; video = processing / private
5  GET /api/videos/status?jobIds=… ──▶ GET /api/v1/files/{id} ────────────▶ queued → processing → ready
   (also POST /api/videos/reconcile)    ready ⇒ verified embed URL ⇒ video published
```

- **No video byte ever passes through this app** (serverless request bodies are capped at a few MB) and the API key never reaches the browser — the browser only holds the per-upload grant.
- The browser sends each chunk to **the exact URL UFOLOAD returned** (only the documented `offset` query parameter is added). Chunk size, `max_bytes` and the expected offset come from the grant; nothing is hard-coded or guessed.
- It sets no forbidden browser header: only `Authorization` and `Content-Type`; the browser computes `Content-Length` from the `Blob` slice.
- If UFOLOAD answers `503 direct_upload_unavailable` the admin sees that message. There is **no fallback** through our servers.

**URL import** (`Upload by link`): `POST /api/videos/upload-url` runs the SSRF check (`assertPublicHttpUrl`), then `POST /api/v1/files/import` (UFOLOAD downloads the link itself, `202`). The **task id** is stored in `upload_jobs.provider_import_task_id`; it is *not* a file id. `GET /api/v1/files/import` has no per-task endpoint, so the task is found in the list **by its id** (never by name or URL). When the task is `done` its `file_id` goes to `provider_file_id` and the file is followed to `ready` like an upload. At most 10 imports run at UFOLOAD at once: our count and UFOLOAD's `409` both make the entry wait (the admin page retries; nothing is stored for a link that was not started).

**Publishing rule:** a video is created `processing` / `private` and becomes `published` / `public` **only** when UFOLOAD reports `ready` and a verified embed URL exists. On failure it returns to a private `draft` and `upload_jobs.error_message` keeps UFOLOAD's reason. Expiring signed playback/poster links from UFOLOAD are never stored (`playable_url` stays `NULL`).

### D.5 What the stable embed URL is, and how it is verified

UFOLOAD documents the embed as `https://ufoload.com/e/{public_id}` (public id: **11 characters**). Verified against the OpenAPI documents on 2026-10-12:

- REST v1 (`/api/openapi.json`): the `File` schema lists `id` but **no `public_id`**; the `fileID` path parameter is described as *"ULID or its short `public_id` (11 characters)"*.
- Public API (`/api/openapi-papi.json`): `FileInfo` has `filecode` (example `gi4o0tlro01`) and `protected_embed` (`https://ufoload.com/e/gi4o0tlro01`), and its `file_code` parameter accepts the ULID.

So the app resolves the embed in this order: a valid `public_id` / `filecode` / `protected_embed` in the REST response itself → otherwise `GET https://api.ufoload.com/file/info?file_code={file.id}` (Bearer key). The value must be exactly 11 URL-safe characters and the URL exactly `https://ufoload.com/e/{id}`; a ULID, a mismatching `protected_embed` or an empty answer yields **no URL and the video stays private** (reported as a warning). Nothing is invented. **Live check (D.9 step 7):** confirm which of the two paths the real API takes.

### D.6 CORS and network check (browser → upload node)

UFOLOAD's OpenAPI says the node accepts browser uploads (*"CORS is allowed for the site"*). That wording could not be verified for third-party origins, and the check needs a real grant. Before launch:

```bash
# 1. Start an upload in /admin/videos/upload with a small file and copy a node URL from DevTools → Network
#    (the PUT to https://upload.ufoload.com/NN/_node/v1/ingest/<id>?offset=0), then:
NODE_URL="https://upload.ufoload.com/NN/_node/v1/ingest/<id>"
curl -i -X OPTIONS "$NODE_URL?offset=0" \
  -H "Origin: https://YOUR-DOMAIN" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

The answer must allow your origin (`Access-Control-Allow-Origin`), the `PUT` method and the `authorization` and `content-type` headers (also check the same for `GET`). If it does not, the browser reports a plain network error (the admin page says *"the browser must be able to reach UFOLOAD's upload servers"*) — ask UFOLOAD support to allow your domain. Ad blockers, VPNs and corporate proxies can also block `upload.ufoload.com`.

### D.7 Background reconciliation (what finishes unattended work)

**Honest summary:** the repository contains the mechanism — `POST|GET /api/videos/reconcile` plus the job logic in `lib/video/processing.ts` — but it does **not** contain a scheduler. Something must *call* the route. There is no `vercel.json`/cron configuration in this repository on purpose: the supported hosts differ, and a sub-daily Vercel cron makes a Hobby-plan deployment fail.

What each call does: advances every unfinished job (import task → file → `ready` → published; `failed`/`cancelled` get their reason recorded; abandoned upload sessions are released), at most 25 jobs (50 if asked) and about 45 seconds per call, then returns a JSON summary. It never waits for UFOLOAD to finish encoding. Authentication: `Authorization: Bearer $CRON_SECRET` (at least 16 characters; compared in constant time) **or** a signed-in admin. With `CRON_SECRET` unset, only an admin session works.

Pick one scheduler, every **5 minutes**:

- **Vercel Cron** (paid plan required for sub-daily): add `vercel.json` — Vercel then sends `Authorization: Bearer $CRON_SECRET` itself when the `CRON_SECRET` variable exists.
  ```json
  { "crons": [{ "path": "/api/videos/reconcile", "schedule": "*/5 * * * *" }] }
  ```
  Reconcile and upload completion need up to 60 s of function time (`maxDuration = 60`).
- **GitHub Actions** (`.github/workflows/reconcile-videos.yml`, add repository secrets `SITE_URL` and `CRON_SECRET`; GitHub's schedule is best-effort and not faster than every 5 minutes):
  ```yaml
  name: reconcile-videos
  on:
    schedule: [{ cron: "*/10 * * * *" }]
    workflow_dispatch:
  jobs:
    reconcile:
      runs-on: ubuntu-latest
      steps:
        - run: >
            curl --fail-with-body -sS -X POST "$SITE_URL/api/videos/reconcile"
            -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{}'
          env:
            SITE_URL: ${{ secrets.SITE_URL }}
            CRON_SECRET: ${{ secrets.CRON_SECRET }}
  ```
- **Supabase `pg_cron` + `pg_net`** (enable both extensions; keep the secret in Vault rather than inline):
  ```sql
  select cron.schedule('reconcile-videos', '*/5 * * * *', $$
    select net.http_post(
      url := 'https://YOUR-DOMAIN/api/videos/reconcile',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
      body := '{}'::jsonb) $$);
  ```
- **Any server cron**: `*/5 * * * * curl -fsS -X POST https://YOUR-DOMAIN/api/videos/reconcile -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{}'`

**Without a scheduler** nothing is lost and nothing becomes public by mistake, but videos only advance (a) while an admin has `/admin/videos/upload` open (it polls `/api/videos/status` for its own rows) and (b) once each time an admin opens that page (it fires one bounded `POST /api/videos/reconcile`). Close the tab right after starting an import and the video stays `processing` / `private` until one of those happens. Admin → System Health says whether `CRON_SECRET` is set; it cannot tell whether a scheduler is actually calling.

Limits and rate handling (from UFOLOAD's docs): reads of `/files/*` are limited to 20 requests/second per user (burst 40) and the public API to 60 requests/minute per account — both answer `429` with `Retry-After`. The client retries reads at most twice (waiting at most 5 s inside a request), never repeats a write, times out every call (15 s; 55 s for `complete`), and re-checks a given job at most every 2.5 s. The admin page polls every 4 s, backing off to 15 s while nothing changes.

### D.8 What an admin sees when something goes wrong

| Situation | What the admin sees | Stored |
|---|---|---|
| Not approved / no key / unknown `VIDEO_PROVIDER` | `503` + the missing setting, nothing sent to UFOLOAD | — |
| `503 direct_upload_unavailable` | "UFOLOAD direct upload is temporarily unavailable… does not fall back…", Retry | — |
| Concurrent-upload limit (`429`) / storage full (`409`) / too large (`413`) / negative balance (`402`) / bad key (`401`) | specific message from the server | — |
| Network drops mid-upload | "connection dropped at 42%… Retry to resume" → Retry asks the node for its offset and continues | job `uploading`, session kept |
| Grant expired / session gone | "permission expired / start the upload again" → Retry starts a new session, the old one is released | old job `cancelled` |
| Cancel | transfer aborted, UFOLOAD slot released | job `cancelled` |
| UFOLOAD reports `failed` | UFOLOAD's reason + "upload it again" | job `failed`, video private `draft`, `error_message` |
| Import `failed` / `cancelled` / lost from UFOLOAD's list | the reason / "no longer lists import task …" | same |
| UFOLOAD slow or unreachable while checking | amber warning on the row, nothing changes | unchanged |
| Still processing after 48 h (import: 6 h) | failed with that reason | job `failed` |

### D.9 Live smoke-test checklist (NOT YET PERFORMED — owner to run)

Do this first with a **small non-adult video you own**. Tick a box only when you actually did it.

- [ ] **1. Health**: Admin → System Health → Video Provider shows `Configured — ufoload (approval flag set)` (after you set the flag for the test) or the exact blocker.
- [ ] **2. CORS**: the preflight in D.6 allows your origin for `PUT`/`GET` with `authorization`, `content-type`.
- [ ] **3. Real progress**: `/admin/videos/upload` → *Upload videos* → pick the file → the row shows `Uploading to UFOLOAD — N%` rising with real bytes; DevTools → Network shows `PUT https://upload.ufoload.com/…?offset=…` requests whose `Authorization` starts with `UfoGrant`. Search the whole Network tab and the page source for `ufo_` — **it must not appear**.
- [ ] **4. Resume**: during a multi-chunk upload switch the browser offline, wait for the error, go online, press **Retry** → one `GET` of the node URL, then `PUT` continues at the node's offset (no re-sent chunk).
- [ ] **5. Cancel**: start another upload and press **Cancel** → the session disappears in UFOLOAD's dashboard; `upload_jobs.status = 'cancelled'`.
- [ ] **6. Registered but private**: after the bytes finish, the row says `Uploaded · UFOLOAD is encoding`. SQL: `select status, visibility, provider, provider_file_id, embed_url, playable_url from videos order by created_at desc limit 1;` → `processing | private | ufoload | <file id shown in UFOLOAD's dashboard> | NULL | NULL`. The public `/video/<slug>` answers 404.
- [ ] **7. Ready → published, embed verified**: when UFOLOAD shows the file ready (or after the scheduler runs) the row says `Published`; SQL shows `published | public`, `embed_url = https://ufoload.com/e/<11 chars>`, `playable_url NULL`. Note which source the id came from (REST `public_id` or papi `file/info`) — see D.5.
- [ ] **8. Playback**: open `/video/<slug>` in a private window → the iframe plays. Try embedding the same URL on a domain you did **not** allow → it must refuse (domain lock).
- [ ] **9. Import**: *Upload by link* with a small public direct link → `upload_jobs.provider_import_task_id` is set and `provider_file_id` is NULL → later `provider_file_id` = the file id, the two differ → published.
- [ ] **10. Import slots**: queue more than 10 links → the extra rows say `Waiting for a free UFOLOAD import slot` and start as slots free.
- [ ] **11. Failure path**: import a link that returns 404 / HTML → the row shows UFOLOAD's reason; the video is a private `draft`; `error_message` is set.
- [ ] **12. Unattended**: start an import, **close the tab**, wait one scheduler interval → the video is published without anyone watching; `audit_logs` has `video_published_when_ready`.
- [ ] **13. Scheduler secret**: `curl -i -X POST https://YOUR-DOMAIN/api/videos/reconcile` → `401`; with the bearer secret → `200` + summary.
- [ ] **14. Legacy**: an old Uqload video still plays on its page.
- [ ] **15. Optional automated live test** (Node, no CORS): `UFOLOAD_LIVE_TEST=1 UFOLOAD_API_KEY=… UFOLOAD_LIVE_TEST_FILE=/path/sample.mp4 UFOLOAD_LIVE_TEST_ACK_NON_ADULT=1 npx vitest run tests/live` (add `UFOLOAD_LIVE_TEST_IMPORT_URL=https://…` to include an import). It deletes what it created unless `UFOLOAD_LIVE_TEST_KEEP=1`.

Only after 1–14 pass **and** UFOLOAD's written approval is in hand: set `UFOLOAD_ADULT_CONTENT_APPROVED=true`.

### D.10 Supabase migration test procedure

Migration `00000000000006_ufoload_video_provider.sql` is additive and idempotent: it allows `ufoload` in `videos_provider_check` (keeping every old value), defaults `upload_jobs.provider` to `ufoload`, adds `provider_upload_id`, `provider_import_task_id` (the import-task column), `provider_status`, `last_checked_at` and indexes. It deletes and relabels nothing. The initial schema was updated the same way for fresh installs.

**A. On your machine, against a real Postgres engine (no Docker):**
```bash
npm install --no-save @electric-sql/pglite      # not a project dependency; leaves package.json untouched
node scripts/verify-ufoload-migration.mjs        # 13 checks
node scripts/verify-ufoload-migration.mjs --baseline-ref main   # same, starting from `main`'s pre-change schema
```
It rebuilds a "deployed" database (migrations 00–05, Uqload-era shape) with historical Uqload videos and jobs, applies 06 **three times**, and proves: no historical row changed; `uqload` rows keep their provider and URLs; `ufoload` is accepted while unknown providers are still rejected; the default changed; the new columns are nullable and unique per upload/task; a fresh install ends identical. (It stubs Supabase's `auth`/`storage` schemas, so it validates this repository's SQL, not Supabase itself.)

**B. On Supabase (do this before production):**
1. Create a **copy of production**: Dashboard → **Database** → **Backups** → restore to a *new* project (or use a Supabase branch).
2. Record the baseline there:
   ```sql
   select provider, status, count(*) from public.videos group by 1, 2 order by 1, 2;
   select provider, status, count(*) from public.upload_jobs group by 1, 2 order by 1, 2;
   select pg_get_constraintdef(oid) from pg_constraint where conname = 'videos_provider_check';
   ```
3. Apply: `supabase link --project-ref <COPY_REF> && supabase db push --dry-run` (read the plan), then `supabase db push`.
4. Re-run the three queries: the **counts must be identical**, the constraint must now list `'ufoload'` and still list `'uqload'`.
5. Prove idempotency: paste the 06 file into **SQL Editor** and run it again → no error; queries unchanged.
6. Insert tests (then roll back): `begin; insert into public.videos (slug,title,provider) values ('t','t','ufoload'); insert into public.videos (slug,title,provider) values ('u','u','nonsense'); rollback;` → the second statement must fail with a check violation.
7. Repeat on production in a quiet period (take a backup first: **Database → Backups**). The migration holds only short locks and rewrites no table.

**Rollback:** nothing needs to be undone for the app to keep working (the new columns are harmless). To restore the old constraint — only while **no** row has `provider='ufoload'`:
```sql
alter table public.videos drop constraint videos_provider_check;
alter table public.videos add constraint videos_provider_check
  check (provider in ('uqload','bunny','cloudflare','internal','s3','embed'));
alter table public.upload_jobs alter column provider set default 'uqload';
```

### D.11 Official sources consulted (2026-10-12)

- API guide: https://ufoload.com/docs/api and https://ufoload.com/api/docs
- REST v1 OpenAPI: https://ufoload.com/api/openapi.json (and `.yaml`) — direct upload (`/files/uploads`, node chunks, `complete`, state), `/files/import`, `/files/{id}`, `File` / `Import` schemas, error and rate-limit rules
- Public API OpenAPI: https://ufoload.com/api/openapi-papi.json — `FileInfo.filecode`, `protected_embed`, `/embed/domain`
- Terms (draft): https://ufoload.com/tos · DMCA: https://ufoload.com/dmca · Legal notice / contact: https://ufoload.com/legal
- Pricing and plan limits: https://ufoload.com/pricing · FAQ: https://ufoload.com/faq
- Player / embeds: https://ufoload.com/embeddable-video-player · https://ufoload.com/video-hosting-for-websites · https://ufoload.com/hls-hosting · https://ufoload.com/features

### Supabase Storage

1. Go to **Storage** → **New bucket** → `ad-creatives` (public, for advertiser creatives)
2. Create bucket `video-thumbnails` (public, for admin-selected video thumbnails). `lib/video/storage.ts` also creates it on first use so a missed migration does not block thumbnail uploads. **Thumbnails stay on Supabase signed uploads** — UFOLOAD is not used for them.
3. No `videos` bucket is needed: video bytes never touch Supabase.
4. Set policies: allow authenticated advertisers to upload/delete only within their own `ad-creatives/<user-id>/` folder; public read is needed for creative and thumbnail display.

> **Legacy**: `video-incoming` (from migration `00000000000004_video_transit_storage.sql`) belonged to an abandoned Supabase-transit flow and is no longer used — video bytes go straight from the browser to UFOLOAD. On Supabase projects with a 50 MB global file limit the migration's 2 GB bucket insert can fail; skip/ignore that bucket and do not upload video bytes to Supabase.
5. The campaign and publisher flows fail clearly if their required bucket is missing. Verify both bucket names before accepting uploads.

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
| `VIDEO_PROVIDER` | Video hosting provider — only `ufoload` is supported; anything else (including the retired `uqload`) fails closed with a 503 configuration error | No | `ufoload` | Hosting env | prod | Admin → System Health → Video Provider | Yes |
| `UFOLOAD_API_KEY` | UFOLOAD API key (`Authorization: Bearer ufo_…`), used only by server routes | **No — never `NEXT_PUBLIC_*`** | UFOLOAD dashboard → Developers → API keys (shown once) | Hosting secrets | prod | System Health shows the provider configured; never appears in the browser, logs or DB (see D.9 step 3) | Yes |
| `UFOLOAD_ADULT_CONTENT_APPROVED` | Fail-closed flag: UFOLOAD confirmed in writing that your adult-content use is permitted | No | Set to exactly `true` only after that written confirmation (D.1) | Hosting env | prod | Upload routes answer 503 `adult_content_not_approved` until `true` | Yes |
| `CRON_SECRET` | Bearer secret that lets a scheduler call `/api/videos/reconcile` (≥ 16 chars) | No | `openssl rand -hex 32` | Hosting secrets | prod | `curl -X POST …/api/videos/reconcile` → 401 without it, 200 with it (D.7) | Yes |
| `GEMINI_API_KEY` | Gemini API key for metadata suggestions | No | https://aistudio.google.com/apikey → Create API key | Hosting secrets | prod (optional) | Test via `/api/gemini/suggest` as admin | Yes |
| `GEMINI_MODEL` | Gemini model name | No | Current docs, e.g., `gemini-flash-latest` | Hosting env | prod (optional) | Check https://ai.google.dev/gemini-api/docs for supported models | Yes |
| `GEMINI_MAX_OUTPUT_TOKENS` | Output-token budget for one metadata suggestion | No | `2048` (default); thinking tokens count against it | Hosting env | prod (optional) | Raise it if suggestions are truncated | Yes |
| `GEMINI_THINKING_BUDGET` | Thinking budget sent with each suggestion | No | `0` (default, thinking off) or `off` to omit the field | Hosting env | prod (optional) | Set `off` for models that reject `thinkingBudget` | Yes |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `UFOLOAD_API_KEY`, `CRON_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

---

## J. Testing and Go-Live Checklist

### Automated tests

```bash
npm ci
npm run type-check
npm run test
npm run build
npx playwright install   # once, to download the browsers
npm run test:e2e
```

The UFOLOAD unit tests use a mock written from UFOLOAD's OpenAPI document — they prove contract conformance, **not** that a real upload works (that is section D.9). `tests/live/ufoload.live.test.ts` is the optional real-API test (skipped unless `UFOLOAD_LIVE_TEST=1`). The migration check is `node scripts/verify-ufoload-migration.mjs` (section D.10).

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
- [ ] Video publisher at `/admin/videos/upload` → upload multiple local files (chunked, direct to UFOLOAD), paste a public iframe source, or import one or more public direct-video URLs through UFOLOAD
- [ ] Choose only a category and optional thumbnail; title, description, and tags are generated server-side by Gemini (`/api/gemini/suggest` contract: title, description, tags, category) before publishing
- [ ] An uploaded or imported video is `processing` / `private` until UFOLOAD reports it `ready`; then it becomes status=published, visibility=public, rights_status=cleared, moderation_status=approved, published_at=now with `embed_url = https://ufoload.com/e/{public_id}` → appears on public `/` and `/video/[slug]`. Iframe embeds publish immediately.
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
- [ ] Provider selection in `lib/video/provider.ts`: `VIDEO_PROVIDER=ufoload`; an unknown or retired value answers 503 and never falls back to Uqload
- [ ] UFOLOAD client `lib/video/ufoload.ts`: Bearer auth, direct upload init/complete/state/cancel, URL import, file status, verified embed URL — covered by the mocked contract tests; the real API check is D.9
- [ ] Upload errors do not lead to false Published status — a failed video returns to a private `draft` with UFOLOAD's reason; a video is published only when UFOLOAD reports `ready`
- [ ] Large file uploads never pass through a serverless function — the browser sends 2 GB-capped chunks straight to UFOLOAD's node; `503 direct_upload_unavailable` is shown, with no fallback through our servers
- [ ] If UFOLOAD is not approved / has no key, every upload route returns 503 with a clear blocker message and makes no UFOLOAD request
- [ ] Background reconciliation: a scheduler calls `/api/videos/reconcile` (D.7)
- [ ] Migration `00000000000006` tested on a copy of production (D.10)

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

**Video hosting outage or withdrawn approval:**
1. Check UFOLOAD's status/announcements and your dashboard
2. To stop all new uploads immediately set `UFOLOAD_ADULT_CONTENT_APPROVED=false` and redeploy — upload, import and reconcile routes answer 503 and make no UFOLOAD call; already-published videos keep playing from their stored `https://ufoload.com/e/…` embed URL
3. Videos still `processing` simply wait (they stay private) until the provider is enabled again
4. Historical Uqload videos are unaffected either way

---

## Unresolved Provider Approvals and Blockers

1. **UFOLOAD adult content**: UFOLOAD's Terms of Service are a draft (v0.1, 2026-10-11) that does not address lawful adult content. Production uploads stay disabled unless `UFOLOAD_ADULT_CONTENT_APPROVED=true`, which requires UFOLOAD's *written* approval. This is a launch blocker — see D.1 and `GO_LIVE_CHECKLIST.md`.
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
