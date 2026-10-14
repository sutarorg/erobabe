# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

Deployment setup and operational checklist for Erobabe. It covers Supabase, NOWPayments, video publishing, OpenRouter, Resend, hosting, domains, environment variables, testing and rollback. Filekosh hosted uploads are not implemented or enabled; section D documents the research blockers and required staging verification.

**Video-provider guidance audited**: October 14, 2026

**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), NOWPayments, Resend, OpenRouter (DeepSeek V3.2), direct MP4 URL video publishing, Tailwind CSS 4.

---

## A. Prerequisites

### Accounts needed
- Supabase account (https://supabase.com)
- NOWPayments account (https://nowpayments.io)
- Resend account (https://resend.com)
- OpenRouter account for AI metadata (DeepSeek V3.2) (https://openrouter.ai)
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
1. **Video hosting provider**: Current publishing saves direct URLs or generic embed links; local video-file uploads are unavailable. Filekosh integration is blocked on missing details in its official API contract, content/use approval and live staging verification. Do not deploy the retired Streamtape upload relay or enable Filekosh by changing a provider label. See section D and `docs/FILEKOSH_API_RESEARCH.md`.
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
5. Apply the remaining checked-in migrations in order through `00000000000010_admin_video_tools.sql`; do not re-run or edit migrations already recorded as applied. No Filekosh migration is included in this research-only change.
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
supabase secrets set RESEND_API_KEY=... NOWPAYMENTS_API_KEY=...
```

### 9. Add production function secrets
In Supabase Dashboard → **Edge Functions** → **Secrets**, add:
- `RESEND_API_KEY`
- `OPENROUTER_API_KEY`
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY` only for retained legacy playback and optional file-manager thumbnails (server-only; see section D). No upload relay secret is used by the current routes.
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

## D. Video Publishing — URLs, embeds, and Filekosh readiness

### How it works

Videos are published by pasting direct MP4 URLs into the admin panel
(`/admin/videos/upload`). Erobabe saves the URL in `videos.playable_url` and
the browser plays the video straight from the original host. Erobabe may fetch
frame samples for thumbnails, but does not copy or host the full source video.
Player-page links and iframe sources use the separate generic embed publisher.

- **Provider:** `direct_url` (the default — no `VIDEO_PROVIDER` variable needed)
- **Playback:** Native `<video>` element with `playable_url`
- **Thumbnail:** Uploaded to Supabase Storage (signed upload URL)
- **Metadata:** Generated by DeepSeek V3.2 via OpenRouter (with file-name fallback)
- **No hosting-provider upload API or relay needed** for these link workflows; optional Streamtape thumbnail fallback and legacy playback still use its API.

### Setup steps

1. Run the database migration `supabase/migrations/00000000000008_direct_video_urls.sql`
   (forward-only; adds `direct_url` to the allowed provider values).
   Older migrations are untouched; legacy rows keep playing from their stored URLs.
2. Open Admin → **System Health**: *Video Provider* should read `direct_url`.
3. Open `/admin/videos/upload`, choose a category, paste a direct `.mp4` URL,
   and press **Generate AI metadata & publish**. The video should appear
   immediately with AI-generated metadata (or file-name fallback).
4. Open `/video/[slug]` and confirm playback, seeking, and error handling.

### Thumbnails

Each video has its own thumbnail picker. A custom thumbnail is uploaded to the
public `video-thumbnails` bucket through the existing signed-upload flow
(`POST /api/videos/storage-token` → browser `PUT`).

Three further sources fill in a video that has none, in this order:

1. **A frame from the video itself** — `POST /api/admin/videos/thumbnails` runs
   ffmpeg over the direct URL and stores a captured frame.
2. **The Streamtape file manager** — see the next section. This is the automatic
   fallback at publish time for both direct-URL and embed publishing.
3. **A manual pick** from `/admin/videos` → *Add thumbnail*.

### Thumbnails from the Streamtape file manager

If the thumbnail images live in the Streamtape file manager — one image per
video in a folder such as `home/thumbnails`, each named after its video —
Erobabe can attach them itself.

- `STREAMTAPE_LOGIN` and `STREAMTAPE_API_KEY` (server-only; Streamtape panel →
  *Account Settings*) authorise a read of the file manager. Both are required;
  without them the importer answers `503` with an actionable message and
  publishing continues with whatever thumbnail it already has.
- `STREAMTAPE_THUMBNAIL_FOLDER_NAME` (default `thumbnails`) names the folder to
  look for; the file manager is searched breadth-first to a shallow depth, and
  common spellings (`thumbs`, `thumnails`) are recognised. Set
  `STREAMTAPE_THUMBNAIL_FOLDER_ID` to skip the search entirely.
- Matching is by name: the image name is compared against the video's title,
  slug, source file name and upload name, lower-cased and stripped of
  separators, brackets, extensions and resolution tags. An exact match always
  wins; below that a token-overlap score with a floor of 0.68 decides. A near
  miss is reported as *unmatched* rather than attached — a wrong thumbnail is
  worse than a missing one.
- A matched image is **copied** into the public `video-thumbnails` bucket and
  the stored URL is Erobabe's own. Streamtape download links are ticketed and
  expire, so they are never written to a video row.

Admin surface (all admin-only, `/api/admin/videos/streamtape-thumbnails`):

| Action | Request | Effect |
| --- | --- | --- |
| Check folder | `GET` | Dry run: reports the folder found, how many images it holds, and which video each one would match. Downloads and writes nothing. |
| Import | `POST { ids?: string[]; overwrite?: boolean }` | Copies the matched images into storage and writes the public URLs. Without `ids`, fills every video still missing a thumbnail (25 per request). `overwrite: true` is required to replace an existing thumbnail. |

In `/admin/videos` the **Streamtape thumbnails** panel runs the dry run with
*Check folder* and the import with *Import missing thumbnails* (or
*Import for selection* when rows are ticked). Each row without a thumbnail also
has a *Streamtape thumb* action.

### Legacy videos and retired upload instructions

Existing Streamtape, UFOLOAD, Uqload and embed records are not migrated or
relabelled. Preserve their stored identifiers, metadata, thumbnails and URLs.

Streamtape **uploads** are retired, but playback is not: `VideoPlayer` uses
`/api/videos/[id]/prepare` and `/api/videos/[id]/playback` to resolve and consume
IP-bound tickets server-side. Retain server-only `STREAMTAPE_LOGIN` and
`STREAMTAPE_API_KEY`, outbound access and streaming-capable hosting for those
videos. See `docs/AD_FREE_PLAYBACK.md`. UFOLOAD/Uqload retain stored playback
without status reconciliation against their retired APIs.

The old upload-session, relay and conversion-polling instructions are historical,
not deployable steps for this checkout. They have been removed from this setup
guide; `docs/STREAMTAPE_MIGRATION.md` preserves that history. No current upload
route uses `STREAMTAPE_RELAY_*` or `STREAMTAPE_ADULT_CONTENT_ALLOWED` to enable
local-file hosting.

### Filekosh — blocked, no runtime enablement yet

Official documentation exists at https://filekosh.com/docs, backed by
https://filekosh.com/api/v1/openapi.json. It documents a Dashboard → API bearer
key, `POST /videos` → presigned PUT → `POST /videos/confirm`, and WEB video
`embedUrl` responses. **The confirmation request body is missing**, and upload
headers/CORS, response envelopes and lifecycle/error details require provider
clarification. See `docs/FILEKOSH_API_RESEARCH.md` for exact confirmed facts,
source links and the message to send to support.

There is **no Filekosh environment variable consumed by the application**, no
local-video upload UI/API, and no Filekosh migration in this change. Keep
`VIDEO_PROVIDER` unset or `direct_url`; setting `filekosh` does not create an
integration. Never place a provider key in `NEXT_PUBLIC_*`, a player URL, source
control, browser bundles, logs or public database fields.

Before implementation/enablement:

1. Obtain an authorized complete create/PUT/confirm/status specification and
   sanitized examples, including safe retry/cancellation behavior and supported
   formats/limits. The linked research report lists every missing detail.
2. Obtain written permission for the intended lawful adult catalog, commercial
   API use and third-party embedding. The public terms do not explicitly grant
   this use. Preserve existing rights/moderation gates.
3. Provision a staging key privately using the documented Dashboard → API
   mechanism, an active staging administrator/category and rights-cleared test
   media. Do not paste secrets into chat or issues. Runtime configuration names
   will be documented with the real implementation, not invented now.
4. Verify Filekosh/storage reachability and browser PUT CORS from staging.
   Presigned PUT does not by itself prove browser support, resumability or
   unlimited technical object size. If a streaming worker is required, verify
   that host's body, time, memory and egress limits; never buffer whole videos
   inside a typical Next.js function.
5. Implement the actual App Router workflow and a forward-only migration (next
   number at the audit: `00000000000011`; recheck before use), preserving every
   historical provider value and record. Apply that future migration before
   enabling hosted jobs; no migration or data relabel is needed now.
6. Validate genuine transfer, completion/readiness, stored IDs and returned
   HTTPS Filekosh embed URLs, desktop/mobile playback, failure/cancel/retry and
   duplicate handling. Only then enable Filekosh for **new hosted uploads**.

Troubleshooting now: a missing video-file selector is expected, not a credential
error. `/api/videos/upload-url` publishes existing links; `/storage-token` signs
images only; `/status` reads history, not Filekosh processing. A passing build or
mocked response is not a live upload. See `docs/FILEKOSH_REPOSITORY_AUDIT.md` for
the current call graph and actual test results.

### Supabase Storage

1. Go to **Storage** → **New bucket** → `ad-creatives` (public, for advertiser creatives)
2. Create bucket `video-thumbnails` (public, for admin-selected video thumbnails). `lib/video/storage.ts` also creates it on first use so a missed migration does not block thumbnail uploads.
3. Optionally create bucket `videos` (private, only if you later implement an internal provider)
4. Set policies: allow authenticated advertisers to upload/delete only within their own `ad-creatives/<user-id>/` folder; public read is needed for creative and thumbnail display.

> **Legacy**: `video-incoming` comes from migration `00000000000004_video_transit_storage.sql`. Current routes do not upload videos there or to a Streamtape relay. Preserve any objects required by older deployments until their ownership/retention is checked. Its historical 2 GB limit is not a Filekosh limit. If a migration fails due to project storage limits, resolve it explicitly; do not silently mark it applied or edit historical SQL.
5. The campaign and publisher flows now fail clearly if their required bucket is missing. Verify both bucket names before accepting uploads.

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

## E. AI Metadata Setup (OpenRouter · DeepSeek V3.2)

Docs: https://openrouter.ai/deepseek/deepseek-v3.2 — code: `lib/metadata/`
(`openrouter.ts` for the client, `suggestion.ts` for prompt and validation),
route: `/api/metadata/suggest`.

1. Go to https://openrouter.ai/keys → **Create key**. Add credits to the
   OpenRouter account; a key with no balance is rejected with a clear message.
2. Copy the key — this is `OPENROUTER_API_KEY` (server-only, never expose to the
   browser, never a `NEXT_PUBLIC_*` variable). Keys start with `sk-or-`.
3. Set env: `OPENROUTER_API_KEY=<key>`. The model defaults to
   `deepseek/deepseek-v3.2`; override with `OPENROUTER_MODEL` only if you need a
   different OpenRouter model slug.
4. In Vercel → Project → **Settings** → **Environment Variables**, set it for
   Production (and Preview if you test there), then redeploy. **Important:**
   this app runs on Vercel, so `OPENROUTER_API_KEY` must be in the Vercel
   project's environment variables. Supabase *Edge Function* secrets are a
   different store that this Next.js app never reads — a key stored only there
   produces the error “OpenRouter is not configured — set the OPENROUTER_API_KEY
   server variable” and every upload falls back to file-name metadata.
5. Test: open **Admin → System Health** and press **Test OpenRouter**. It sends
   one tiny real request and reports the model, the latency, and — on failure —
   why OpenRouter rejected the call. Then go to `/admin/videos/upload`, choose a
   category and source, then publish. The server must generate title,
   description, and tags before it creates the video record. Alternatively POST
   to `/api/metadata/suggest` as an admin with `{ "fileName": "clip.mp4" }` and
   expect a `{ suggestion, note }` response. To check a key from a terminal
   instead (no deploy needed), run `OPENROUTER_API_KEY=sk-or-… npm run test:live`
   — see `tests/live/README.md`. It needs outbound HTTPS to openrouter.ai.
6. Optional tuning: `OPENROUTER_MAX_OUTPUT_TOKENS` (default `2048`) is the
   per-suggestion output budget. Reasoning is turned off for every request
   (`reasoning: { enabled: false }`), so the whole budget goes to the JSON.
   If the provider rejects the JSON-mode or reasoning field, the client retries
   without that field.
7. AI metadata is an enhancement, not a gate. If it is not configured, returns
   malformed output, or hits quota, the upload still completes: the video is
   created with deterministic metadata built from the file name and category
   (`/api/videos/upload*` answers with `metadataSource: "fallback"` and a
   `metadataWarning`, and the admin UI flags the item for review). The
   `/api/metadata/suggest` endpoint still answers 503/502/429 with an actionable
   message so the AI path can be diagnosed. Title, description, and tags are
   intentionally not browser-editable in this workflow.
8. **Important**: Never send video bytes, private rights docs, payment
   records, or personal info to the model. Only the source filename/URL path,
   working title, selected category, and existing tags are sent for metadata
   generation. AI output is not proof of rights, age, consent, or factual
   attributes, and suggestions require human review.
9. Diagnose: `OPENROUTER_API_KEY` missing → 503 "not configured" (the upload page
   also shows an amber banner before you publish when the server cannot see the
   key); rejected key (401/403) → 503; no credits or rate limit (402/429) → 429;
   unknown model slug (404) → 502 naming the model; malformed model output → 502.
   The key never appears in responses or logs; any key-shaped text echoed by a
   provider is redacted before it is shown.
10. "The model's reply could not be parsed as JSON" means the model's text could
    not be parsed even after the built-in clean-up (markdown fences, prose around
    the payload, raw newlines inside strings, smart quotes, trailing commas, and
    truncated output are all handled) and a retry. Raise
    `OPENROUTER_MAX_OUTPUT_TOKENS` and retry, or set `OPENROUTER_MODEL` to a model
    with JSON output support. Uploads are unaffected — they fall back to
    file-name metadata.

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
| `VIDEO_PROVIDER` | Non-hosting provider factory selection; active URL/embed routes select their provider explicitly | No | Leave unset (`direct_url`); `filekosh` is not implemented | Hosting env | optional | Current System Health label is not a live hosting/upload test | Yes |
| `STREAMTAPE_LOGIN` | Legacy playback and optional thumbnail file-manager API login | No | https://streamtape.com/accpanel → Account Settings | Hosting secrets | if retaining those workflows | Validate legacy playback and Admin → Videos → Check folder | Yes |
| `STREAMTAPE_API_KEY` | Legacy playback and optional thumbnail API key | No | Streamtape Account Settings | Hosting secrets | if retaining those workflows | Validate legacy playback and read-only folder scan; never print key | Yes |
| `STREAMTAPE_THUMBNAIL_FOLDER_NAME` | Optional image-folder name | No | Streamtape file manager; default `thumbnails` | Hosting env | optional | Admin → Videos → Check folder | Yes |
| `STREAMTAPE_THUMBNAIL_FOLDER_ID` | Optional explicit image-folder ID | No | Streamtape file manager | Hosting env | optional | Skips folder-name search; verify scan | Yes |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI metadata suggestions | No | https://openrouter.ai/keys → Create key | Hosting secrets | prod (optional) | Test via System Health → Test OpenRouter, or `/api/metadata/suggest` as admin | Yes |
| `OPENROUTER_MODEL` | OpenRouter model slug | No | `deepseek/deepseek-v3.2` (default) | Hosting env | prod (optional) | Check https://openrouter.ai/models for the slug | No |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | Output-token budget for one metadata suggestion | No | `2048` (default) | Hosting env | prod (optional) | Raise it if suggestions are truncated | No |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY`, any future Filekosh bearer key, `OPENROUTER_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

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
- [ ] Video publisher at `/admin/videos/upload` → publish direct-video URLs or player/iframe links with optional thumbnail images. No local video transfer is available yet.
- [ ] Choose only a category and optional thumbnail; title, description, and tags are generated server-side by DeepSeek V3.2 via OpenRouter (`/api/metadata/suggest` contract: title, description, tags, category) before publishing
- [ ] Publish action sets status=published, visibility=public, rights_status=cleared, moderation_status=approved, published_at=now → appears on public `/` and `/video/[slug]` after successful URL/embed publishing. Future hosted uploads must remain private until provider readiness is verified; that flow is not implemented yet.
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
- [ ] Direct-URL and generic embed publishing, category/metadata/duplicate handling and optional thumbnails work with an active staging administrator
- [ ] Legacy Streamtape native playback, seeking, retry and ticket warm-up still work with server-only credentials
- [ ] Filekosh remains disabled until its contract/policy/setup gates in section D are resolved
- [ ] Before future enablement: genuine device upload, accurate byte progress, verified completion/readiness, stable embed playback and failure/cancellation/idempotency tests all pass
- [ ] Future Filekosh jobs do not call Streamtape thumbnail or media APIs and never expose provider keys or upload authorization publicly

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

1. **Filekosh API and content/use approval**: its official API specification is incomplete for upload confirmation. Obtain the clarification and written content/use permission listed in `docs/FILEKOSH_API_RESEARCH.md`. No Filekosh upload integration is enabled.
2. **Hosted-upload implementation and live acceptance**: a future implementation needs authorized staging credentials, documented browser/streaming transport, forward migration, and real upload → readiness → publish → desktop/mobile iframe playback evidence. Current passing unit tests/build do not prove Filekosh functionality.
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
