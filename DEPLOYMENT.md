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

Everything in this section is verified against Bcon's published API documentation
(https://bcon.global/integrations/api/, checked 2026-10-11) and the code in `lib/bcon/`.
Bcon publishes **no store-write endpoint**, so callback URLs are configured by hand in the
Bcon dashboard; the application can only read the store back and report what it finds.

### 1. Create/configure the provider account
1. Go to https://bcon.global → **Sign Up**.
2. Complete KYC if required.
3. Create a **Store** (the dashboard calls stores "Merchants" / "merchant-platforms").
   One store can serve several blockchains — you do not need one store per chain. For this
   launch create a single store for the token/network you actually want to accept
   (e.g. USDT on Ethereum).
4. The store's generated API keys appear under **Created Store Settings → Copy Generated
   Keys** (step 4 below).

### 2. Configure the authorized receiving wallet
1. Bcon dashboard → **Merchants** (Stores) → select the store → **Settings**.
2. Under **Wallet**, enter the receiving wallet address for the chain you will accept
   (e.g. an Ethereum address for USDT-ERC20).
3. Bitcoin requires a receiving address or an xpub — fill it only if you intend to accept BTC.
4. Click **Save**.

### 3. Choose the enabled token and network
1. Store Settings → **Currencies**: enable only the token(s) you will accept (e.g. USDT on Ethereum).
2. Set `BCON_CHAIN` to the matching chain name — one of `ethereum`, `tron`, `binance`,
   `bitcoin`, `solana`.
3. Set `BCON_PAYMENT_CURRENCY` to the token ticker, e.g. `USDT`.

### 4. Find the API credentials
1. Store Settings → **Copy Generated Keys**.
2. Copy the key belonging to the chain you are enabling (each configured chain has its own key).
3. Set it as `BCON_API_KEY` — server-side only, never a `NEXT_PUBLIC_*` variable.
4. Optional: set `BCON_CALLBACK_URL` to pin the exact callback URL the app reports
   (`https://erobabe.vercel.app/api/bcon/callback`). It is only honoured when it is an
   absolute URL ending in `/api/bcon/callback`; otherwise it is ignored and the URL is
   derived from `NEXT_PUBLIC_SITE_URL`.

### 5. Configure the callback URL — one URL per blockchain (click-by-click)

A Bcon store stores **one callback URL per blockchain**, not a single shared one. The store
payload exposes them as `callback_url` (BTC), `callback_url_bnb` (BNB) and
`callback_url_<code>` for every other configured chain, and Bcon's validation messages use
the form paths `callback_url.btc`, `callback_url.bnb`, and so on.

1. Sign in at https://bcon.global and open **Merchants** (Stores) in the dashboard menu.
2. Click the store you created, then open its **Settings**.
3. Scroll to the callback section. It contains one callback input per blockchain the form
   knows about. Bcon's docs state a store "by default returns information on BTC and BNB
   even if they are empty", so expect BTC and BNB callback inputs plus one per chain you
   enabled — the exact set is shown by the form (and named by its validation errors).
4. Type the raw URL below into **every** callback input the form shows, exactly as written
   — no quotes, no Markdown (`[label](url)`), no JSON, no arrays, no trailing spaces, no
   line breaks:

   ```
   https://erobabe.vercel.app/api/bcon/callback
   ```

   On a different domain, use `https://YOUR_DOMAIN/api/bcon/callback` — the exact value the
   app shows at the top of Admin → System Health → **Bcon store — per-chain callback URLs**.
5. Leave a callback input empty **only** if you also disable that blockchain in the same
   form (disabling removes the input and its validation). Never save the form with a
   rendered callback input left blank.
6. Scroll down and click **Save**.
7. If validation fails, read the field names in the message and fill exactly those inputs.

#### Understanding `The callback_url.btc must be a string. (and 2 more errors)`

This message comes from **Bcon's own dashboard form validation, not from this application**.
It is the standard Laravel "value is present but not a string" wording: the input was
submitted as `null` — i.e. it was left empty. `callback_url.btc` is the BTC callback input,
and "(and 2 more errors)" means two further inputs (typically `bnb` and one more chain the
form rendered) were empty in the same submission.

* Which inputs the form renders is not exposed by the Bcon API — read the field names off
  the error output itself (`callback_url.btc` plus the "2 more errors" it mentions) and fill
  exactly those inputs.
* Note: Bcon also returns BTC/BNB entries with `callback_url: null` for stores that simply
  do not accept those chains (its own docs show such a store). An empty value therefore
  means "not configured"; it only becomes a blocker when the form renders that input and
  refuses to save it empty.
* Fix: type the URL into every callback input the form renders (step 4 above), or disable
  the chain so its input disappears, then save again.
* Do **not** paste a JSON object, an array, or quote-wrapped text into these inputs, and do
  not paste the URL into unrelated fields (wallet, tag, name). Each callback input accepts a
  plain URL string only.
* No code change can fix this: Bcon exposes no endpoint that writes store configuration, so
  the empty dashboard field can only be corrected in the dashboard.

#### Verify what Bcon has actually stored

Admin → System Health → **Bcon store — per-chain callback URLs** calls
`GET https://external-api.bcon.global/api/v1/stores/get_store` with `BCON_API_KEY` and, for
every chain Bcon returns, shows the registered callback URL (`empty — this is the field
Bcon rejects`, `matches this deployment`, or the wrong value). A chain Bcon does not return
at all is labelled **unverified** — never "working".

Reference: verified API shape (https://bcon.global/integrations/api/, 2026-10-11)
* Store fields: `callback_url` (BTC), `callback_url_bnb` (BNB), `callback_url_<code>` for
  each other configured chain, plus a `chains[]` array whose entries each carry `chain`,
  `code`, `api_key`, `callback_url`, `address`/`xpub`.
* Callback request: `status` (0 = unconfirmed, 1 = partially confirmed, 2 = confirmed),
  `addr`, `value` (satoshis for BTC), `txid`, `external_id` (plus `memo` on BNB).
* "A callback succeeds when the server returns 200 HTTP status."

### 6. What the application does with a callback

Bcon documents no callback signature, so none is invented. `/api/bcon/callback` treats every
parameter as untrusted and:

1. Answers a parameter-less probe with HTTP 200 without touching any payment record.
2. Finds the payment by `external_id`, then requires the callback `addr` to equal that
   payment's stored `payment_address` (EVM chains compared case-insensitively).
3. Treats only `status=2` / `confirmed` as a confirmation claim; `0` and `1` are recorded as
   `unconfirmed` / `partially_confirmed` and never mark a payment paid.
4. Re-checks the claim against Bcon's own record —
   `GET https://external-api.bcon.global/api/v1/transactions/<txid>` — and requires the
   transaction to exist, to be `confirmed`, to point at the same payment address, to use the
   same currency, and its `sum` to match `expected_amount` within 2%.
5. Stays idempotent: a payment already `confirmed` is never confirmed twice, and a non-200
   answer makes Bcon retry.
6. Fails closed. Unknown txid, address or currency mismatch, a missing amount, or an
   unreachable Bcon API leave the payment unconfirmed and write an audit entry
   (`bcon_callback_transaction_unverified`, `bcon_callback_address_mismatch`,
   `bcon_callback_currency_mismatch`, `bcon_callback_amount_unverified`,
   `bcon_callback_underpaid`, `bcon_callback_overpaid`).
7. Answers HTTP 200 for everything it has fully processed — including under/over payments,
   which stay unpaid for human review — and a non-200 status only when a retry of the same
   callback could still change the outcome: 400 for invalid/unverifiable notifications
   (including a txid Bcon does not yet report) and 503 while Bcon's API is unreachable.

Consequence: a hand-crafted callback URL typed into a browser cannot confirm a payment any
more. Confirmation requires a transaction that Bcon itself reports as confirmed for that
address and amount.

### 7. Test callback reachability safely (no money, no payment records touched)

1. Admin → System Health → **Bcon store** → **Test callback reachability**: performs a real
   HTTPS GET of the callback URL from the deployment and reports the status code. Bcon
   treats HTTP 200 as a successful callback.
2. Or from any machine:
   ```bash
   curl -i https://erobabe.vercel.app/api/bcon/callback
   ```
   Expect `HTTP/2 200` and `{"status":"ok","message":"Bcon callback endpoint is reachable"}`.
3. Bcon's dashboard **Merchants → Test Payments** page (API equivalent
   `POST https://external-api.bcon.global/api/v1/test`) can generate a fake transaction for
   the store. It proves Bcon can reach the URL and is recorded as `unknown_payment` (or
   rejected by verification) for review — it does **not** confirm a real payment, because no
   matching payment row/address exists. Never treat a test payment as money received.

### 8. Process a genuine test payment end to end

1. Sign in to the deployed site with a test advertiser account and create the smallest
   checkout you are willing to pay for (the current minimum is one $99 slot for one month —
   there is no fabricated sandbox amount).
2. The checkout shows the exact amount, token, network and receiving address. Send exactly
   that amount from your own wallet on the matching network; a different token or network
   will not confirm.
3. Wait for confirmations (Bcon reports `confirmed` after 2 confirmations).
4. Expected result: Bcon calls `/api/bcon/callback` → the route verifies the payment row and
   Bcon's transaction record → `payments.status = 'confirmed'` with `confirmed_at` set, the
   invoice becomes `paid`, `payment_events` gains `callback_received`, `transaction_verified`
   and `confirmed`, and the campaign becomes `active` (creative approved) or `pending_review`.
5. Verify: Admin → System Health shows the store healthy, Admin → Logs shows
   `payment_confirmed`, and the advertiser's campaign page shows the activated campaign.

### 9. Diagnose missing callbacks, unconfirmed payments and wrong callback values

| Symptom | Where to look | What to do |
|---|---|---|
| Bcon form still says `callback_url.btc must be a string` | The Bcon dashboard form | One or more callback inputs were submitted empty. Fill every rendered callback input (step 5) or disable the chain, then save. |
| System Health shows **Callback incomplete** | System Health → Bcon store table | The `Registered value` column says `empty`; paste the URL shown at the top of that panel into that chain's field in Bcon and save. |
| System Health shows **Callback mismatch** | Same table | The chain points at another deployment (often an old preview URL). Replace it with the URL shown at the top of the panel. |
| System Health shows **Unreachable** | Same panel | `BCON_API_KEY` missing/invalid or the Bcon API cannot be reached; the panel prints the HTTP status. |
| Payment stays `awaiting_confirmation` after a real payment | `payment_events` and `audit_logs` for that payment | `callback_received` = Bcon reached us. `verification_pending` + HTTP 503 = Bcon's API was unreachable, Bcon retries. `verification_failed` / `bcon_callback_transaction_unverified` = Bcon has no such txid. `amount_unverified` / `amount_mismatch` = amount evidence missing or mismatched (`underpaid`/`overpaid`). |
| `unknown_payment` | `audit_logs.action = 'bcon_callback_unknown_payment'` | The callback matched no `external_id`/address — usually a Bcon **Test Payment** (expected) or a callback from another/older store. |
| Nothing arrives at all | Bcon dashboard callback field(s) | Bcon never called us: the URL is missing or wrong on the store, or the payment has not reached the confirmation threshold. Confirm with steps 5 and 7. |

Never mark a payment `confirmed` by hand unless you independently verified the transaction
in Bcon or on a blockchain explorer first — see "Rollback and recovery" below.

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
   5. The browser posts only `{ providerFileId, thumbnailPath, categoryId, fileName }` to `POST /api/videos/upload` (a few hundred bytes). That route generates Groq metadata and creates the video record.
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

## E. Groq Setup

1. Go to https://console.groq.com → **API Keys** → **Create API Key**
2. Copy key (starts `gsk_...`) — this is `GROQ_API_KEY` (server-only, never expose to browser)
3. Set env: `GROQ_API_KEY=gsk_...`, `GROQ_MODEL=llama-3.1-8b-instant` (or current recommended model per docs)
4. Test: go to `/admin/videos/upload`, choose a category and source, then publish. The server must generate title, description, and tags with Groq before it creates the video record.
5. If Groq is not configured or returns incomplete metadata, publishing stops with a clear error; title, description, and tags are intentionally not browser-editable in this workflow.
6. **Important**: Never send video bytes, private rights docs, payment records, or personal info to Groq. Only the source filename/URL path and selected category are sent for metadata generation. AI output is not proof of rights, age, consent, or factual attributes.

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
   - Payment confirmation — requires a real confirmed Bcon transaction (see section C.8); a hand-made callback no longer confirms a payment, so use a genuine (smallest) payment or the automated tests instead
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
6. **Callback endpoints**: `https://YOUR_DOMAIN/api/bcon/callback` must be reachable via HTTPS and must answer HTTP 200 to a parameter-less GET (that is what the Bcon callback probe expects). It is public by design and excluded from the auth middleware. On the Bcon store, the same URL has to be entered in every per-chain callback field — see section C.5.
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
| `BCON_API_KEY` | Bcon Global API key of the store that receives the payments | No | Bcon Dashboard → Merchants → store → Store Settings → Copy Generated Keys | Hosting secrets | prod | `stores/get_store` in Admin → System Health resolves the store; also used by `/api/bcon/create` and callback verification | Yes |
| `BCON_CALLBACK_URL` | Optional pin for the callback URL the app reports/verifies (must be an absolute URL ending in `/api/bcon/callback`) | No | Your domain | Hosting env | prod (optional) | Admin → System Health shows `URL source`: `BCON_CALLBACK_URL`; an invalid value is reported as a config warning and ignored | Yes |
| `BCON_CHAIN` | Blockchain for payments | No | Choose: ethereum, tron, binance, bitcoin, solana | Hosting env | prod | Matches the chain enabled on the Bcon store | Yes |
| `BCON_PAYMENT_CURRENCY` | Token ticker (USDT, USDC, BTC) | No | Bcon store currencies | Hosting env | prod | Must be enabled in the Bcon store; verified against the currency Bcon reports in the transaction record | Yes |
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
- [ ] Video publisher at `/admin/videos/upload` → upload multiple local files, paste a public iframe source, or import one or more public direct-video URLs to Uqload
- [ ] Choose only a category and optional thumbnail; title, description, and tags are generated server-side by Groq before publishing
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
- [ ] Payment request creation at `/api/bcon/create` → verifies session, trusted slot price, prevents overlapping, creates pending invoice and short unique Bcon external_id, returns address, amount, token, network
- [ ] Checkout UX: shows exact amount, USD equivalent, ticker, network, address, QR, copy button, expiration, pending status, instructions for correct network
- [ ] Callback reachability probe: `curl -i https://YOUR_DOMAIN/api/bcon/callback` → HTTP 200 `{"status":"ok",…}` and no row written to `payments` / `payment_events`
- [ ] Synthetic confirmation attempt (must NOT confirm): `GET /api/bcon/callback?external_id=<real id>&addr=<real address>&txid=0xnotreal&value=99&status=2` → HTTP 400, payment stays `awaiting_confirmation`, `audit_logs` gains `bcon_callback_transaction_unverified`. Only a transaction Bcon itself reports as `confirmed` (`GET /api/v1/transactions/<txid>`) can move a payment to `confirmed`.
- [ ] Genuine payment (real funds, smallest checkout): Bcon callback arrives → payment `confirmed`, invoice paid, campaign `pending_review` or `active` if the creative is approved
- [ ] Duplicate callback with same txid → `already_processed`, no duplicate ledger entries
- [ ] Campaign approval: admin approves creative → campaign becomes active, appears on public site if slot active and schedule valid
- [ ] Billing history at `/advertiser/payments` → real payments, no fake
- [ ] Invoices at `/advertiser/invoices` → real invoices
- [ ] Campaign expiration: after end_date, campaign should not show on public site
- [ ] Profile at `/advertiser/profile` → real data, own only
- [ ] Support ticket at `/advertiser/support` → persisted, email sent if Resend configured

**Bcon:**
- [ ] Empty/parameter-less probe → 200 `{"status":"ok"}`, nothing written
- [ ] Malformed callback (no addr, no external_id) → 400
- [ ] Duplicate callback → 200 `already_processed`, no duplicate ledger entries
- [ ] Unknown payment reference → 200 `unknown_payment`, audit row written, not silently discarded
- [ ] Callback claiming `status=2` whose txid Bcon does not report as confirmed → payment stays unconfirmed (400, audit row)
- [ ] Callback `status=1`/`0` → recorded as `partially_confirmed`/`unconfirmed`, never paid
- [ ] Incorrect amount → `underpaid`/`overpaid`, not confirmed, audit row
- [ ] Wrong address, currency or network → rejected with the matching audit action
- [ ] Bcon transaction API unreachable → HTTP 503 (Bcon retries), payment untouched
- [ ] Repeated/duplicate transaction → idempotent, `confirmed` event exists exactly once
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
1. Check `payment_events` for the payment (`callback_received`, `verification_failed`, `amount_mismatch`, `confirmed`).
2. Check `audit_logs` for `bcon_callback_unknown_payment`, `bcon_callback_transaction_unverified`,
   `bcon_callback_address_mismatch`, `bcon_callback_currency_mismatch`,
   `bcon_callback_amount_unverified`, `bcon_callback_underpaid`, `bcon_callback_overpaid`.
3. Use Admin → System Health → Bcon store → **Test callback reachability** to prove the URL answers 200.
4. Only if the transaction exists on-chain *and* Bcon reports it as confirmed
   (`GET https://external-api.bcon.global/api/v1/transactions/<txid>` with `BCON_API_KEY`),
   reconcile manually:
```sql
update payments set status='confirmed', transaction_id='<txid>', confirmed_at=now() where external_id='...';
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
