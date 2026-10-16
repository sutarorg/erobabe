# DEPLOYMENT.md — Erobabe Production Setup (Click-by-Click)

Deployment setup and operational checklist for Erobabe. It covers Supabase, NOWPayments, video publishing, OpenRouter, Resend, hosting, domains, environment variables, testing and rollback. Bunny Stream resumable device uploads are implemented; section D documents setup and remaining live acceptance.

**Current launch evidence:** see PRODUCTION_READINESS.md and GO_LIVE_CHECKLIST.md. Repository checks are not account-policy approval. Follow the rollout addendum below before using historical setup steps.

**Video-provider guidance audited**: October 14, 2026

**Stack**: Next.js 15 App Router, Supabase (Auth + Postgres + Storage + Edge Functions optional), NOWPayments, Resend, OpenRouter (NVIDIA Nemotron 3 Ultra, free route), Bunny Stream device uploads, Tailwind CSS 4.

---

## A. Prerequisites

### Accounts needed
- Supabase account (https://supabase.com)
- NOWPayments account (https://nowpayments.io)
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
1. **Video hosting provider**: Bunny Stream device uploads only; obtain account/content-use confirmation and complete section D live staging acceptance.
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
   - `https://erobabe.com/auth/callback` (implemented PKCE callback)
   - `https://erobabe.com/auth/callback?next=/auth/update-password`
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

This checkout implements payments/IPN, metadata, storage-token and Bunny sessions
as Next.js routes. There are no checked-in Supabase Edge Functions to deploy for
these operations. Do not create retired upload relay functions.

### 9. Configure server secrets on the application host

Set `SUPABASE_SECRET_KEY` (or the legacy service-role alias), `RESEND_API_KEY`,
`OPENROUTER_API_KEY` when using metadata AI, `NOWPAYMENTS_API_KEY`,
`NOWPAYMENTS_IPN_SECRET`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`,
`CRON_SECRET` when using background auto-publish, and site
URL settings on the **Next.js application host**. Supabase Edge Function secrets
alone are not visible to Next.js. Keep every secret server-only; redeploy after
updates. See sections C/D for gateway and Stream configuration.

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

## D. Bunny Stream device uploads

### Content and hosting policy (checked October 14, 2026)

Read https://bunny.net/acceptable-use/ and https://bunny.net/tos/ before uploading.
The current AUP's **Adult Content** section accepts adult-content providers only
when the content is legal under Slovenia's laws, all 50 US states, and all other
terms. This is **not approval of this account, catalogue, consent/rights records,
or business**. Obtain legal review and written account/use confirmation from Bunny
support before production. Document performer age/consent, copyright ownership,
takedown handling, data protection and jurisdiction-specific age assurance.
Choose an application host that also permits this business and commercial use;
none of these providers/accounts has been approved by this implementation.

### 1. Create the library and retrieve credentials (click-by-click)

1. Sign in at https://dash.bunny.net/; enable MFA, billing and account security.
2. Open **Stream** in the left navigation (not Storage or CDN).
3. Click **Add Video Library** / **Create Video Library**.
4. Enter a recognizable library name, e.g. `erobabe-staging`; choose storage regions
   and encoding resolutions based on your privacy, quality and cost requirements.
5. Create the library and open it from the Stream library list.
6. Open the library's **API** settings. Copy **Video Library ID** into
   `BUNNY_STREAM_LIBRARY_ID` (a positive numeric ID).
7. Copy/reveal the **Video Library API Key** for this exact library into
   `BUNNY_STREAM_API_KEY`. Do **not** use the global account key, Storage password,
   CDN key or a different library's key. Dashboard labels can change; the official
   [Stream API](https://docs.bunny.net/reference/video_getvideo) uses this key as `AccessKey`.
8. Keep credentials in a password manager/server secret store, never chat, Git,
   screenshots or `NEXT_PUBLIC_*` variables. Use separate staging/production libraries.
9. Open **Security** settings: ensure allowed domains/referrers permit your actual
   production apex and www domain and staging domain. Test using the real browser
   origin. Keep embed-token authentication off for this implementation (signed
   playback tokens are not implemented); upload signatures are **not** playback tokens.
10. For this version, use standard encoding rather than just-in-time encoding. Only
    documented status **4 (Finished)** publishes; statuses 7/8 intentionally wait.
    Verify no library setting prevents the documented iframe player from embedding.

### 2. Configure local and production environments

1. Copy `.env.example` to `.env.local`; add library ID/key and existing Supabase URL,
   publishable key and `SUPABASE_SECRET_KEY` (or service-role alias).
2. The application imposes no maximum video file size. Bunny Stream, the selected
   library/account, browser storage, and network may still enforce their own limits.
3. In your hosting dashboard open the application → **Settings → Environment
   Variables/Secrets**. Add the same variable names with the correct production
   library values, Production scope. Set separate values for Preview/Staging.
4. Remove all retired video-provider credentials, transport gates and relay jobs
   from deployment settings. None are read by the new application.
5. Configure server outbound HTTPS to `video.bunnycdn.com` and your Supabase project;
   browsers need `video.bunnycdn.com`, `iframe.mediadelivery.net`, player/CDN domains
   used by the selected library and Supabase thumbnail Storage. If using CSP, allow
   the Bunny iframe in `frame-src`, TUS in `connect-src` and local decoding/posters
   in `media-src blob:` / `img-src blob:`. Never add a server video relay.
6. Node.js 22.x hosting is required. New automatic local thumbnails use browser
   decoding/canvas, not server ffmpeg. The existing manual direct-media thumbnail
   tool requires an executable ffmpeg binary on a compatible Node host.
7. Redeploy/restart after environment changes; verify **Admin → System Health**.
   Bunny check performs read-only `GET /library/{id}/videos?page=1&itemsPerPage=1`.
   Missing configuration, authentication failure and successful connectivity are
   distinct. A separate lifecycle panel shows uploading, processing, ready, completed,
   reported failure/pause and thumbnail failures from recent private sessions;
   connectivity does not prove upload, processing, Storage or playback. Browser
   lifecycle reports are diagnostic only, never proof of readiness.

### 3. Apply the forward database migration

1. Back up the production DB and snapshot current provider/status counts and
   thumbnail URLs. Test against a staging copy first.
2. Ensure migrations 00–11 have already been applied, in order. Apply pending
   migrations 12 and 13 in order; do not edit or re-run applied history.
3. CLI: install the Supabase CLI; run `supabase init` if there is no local
   `supabase/config.toml` (this checkout does not include one). Run
   `supabase link --project-ref YOUR_PROJECT_REF`, then
   `supabase migration list` and `supabase db push --dry-run`. Review the pending
   migration list, then run `supabase db push`.
4. Dashboard alternative: **SQL Editor → New query**; run migration 12, then
   `supabase/migrations/00000000000013_bunny_background_encoding.sql`, exactly
   once each and in order. Track dashboard execution in your migration ledger
   before later CLI pushes; do not let the CLI re-apply either file. Do not run CLI
   and dashboard together.
5. Verify `bunny_uploads` has RLS enabled, no anon/authenticated privileges; only
   service role can write sessions and execute the staging/finalization RPCs.
6. Verify archived hosted records retain IDs, titles, descriptions, categories,
   URLs and thumbnails but are `unpublished`, `requires_reupload=true`. They are
   not silently transferred. The legacy recovery table is read-only; its old
   publication RPC is removed.
7. Verify `video-thumbnails` is public and restricted to image MIME types/10 MB.
   The existing storage helper creates it if missing. Video Storage is not used.
8. Deploy the app only after SQL succeeds. Roll back app code only with care: the
   retired uploader cannot finalize with the archived RPC removed. Prefer disabling
   uploads and a forward fix, not reactivating an obsolete integration.

### 4. Verify a genuine authorized staging upload

1. Sign in as an **active administrator** and open `/admin/videos/upload`.
2. Choose a category, click **Choose videos** or drag several local authorized
   MP4/WebM files. Include a short clip, black introduction, portrait clip and a
   longer clip. Use browser-decodable files; convert unsupported codecs locally
   before selecting. A MIME declaration alone cannot prove decodability.
3. Verify each automatically generated actual-frame preview; edit titles before
   Start uploads. No frame-selection or URL-import action is needed.
4. Open browser Developer Tools → **Network**, start the batch. Confirm actual
   POST/HEAD/PATCH TUS requests go to `https://video.bunnycdn.com/tusupload` with
   `AuthorizationSignature`, `AuthorizationExpire`, `LibraryId`, `VideoId` headers.
   There must be no file-byte POST to the app or Supabase.
5. Confirm real per-file byte progress and four bounded upload workers. After
   transfer, the row should appear as **Encoding** in `/admin/videos`; the next
   upload starts without waiting for Bunny's transcoder. Cancel a transfer,
   retry and briefly disconnect/reconnect the network. Reload and reselect the
   **same source**: existing metadata/session/video ID must be retained. TUS resume
   URLs are fingerprinted by library/video/file, not merely filename.
6. Confirm JPEG PUT goes to a signed Supabase `video-thumbnails` URL. Check final
   image is 1280×720. If decoding/storage fails, use Retry; publication is blocked,
   and already transferred video bytes are not sent again.
7. Verify **Encoding** separately from Uploading in `/admin/videos`. GET video
   reports Created=0, Uploaded=1, Processing=2, Transcoding=3, Finished=4, Error=5,
   UploadFailed=6, JitSegmenting=7, JitPlaylistsCreated=8. Only 4 completes processing; explicit admin review publishes.
   `storageSize` is encoded
   storage, **not** original byte count; original MIME/size come from the reserved
   local upload metadata, duration from Bunny `length`.
8. While Bunny encodes, inspect Supabase `videos`, `upload_jobs`, `bunny_uploads`:
   there is one private `processing`/Encoding catalog row and job per session. The
   admin list polls status in the background; after Finished=4, that same row/job
   becomes private pending_review/completed with the actual GUID, library/embed, MIME/size,
   duration, category and verified thumbnail. Review rights, consent, adult-performer records and moderation in Videos → Review & publish; provide evidence references before publication.
9. Check cards, admin lists, watch poster, OpenGraph/VideoObject thumbnail and
   play/pause/seek/fullscreen on desktop and mobile from the production domain.
   Playback iframe URL is `https://iframe.mediadelivery.net/embed/{LIBRARY_ID}/{VIDEO_ID}`.
10. Repeat confirmation and induce a DB failure after transfer; retry must save
    without creating another remote video, catalog record or upload job. Verify
    unsigned/non-admin calls receive 401/403.
11. Record video IDs, screenshots without secrets and results as live acceptance
    evidence. Passing mocked tests is not sufficient.

### 5. Recovery, failures and retention

- Thumbnail error: Retry thumbnail/processing/save. After reload, reselect the
  source; server metadata is restored. Frames are not sent to AI by default.
- Interrupted, failed or cancelled upload: reselect the same source file. The
  server finds the existing session for that administrator/filename/size/MIME
  and resumes it automatically (same server UUID and provider GUID, latest
  title/category applied); fresh authorization lasts 24 hours.
- Bunny video deleted in the Bunny dashboard before its upload finished:
  reselecting the file attaches one replacement video to the same session. If
  the upload was already saved to the video library, delete it in
  Admin → Videos first (stage/finish never re-point a catalog video to another
  provider video), then reselect the file. Bunny expires incomplete resources at the
  original authorization expiry or roughly 48 hours inactivity, whichever first.
  Re-signing does not extend a resource's original life. tus-js-client handles a
  missing expired resource by restarting transfer to the **same** video object.
- Finished but DB error: Check and finish or Retry; never re-upload video.
- Encoding takes a long time: upload workers are already free; the row remains
  **Encoding** and does **not** depend on this tab staying open. A scheduled
  sweep (`/api/cron/bunny-publish`, see "Background auto-publish" below) reads
  Bunny's status and publishes the video as soon as it reaches status 4, and
  `/admin/videos` shows the result whenever an admin next looks. Status
  5/6 is a provider failure; inspect provider diagnostics rather than pretending
  the transfer succeeded.
- Uncertain creation (timeout/lost response): creation is never replayed while
  the original request could still be running (2 minutes). After that,
  reselecting the file searches the session's library for the exact
  `[session:UUID]` title marker: exactly one match is attached to the session;
  no match means Bunny never created it, so one video is created; several
  matches are refused until the extras are deleted in the Bunny dashboard.
  Never fabricate an ID.
- Duplicate policy: same administrator/filename/size/MIME cannot reserve a second
  session; reselecting resumes the existing one. A file that already completed
  shows its existing video instead of uploading again. For genuinely different
  media sharing this tuple, rename the authorized file before starting. This is
  duplicate prevention, not a cryptographic proof of source identity. Renaming
  a partial source loses file matching and is not a resume workflow.
- Video deleted from the library, same file uploaded again: reselect the file —
  no rename is needed. A completed session whose catalog video was deleted (its
  `video_id` is NULL) can never publish again, so it is archived to `audit_logs`
  (`action = 'bunny_upload_session_cleared'`, with the file, title, library,
  provider GUID and slug it was published under) and dropped, which frees the
  file identity for one new session. That session creates a **new** Bunny video
  and, once it finishes, a **new** catalog row under the new session ID; the
  deleted video is never resurrected, re-linked or republished. Confirming the
  old session answers 409 instead of reporting a deleted video as published.
  Clearing is refused while any catalog row still points at the session ID or at
  its provider GUID — delete that video in Admin → Videos first. The deleted
  video's Bunny bytes stay retained per `media_retention`; review and delete them
  in the Bunny dashboard once retention approval allows it. In the upload queue,
  a finished entry can be removed (or the page reloaded) so the same file can be
  selected again without renaming it.
- Cancelling pauses local transfer, not deletion of provider media. Catalog deletion
  remains catalog/thumbnail-only. Review incomplete/orphan remote videos and delete
  confirmed unused objects manually in Bunny dashboard after retention approval.
  Completed session audit rows are kept, and retries cannot republish a
  subsequently deleted or moderated video: only an explicit reselection of the
  source file starts a new upload for it.

### 6. Background auto-publish (closing the tab is safe)

Bunny encodes long after the bytes are transferred, and the transfer only ever
runs in the administrator's browser. Publication must not depend on that tab,
so a server-side sweep finishes the job:

- `GET /api/cron/bunny-publish` reconciles every upload session that has not
  reached a terminal state (`uploading` with a stored thumbnail, `processing`,
  `ready`), applying exactly the same `stage_bunny_upload` /
  `finish_bunny_upload` / `fail_bunny_upload` RPCs the confirmation route uses,
  as the administrator who uploaded the file. A session the browser abandoned
  after storing its thumbnail is picked up too. The RPCs refuse to publish a
  completed session twice, so overlapping sweeps — and a still-open upload page —
  cannot create a duplicate.
- It never publishes a video whose frame is missing from storage: a session
  without a thumbnail is left alone, because only a browser that still holds the
  file can produce one.
- The route requires `Authorization: Bearer $CRON_SECRET` (constant-time
  comparison) or an active administrator session, so an operator can always
  trigger a sweep by hand. Anything else — a scheduler with the wrong secret, an
  anonymous visitor — is answered 401. With no `CRON_SECRET` configured only the
  administrator path works.

**Configure a scheduler — any host, any Vercel plan:**

> This repository ships **no `vercel.json` cron on purpose**. Vercel Hobby rejects
> cron jobs that run more than once a day and *fails the deployment* with
> "Hobby accounts are limited to cron jobs that run once per day". Scheduling from
> GitHub Actions instead keeps a five-minute sweep working on every plan, and
> works unchanged when the site moves off Vercel.

1. **GitHub Actions (recommended, works everywhere)** — the workflow
   `.github/workflows/publish-sweep.yml` runs every five minutes. Enable it with
   two repository secrets (**Settings → Secrets and variables → Actions →
   New repository secret**):
   - `SITE_URL` — the site's origin, e.g. `https://erobabe.com` (no trailing path)
   - `CRON_SECRET` — the same value set on the host (see below)

   Use **Actions → Publish finished uploads → Run workflow** to trigger a sweep
   immediately and confirm it works before relying on the schedule.

2. **System cron / any external scheduler** — self-hosted, Fly.io, Render,
   Railway, a crontab, cron-job.org, EasyCron, UptimeRobot, or a health pinger:

   ```
   */5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/bunny-publish >/dev/null
   ```

3. **Vercel Cron (only on a plan that allows sub-daily crons)** — add a `crons`
   entry to `vercel.json` pointing at `/api/cron/bunny-publish` with
   `"schedule": "*/5 * * * *"` and redeploy. Do **not** add this file on Hobby: it
   breaks the deployment. Prefer options 1 or 2.

**Set the secret on the host first:** `CRON_SECRET=<openssl rand -hex 32>` in the
hosting environment, then redeploy so the route can see it. Admin → System Health
shows "Background auto-publish", including how many sessions are waiting for a
sweep.

Verify it by hand (no video is published twice; the sweep is idempotent):

```
curl -i -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/bunny-publish
```

The JSON summary lists `checked`, `published`, `processing`, `failed` and
`errors` counts plus a per-session `results` array; a session that could not be
checked is reported with its reason and retried on the next run. A 401 means the
secret is missing or wrong. Without a scheduler, nothing is lost — the upload
page still polls while it is open — but an encoding that finishes after the tab
is closed stays **Encoding** until a sweep (or an administrator confirming that
session) runs.

### 7. Legacy media migration report/workflow

No hosted media bytes have been migrated in this change; there are no live DB or
provider credentials here. Obtain counts with:

```sql
select provider, status, requires_reupload, count(*) from public.videos
 group by provider, status, requires_reupload order by provider, status;
select id, slug, title, category_id, provider, provider_file_id, thumbnail_url
 from public.videos where requires_reupload order by created_at;
```

In **Admin → Videos**, archived rows link to the existing uploader. Retrieve only
source files you are authorized to use from your own archive/provider-supported
export. Re-upload locally to Bunny, preserving title/category and reviewing the
new thumbnail. After real playback verification, transfer any curated description,
tags/rights relationships through an authorized metadata maintenance process,
record the old→new catalog ID mapping and retain the archived row for audit. No
legacy URL fallback, automatic remote import, fake Bunny GUID or deletion occurs.
Existing direct-media records keep native playback. Known YouTube/Vimeo historical
player formats retain restrictive iframe playback; untrusted generic iframes are
not executed. Review historical generic embeds and re-upload authorized sources.

### 8. Optional consent-gated vision ranking

Local ranking is complete and reliable without OpenRouter. To optionally enhance:

1. Verify your chosen model in OpenRouter's live model catalogue lists **image**
   input; do not reuse a text model by assumption. No model slug is preselected,
   including any unverified DeepSeek example. The code checks live capability
   before transmitting frames.
2. Obtain permission for the specific provider/model to process your intended
   content, privacy and data handling; no provider approval is implied here.
3. Set server-only `OPENROUTER_API_KEY`, `OPENROUTER_THUMBNAIL_MODEL`, and the
   explicitly approved `OPENROUTER_THUMBNAIL_PROVIDER` slug. Routing is pinned to
   that provider with fallbacks disabled and data collection denied.
4. Only after approval, set **both** `OPENROUTER_THUMBNAIL_ENABLED=true` and
   `OPENROUTER_THUMBNAIL_CONTENT_APPROVED=true`. Leave false otherwise.
5. Only up to four actual low-resolution candidate JPEGs are transmitted. The AI
   returns a candidate index; it cannot invent a scene. API/model/content rejection,
   quota failure, timeout or invalid output falls back to the deterministic local
   winner without blocking upload. Images and upstream error bodies are not logged.
6. Disable either flag to stop external ranking. Existing text metadata AI remains
   a separate, unchanged feature.

Official implementation references: [TUS](https://bunny.net/docs/stream/tus-resumable-uploads),
[Get Video](https://docs.bunny.net/reference/video_getvideo),
[pre-signed upload announcement](https://bunny.net/blog/bunny-stream-introducing-pre-signed-and-resumable-uploads/),
[video guidelines](https://docs.bunny.net/docs/stream-best-practices).

## D2. Video admin tools (migration 00000000000010)

Apply `supabase/migrations/00000000000010_admin_video_tools.sql` before deploying
this release. It adds:

- `videos.carousel_position` (1–3): the three homepage hero cards, managed from
  **/admin/videos → Homepage carousel**. If no slot is filled, the homepage shows
  the default artwork.
- `videos.source_key` and an index: used by the duplicate-upload detector.

**Existing manual frame tools.** Direct-media records without thumbnails can use
/admin/videos “Generate thumb” / bulk “Generate thumbnails”. This captures actual
frames via bundled ffmpeg (`@ffmpeg-installer/ffmpeg`, linux-x64) and stores 1280×720
JPEGs. `next.config.mjs` traces the binary for `/api/admin/videos/thumbnails`;
`FFMPEG_PATH` optionally selects another executable. This is independent of the
new automatic local-frame pipeline described in section D. Embed pages cannot be
used as source videos. Existing manual thumbnail/category/carousel tools remain.

**Homepage carousel copy (migration 00000000000020).** Apply
`supabase/migrations/00000000000020_carousel_ai_copy.sql` to store the two short
lines the homepage card prints. When an admin assigns a carousel slot, the admin
API asks OpenRouter for a headline of at most 5 words and a description of at most
10 words (`videos.carousel_title`, `videos.carousel_description`) instead of
printing the search-optimised listing title. The slot card and the table row in
**/admin/videos** show that copy, with **Regenerate copy** to run it again. If
`OPENROUTER_API_KEY` is missing or the model answers unusably, the listing text is
shortened to the same budget, the slot is still saved, and the row says a fallback
was used. Clearing or taking over a slot clears the copy with it.

**Duplicate protection.** The uploader now reserves a private session and a unique
administrator/filename/size/MIME tuple. There is no URL publisher, override gate,
“Publish anyway”, remote import or retired-provider fallback. `source_key` is
historical metadata, not a current URL-upload option.

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
| `BUNNY_STREAM_LIBRARY_ID` | Selected Video Library ID | No | Stream → Library → API | Server env | uploads/playback | Section D | Yes |
| `BUNNY_STREAM_API_KEY` | Selected Video Library API Key | No | Stream → Library → API | Hosting secrets | uploads | Section D staging upload test | Yes |
| `CRON_SECRET` | Shared secret the publish scheduler presents to `/api/cron/bunny-publish` (auto-publish after encoding, without a browser) | No | Any long random string (`openssl rand -hex 32`) | Hosting secrets **and** the GitHub Actions secret of the same name | prod | Admin → System Health → "Background auto-publish" says "Scheduler can authenticate"; `curl -i -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/bunny-publish` returns a JSON summary, not 401 | Yes |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI metadata suggestions | No | https://openrouter.ai/keys → Create key | Hosting secrets | prod (optional) | Test via System Health → Test OpenRouter, or `/api/metadata/suggest` as admin | Yes |
| `OPENROUTER_MODEL` | OpenRouter model slug (the preferred route) | No | `nvidia/nemotron-3-ultra-550b-a55b:free` (default) | Hosting env | prod (optional) | Check https://openrouter.ai/models for the slug | No |
| `OPENROUTER_FALLBACK_MODELS` | Comma/space-separated routes tried, in order, when the preferred route stops answering | No | Unset → `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-super-120b-a12b:free`; set empty for the preferred model only | Hosting env | prod (optional) | Admin → System Health lists the chain and any benched route; `Waiting for AI title: openRouter did not answer in time` means the chain ran out — check the slug and the account's free-tier quota | No |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | First-attempt output-token cap for one metadata suggestion | No | `512` (default) | Hosting env | prod (optional) | Raise only if suggestions are truncated | No |
| `VIDEO_TITLE_STYLE` | Voice of generated listing titles | No | `explicit` (default); `editorial` for the older euphemistic voice | Hosting env | prod (optional) | Generated title names the act in the explicit voice and stays non-graphic in the editorial voice; both keep the same age/consent guardrails | No |
| `RESEND_API_KEY` | Resend API key | No | https://resend.com → API Keys | Hosting secrets, Supabase SMTP password | prod | Test via contact form | Yes |
| `RESEND_FROM_EMAIL` | Sender email, must be from verified domain | No | Your verified domain email | Hosting env | prod | Must be verified in Resend | Yes |
| `SUPPORT_EMAIL` | Support inbox for notifications | No | Your support email | Hosting env | prod | Receives ticket emails | Yes |

**Security**: Never place `SUPABASE_SECRET_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `BUNNY_STREAM_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY` in `NEXT_PUBLIC_*` variables. They must be server-only. Check build output for accidental exposure.

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
- [ ] Device uploads at `/admin/videos/upload` → multiple local files, real progress, local thumbnails and verified completion.
- [ ] Choose a category, review editable filename-derived titles and generated thumbnails before upload. Existing metadata suggestion tools remain independent.
- [ ] Verified Bunny Finished (4) plus stored thumbnail and atomic finalization creates private pending_review content; explicit rights/moderation review then sets published/public/cleared/approved. Unconfirmed sessions never appear publicly.
- [ ] Close the upload tab while a file is still **Encoding** → within one sweep interval the video is published and appears public in `/admin/videos` without anyone confirming the session. Verify with `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/bunny-publish`; a missing or wrong secret makes that URL answer 401.
- [ ] Queue several files at once, then pick a category → titles are drafted for every file from a handful of `/api/metadata/suggest` requests, no "too many metadata requests in a row" notice appears, and no queue entry is left waiting on the model.
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
- [ ] Provider-approved authorized staging test procedure (no live charge without separate explicit authorization): signed NOWPayments IPN arrives → payment `confirmed`, invoice paid, campaign `pending_review` or `active` if the creative is approved
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
- [ ] Bunny device upload publishing, category/metadata/duplicate handling and required automatic thumbnails work with an active staging administrator
- [ ] Historic retired-provider records remain intact and show an unsupported message; no API calls occur
- [ ] Bunny Stream has passed section D authorized live acceptance
- [ ] Before launch: genuine device upload, accurate byte progress, verified completion/readiness, stable embed playback and failure/cancellation/idempotency tests all pass
- [ ] Bunny jobs never expose keys or upload authorization publicly

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
2. If Bunny Stream is unavailable, keep failed sessions for reconciliation. Do not create a duplicate or proxy video bytes through the app server.
3. Stored embed identities remain stable, but a provider outage, deletion or security restriction can still prevent playback

---

## Unresolved Provider Approvals and Blockers

1. **Bunny account/content-use confirmation**: AUP is conditional, not evidence this catalogue/account is approved. Obtain support/legal confirmation.
2. **Live acceptance**: authorized staging credentials, forward migration, real TUS upload, generated thumbnail storage, Finished status and desktop/mobile playback must be verified. Automated tests do not prove live Bunny functionality.
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

# Prove the background publish sweep (auto-publish without a browser)
curl -i -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/bunny-publish
curl -i https://your-domain/api/cron/bunny-publish   # expect 401
```


## October 14 audit rollout addendum — mandatory

1. Stop new bookings/uploads during schema rollout. Back up DB and Storage metadata; restore and test the backup in an isolated staging project. Run `docs/LAUNCH_PREFLIGHT.sql`. Resolve overlaps and unsafe historical records deliberately; migrations do not silently delete or relabel payment history.
2. Verify applied migration history. Apply only unapplied SQL in order: **14 launch_integrity**, **15 measured_events**, **16 video_review_and_retention**, **17 operator_actions**, **18 payment_recovery**. Do not edit/reapply 00–13. Migration 14 restricts browser permissions immediately; deploy matching application code in the same maintenance window. All five have transaction wrappers. Use the Supabase CLI's reviewed migration process so migration history stays accurate; dashboard execution alone does not populate CLI history automatically.
3. Backfill/review historic confirmed payments before enabling ads. `eligible_ads` now requires paid/approved/associated/in-date/active-account records. Legacy provider records are retained, not automatically trusted by a new checkout. Current migration 14 adds one-hour holds to existing campaign rows; reconcile pending invoices before exposing inventory. Campaign dates use **[start_date,end_date)** in UTC; a month is the existing 30-day product definition.
4. Use Node **22.x**, `npm ci`, and the full commands in PRODUCTION_READINESS.md. Lint now uses supported ESLint CLI directly. FFmpeg remains packaged for manual direct-media thumbnails; deployment must permit executable binaries and outbound media requests. No video bytes pass through Next/Supabase.
5. Set NEXT_PUBLIC_SITE_URL to the approved HTTPS domain. SITE_URL is not a runtime environment variable. Register `/auth/callback` and `/auth/callback?next=/auth/update-password` for both staging and production Auth redirect allowlists; test PKCE verification/recovery emails from a real inbox. Never use wildcard production redirects.
6. Choose BUNNY_UPLOAD_MAX_BYTES to match operational/provider budget; server and browser validate declared size. Confirm provider-side enforcement of actual bytes separately. Signed TUS authorization currently lasts 24h; previously issued credentials cannot be instantly revoked merely by suspending the app account. Document provider/key-revocation incident procedure.
7. Configure a dedicated random ANALYTICS_HASH_SECRET (server-only, preferably 32+ random bytes). The service credential is a fallback. The trusted reverse proxy **must overwrite x-real-ip**. Without a trusted client IP, fallback clients share an abuse budget. Bot/WAF and multi-instance acceptance are launch gates, not supplied by browser events. Schedule `select public.prune_measured_events();` daily under a service/DB operator identity: 7-day pseudonymous events, 2-day rate-key retention. Campaign totals remain after pruning. Impressions mean loaded creative >=50% visible for 1s in a foreground tab; watch-page views mean 5 foreground seconds, not proven playback. Counts are deduplicated (ad type/campaign/creative/visitor/hour; video/visitor/day) and not independently audited human traffic.
8. Pending checkout recovery: **do not create a second provider request after a timeout**. The local invoice/order and claimed campaigns exist before the provider call. In Admin → Payments, locate that exact invoice in NOWPayments and enter its real provider payment ID under Recover missing provider reference. The server re-fetches and compares order/asset/fiat identity before binding, then runs normal verification. A late payment after hold expiry is recorded paid but its campaign stays cancelled, requiring a reviewed refund/rebooking decision. Failed/expired/refunded outcomes atomically update invoices/campaigns. Do not fix mismatches by manually setting `payments.status='confirmed'`.
9. The ad-creatives bucket is provisioned with image MIME/10MB limits. Browser object overwrite/deletion is denied; creative edits must submit new media for review. Pending assets in this public bucket are accessible by exact object URL; select/implement private premoderation storage if required by your content/data policy before accepting untrusted uploads. MIME declarations alone are not byte-level content scanning.
10. Catalog deletion now creates a durable **media_retention** record (visible in System Health) in the same transaction. Review legal retention/backups, match provider/library/GUID to the deleted catalog record, and obtain two-person deletion approval. Retain or delete the exact remote object in the provider dashboard; verify provider outcome independently, then update that queue row to `retained` or `deleted` with `reviewed_at=now()` and record the change ticket in the operator audit. Never bulk-delete by title or erase the queue to hide billing inventory. No remote deletions were made in this audit.
11. Roll back application code only with compatible schema permissions; do **not** restore permissive advertiser RLS to make old checkout code work. A failed migration transaction rolls back itself. For post-rollout issues, disable writes and use forward fixes; database restore is a separately approved disaster-recovery operation, tested on staging first.


## October 15 payment-recovery follow-up — mandatory

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
2. Configure dedicated server-only `ANALYTICS_HASH_SECRET` and existing `SUPABASE_SECRET_KEY` (never a `NEXT_PUBLIC_*` secret). Set the same `CRON_SECRET` and canonical `SITE_URL` in the GitHub Actions secrets for both Bunny publish and recommendation retention jobs.
3. Confirm `.github/workflows/recommendation-retention.yml` is enabled, run it manually, verify `/api/cron/recommendation-retention` returns 2xx only with the secret, and verify expired rows are removed. It runs daily; cleanup failure is a privacy incident. The retention RPC removes event rows older than 30 days and feedback/profile rows after their 180-day lifetime.
4. Stage the opt-in flow, profile cookie attributes, disable/reset deletion, feedback suppression, no-consent browsing, API origin/rate validation, and no-store cache headers. Confirm recommendation tables are inaccessible to `anon` and `authenticated` and only trusted server RPCs can write.
5. Run `EXPLAIN (ANALYZE, BUFFERS)` against a representative staging catalog for latest, category, like, popularity and tag candidate queries. No production query plan or p95 value is available from this session. Do not report the documented 250 ms/150 ms targets as measured.
6. Verify Bunny Player.js `ready/play/timeupdate/ended/error` events and direct `<video>` milestones against a real approved staging Bunny video and direct-file clip. Confirm external player script/privacy policy; no actual account credentials or live media acceptance were available here.
7. Confirm user-facing privacy copy, 18+ controls, legal age assurance, rights/moderation review and adult-content provider approval with the responsible privacy/legal/operator owners. The current localStorage age declaration is not remote age verification.

See `docs/RECOMMENDATION_PRIVACY.md` and `docs/RECOMMENDATION_ALGORITHM.md` for retention boundaries, signals, configuration, evaluation targets and known pagination limitations.
