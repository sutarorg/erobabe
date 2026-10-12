# GO_LIVE_CHECKLIST.md — Erobabe Operational Requirements Before Launch

This checklist lists all external decisions, approvals, and configurations that must be resolved before commercial launch. Do not mark as complete unless actually verified.

**Date**: October 10, 2026  
**Status**: Draft — many items blocked pending owner/provider approval

---

## 1. Legal and Business Identity (Owner must provide)

- [ ] **Legal name of operator**: e.g., company name, registration number, jurisdiction. Currently placeholder — do not publish fictional identity.
- [ ] **Business address**: Real, verifiable address for Terms, Privacy, DMCA agent.
- [ ] **Contact emails**: Real support@, contact@, removal@, legal@ — must be from verified domain, not .example.
- [ ] **Terms of Service**: Draft in `/terms` requires legal review by counsel. Remove amber warning only after review.
- [ ] **Privacy Policy**: Draft in `/privacy` requires legal review, GDPR/CCPA compliance check.
- [ ] **Age verification procedures**: Document how performer age and consent verified, 18 U.S.C. §2257 or equivalent record-keeping if applicable.
- [ ] **Content removal workflow**: Verify 24–48h response SLA, confirmation emails, audit logging.
- [ ] **DMCA agent**: If US, register DMCA agent, publish contact.
- [ ] **Tax and invoicing**: Verify invoice numbering, tax handling for $99 payments.

---

## 2. Video Hosting (UFOLOAD) — CRITICAL BLOCKER

- [ ] **UFOLOAD written approval**: UFOLOAD's Terms of Service (https://ufoload.com/tos,
  draft v0.1 dated 2026-10-11) prohibit unlawful, infringing, malware, violence and
  non-consensual material and reserve discretionary enforcement, but do not contain an
  explicit adult-content clause. Obtain written confirmation from `contact@ufoload.com`
  that **lawful adult content, commercial use, API uploads and embedded playback** are
  permitted on this account, and keep the reply on file with its date and contact.
  - If approval obtained: set `UFOLOAD_API_KEY`, `UFOLOAD_ADULT_CONTENT_APPROVED=true`,
    `VIDEO_PROVIDER=ufoload`, run the upload smoke test in section D, and record the
    approval date and contact here: ______________________
  - If NOT obtained: **Production video hosting is BLOCKED.** Leave
    `UFOLOAD_ADULT_CONTENT_APPROVED=false` — the app refuses every upload with a `503`
    naming the variable, and refuses to record the provider as approved.
- [ ] **Replacement provider approved** (only if UFOLOAD declines): owner approves a
  provider whose Acceptable Use Policy explicitly permits adult content and commercial
  use (Bunny.net Stream, Cloudflare Stream, Mux, or self-hosted S3 + transcoding).
- [ ] **Provider adapter implemented**: `lib/video/provider.ts` resolves only `ufoload`
  (real uploads) and `internal` (embeds only); any other `VIDEO_PROVIDER` value fails
  closed with an actionable error — Uqload support has been removed.
- [ ] **Plan limits match the app limits**: UFOLOAD per-file ceilings (Free 5 GB,
  Pro 10 GB, Max 25 GB) must be at least the app's 2 GB `MAX_VIDEO_SIZE`; the UI shows a
  clear `413` when either limit is exceeded.
- [ ] **Large-file upload architecture**: video bytes go browser → UFOLOAD node in
  chunks (Vercel functions reject bodies above 4.5 MB). Verify a multi-hundred-MB file
  uploads without touching Supabase or a function body.
- [ ] **Concurrency**: UFOLOAD allows at most 10 active URL imports per account; the
  import batch stops with an explanation instead of hammering the API. Direct uploads
  hold a slot for 15 minutes if abandoned — the browser pings the provider during long
  transfers.
- [ ] **Thumbnail stability**: thumbnails are stable public URLs (Supabase
  `video-thumbnails`, or the provider's own stable poster) — never signed/expiring URLs,
  so Googlebot can fetch them for the video sitemap.
- [ ] **Playback verification**: test actual playback on desktop and mobile; confirm the
  embed address is the stable `https://ufoload.com/e/{code}` form and that provider
  outages are surfaced as notes instead of breaking the watch page.
- [ ] **Sitemap inclusion**: only published, cleared, approved, public videos appear in
  `sitemap.xml` / `video-sitemap.xml`; videos still encoding at the provider do not.

### D. Click-by-click manual smoke test (UFOLOAD, on the real account)

Run this after the migration and before launch. It is the only procedure that proves
the *admin UI* end-to-end — the automated suite cannot (it has no real provider key).

1. Deploy with `VIDEO_PROVIDER=ufoload`, `UFOLOAD_API_KEY` set, and
   `UFOLOAD_ADULT_CONTENT_APPROVED` **false**. Open `/admin/videos/upload`.
2. Pick a category, choose a small real video file, press **Generate AI metadata &
   publish**. Expect an inline error naming `UFOLOAD_ADULT_CONTENT_APPROVED` and **no**
   request to UFOLOAD. This proves the fail-closed gate.
3. Set `UFOLOAD_ADULT_CONTENT_APPROVED=true` (only with written approval) and redeploy.
   Confirm `/admin/system-health` shows *Video Provider* = `ufoload (approved)`.
4. Repeat step 2 with a small (10–50 MB) file. Watch the row: *Requesting an upload
   session…* → *Uploading to UFOLOAD — N%* → *Completing the upload…* → *UFOLOAD is
   encoding…* → *Published · UFOLOAD has the video ready to play*.
5. In the UFOLOAD dashboard, confirm the file exists with the title Gemini generated.
6. Open Admin → **Videos** → the new row; confirm it is `published`, and that
   `provider_file_id` is a ULID while `embed_url` is `https://ufoload.com/e/{code}`.
7. Open the public `/video/[slug]` page in a private window: the video must play.
8. Press **Cancel** during a larger upload: the row returns to *Cancelled — ready to
   publish*, and the UFOLOAD dashboard shows no leftover partial upload.
9. Test a URL import: *Upload by link* → paste a public direct `.mp4` URL → publish.
   The row reports *Import started — UFOLOAD is downloading the link…*, then either
   publishes once ready or settles on *still encoding* with a **Re-check status** button.
   Press that button after a few minutes; the row publishes when the provider is ready.
10. Check `upload_jobs`: the import row stores the task id in `provider_import_id`, and
    `provider_file_id` stays `null` until the provider returns the created file.
11. Publish an iframe embed: it appears immediately (no provider involved) and the
    generic `/api/videos/embed` route is used.
12. Record the evidence (screenshot + `provider_file_id`) in this checklist.

## 3. Hosting — CRITICAL BLOCKER

- [ ] **Hosting provider selected**: Must permit lawful adult content and commercial use. NOT Vercel Hobby (personal non-commercial only, AUP restricts objectionable content).
  - Options: Fly.io, Render, Railway, self-hosted VPS — verify current AUP at provider docs.
- [ ] **Vercel commercial approval (if using Vercel)**: If choosing Vercel Pro/Enterprise, contact Vercel support, obtain written confirmation that adult content and commercial use permitted on chosen plan. Document approval.
- [ ] **Domain configured**: Purchase or use existing domain, configure DNS, verify HTTPS, set canonical domain, set `NEXT_PUBLIC_SITE_URL` and `SITE_URL` to canonical.
- [ ] **Environment variables set**: All vars from `.env.example` set in hosting dashboard, secrets marked server-only, no secrets in client bundle.
- [ ] **Build succeeds**: `npm run build` passes, no TS errors, no broken imports.
- [ ] **Preview deployments**: Test preview deployment with real env vars.

---

## 4. Supabase

- [ ] **Project created**: Region selected, project URL and keys obtained.
- [ ] **Migrations applied**: `00000000000000_initial_schema.sql`, `00000000000001_rls_policies.sql`, `00000000000002_seed_fixed_data.sql` applied via SQL Editor or CLI.
- [ ] **RLS verified**: All tables have RLS enabled, policies tested (anon can read only published public videos, advertisers can only access own data, admin can manage).
- [ ] **Ad slots seeded**: Exactly 10 rows in `ad_slots`, $99/month, 16:9.
- [ ] **Categories seeded**: 12 categories (Mature, Amateur, POV, Lesbian, Kinky, Mature 18+, Couples, Boudoir, Romantic, Solo, Roleplay, Massage) — real taxonomy, no fake counts.
- [ ] **Site settings**: Row id=1 exists, support_email and contact_email set to real verified emails.
- [ ] **Auth redirect URLs**: Site URL and redirect URLs configured for production domain and localhost.
- [ ] **Email templates**: Confirm signup, reset password templates verified.
- [ ] **SMTP/Resend integration**: Resend SMTP configured in Supabase Auth or via Resend Integration, test emails deliver.
- [ ] **Initial admin bootstrapped**: First admin created via secure SQL procedure (see DEPLOYMENT.md), not via browser role field. Audit log created.
- [ ] **Storage buckets**: `ad-creatives` (public), `video-thumbnails` (public), `videos` (private if using internal provider) created, policies set.

---

## 5. NOWPayments

- [ ] **Account created**: NOWPayments account, verification completed if required.
- [ ] **Business approval confirmed in writing**: NOWPayments permits this lawful adult-entertainment business and its advertising use under the account's terms. API access alone is NOT proof of approval — unresolved until written confirmation exists.
- [ ] **API key obtained**: Store Settings → API key → set `NOWPAYMENTS_API_KEY` (server-only, never `NEXT_PUBLIC_*`).
- [ ] **IPN Secret Key obtained**: Store Settings → IPN Secret Key → set `NOWPAYMENTS_IPN_SECRET` (server-only). Every IPN is rejected without it.
- [ ] **Coins enabled**: every asset the checkout offers (`usdterc20`, `usdttrc20`, `usdtbsc`, `usdtsol`, `btc`, `eth`, `trx`, `bnbbsc`, `sol`) enabled in the dashboard, and the payout wallet/addresses configured.
- [ ] **IPN callback URL correct**: the app sends `https://YOUR_DOMAIN/api/nowpayments/ipn` with every payment (derived from `NEXT_PUBLIC_SITE_URL`, optionally pinned by `NOWPAYMENTS_IPN_CALLBACK_URL`). No per-chain dashboard entry is needed; enter the same URL as the store-level default if the dashboard offers the field.
- [ ] **IPN reachable**: `curl -i https://YOUR_DOMAIN/api/nowpayments/ipn` (or Admin → System Health → **Test IPN reachability**) returns HTTP 200 `{"status":"ok"}` and writes nothing to `payments`/`payment_events`.
- [ ] **Integration verified from the app**: Admin → System Health → NOWPayments panel shows API reachable, IPN secret set, and the expected callback URL.
- [ ] **Genuine payment processed end to end** (smallest real checkout, real funds): signed IPN → payment `confirmed` with `provider_payment_id`, invoice `paid`, campaign `active`/`pending_review`, `payment_events` contains `ipn_received`, `payment_verified`, `confirmed`.
- [ ] **Verification logic tested**: signature check, payment correlation by `payment_id`/`order_id`, pay-currency/address/USD-price match, provider corroboration (`GET /v1/payment/{id}`), integer-math amount check, and idempotency (duplicate final IPN answers `already_processed`, exactly one `confirmed` event).
- [ ] **Fails closed**: an unsigned, malformed, tampered, or wrong-secret IPN; an unknown payment id; a mismatched order reference, currency, address, or amount; a `finished` claim the API does not corroborate; or a provider outage must all leave the payment unconfirmed and record an audit row.
- [ ] **Intermediate statuses never fulfill**: `waiting`/`confirming`/`confirmed`/`sending` are recorded only — including provider `confirmed`, which is NOT completion.
- [ ] **Partial/under/overpayment handling**: `partially_paid` → `underpaid` for manual review, campaigns not activated; finished-but-mismatched amounts → `underpaid`/`overpaid`, logged for admin review, not silently discarded.
- [ ] **`failed`/`expired`/`refunded` handling**: terminal outcomes update payment + invoice, cancel pending campaigns, and pause campaigns on refund.
- [ ] **Refund process defined**: real, auditable refund workflow — refunds are applied from verified provider `refunded` notifications, not fabricated automatic reversals.
- [ ] **Checkout UX**: crypto amount, USD equivalent, asset, network, address, copy button, expiration, live status without page refresh, network instructions — all displayed, consistent with dark theme.
- [ ] **Missing-credentials behavior tested**: no API key → checkout answers 503 without a payable-looking record; no IPN secret → IPNs rejected with 503.
- [ ] **Provider downtime tested**: payment API unreachable during verification → 503 so NOWPayments retries; payment untouched; no success claimed.

---

## 6. Resend Email

- [ ] **Account created**: Resend account.
- [ ] **Domain added and verified**: DNS records (SPF, DKIM, DMARC) added via domain provider, domain shows Verified in Resend dashboard.
- [ ] **API key created**: `RESEND_API_KEY` set.
- [ ] **Sender address configured**: `RESEND_FROM_EMAIL` set to verified domain email, e.g., `noreply@erobabe.com`.
- [ ] **Supabase SMTP integration**: Resend SMTP credentials added to Supabase Auth SMTP settings, or Resend Integration connected.
- [ ] **Transactional emails tested**: Verification, reset, campaign submission, payment confirmation, approval/rejection, expiration reminders, contact, support, removal acknowledgement — all tested, no claim of sent when provider returned error.
- [ ] **Rate limits respected**: Delivery failures recorded, not losing underlying request/payment/ticket.
- [ ] **No sensitive adult details in subjects**: Subjects neutral.

---

## 7. Gemini API

- [ ] **Account and API key**: Google AI Studio API key created at https://aistudio.google.com/apikey → `GEMINI_API_KEY` set (server-only, never `NEXT_PUBLIC_*`).
- [ ] **Model configured**: `GEMINI_MODEL` set to a currently supported model, e.g., `gemini-flash-latest`, matches https://ai.google.dev/gemini-api/docs.
- [ ] **Metadata generation tested**: publisher sends source filename/URL path, working title, selected category, and existing tags to Gemini; receives validated title, description, tags, and category server-side; blocks publication if Gemini is not configured, errors, or returns incomplete metadata.
- [ ] **Structured output validated**: title/description lengths, tags against the permitted list, category against the taxonomy — unvalidated model output is never trusted.
- [ ] **Suggestion route secured**: `/api/gemini/suggest` requires an active admin session, validates and bounds its input, and rate-limits requests.
- [ ] **Quota/rate-limit failures tested**: quota exhaustion answers 429 with an actionable message; generic provider errors answer 502 without leaking key material or internals.
- [ ] **No auto-publish**: AI output never auto-publishes video or asserts facts about content not verified; suggestions require human review.
- [ ] **Privacy**: no video bytes, private rights docs, payment records, or unnecessary personal info sent to Gemini.
- [ ] **Fallback**: app continues to work without Gemini if not configured (clear configuration error, no silent fallback to another provider).

---

## 8. SEO

- [ ] **Crawlable URLs**: No hash routing for public pages — `/`, `/video/[slug]`, `/category/[slug]`, etc. — verified.
- [ ] **Server rendering**: Dynamic video records in initial HTML, unique titles, descriptions, canonicals, not dependent solely on delayed JS.
- [ ] **Sitemap**: `/sitemap.xml` valid, dynamic, includes only eligible public URLs, absolute canonical URLs, truthful lastmod.
- [ ] **Video sitemap**: `/video-sitemap.xml` valid, includes thumbnail, title, description, player_loc, duration, publication_date, matches published DB records, excludes drafts/unpublished/rejected/removed/admin/advertiser routes.
- [ ] **Robots.txt**: `/robots.txt` generated, allows public video pages and thumbnails, disallows private routes, does not block rendering assets.
- [ ] **VideoObject JSON-LD**: Each watch page has valid VideoObject with name, description, thumbnailUrl, uploadDate, duration (if known), contentUrl/embedUrl where real and permitted, creator/publisher. Markup matches visible content.
- [ ] **Stable thumbnails**: Unique, stable thumbnail URLs, return successfully, not blocked by auth or robots.
- [ ] **Video accessibility**: Player present in rendered HTML, not dependent on arbitrary user interaction.
- [ ] **Explicit-content metadata**: Adult rating meta, explicit content handling per Google guidelines, SafeSearch considerations.
- [ ] **Googlebot handling**: Any crawler-specific handling based on legitimate bot verification, not just user-agent, no deceptive content.
- [ ] **HTTP status codes**: Real 404 for missing videos, redirects when URLs change, no misleading 200 for removed content.
- [ ] **Metadata quality**: Unique titles, meta descriptions, canonical, OG, heading hierarchy, alt text, internal links, breadcrumbs, category relationships. No thin SEO pages, no keyword stuffing, no bulk AI-generated duplicate pages.
- [ ] **Search Console**: Domain property verified, sitemap submitted and inspected, URL Inspection tested, rendered output tested, video-indexing reports monitored, structured-data errors reviewed.
- [ ] **SEO acceptance tests**: Automated tests verify root URL, no hash routing, unique video URLs, watch pages metadata, canonicals, structured data, sitemap valid, video sitemap matches DB, removed videos disappear, private routes not in sitemap, robots not blocking public, 404 handling, crawlable links, no placeholder videos.

---

## 9. Security and Reliability

- [ ] **Input validation**: All forms validated (zod), safe URL handling, file type/size/dimensions validated.
- [ ] **Authorization**: Every privileged operation verifies auth on server or via RLS — not just frontend guards.
- [ ] **RLS tests**: Tests verify anon can read only public fields of published approved content, cannot read drafts/private/payment/logs, advertisers can only see own data, cannot modify ownership/payment/approval/slot inventory/roles, admin can perform authorized operations.
- [ ] **Secure session/cookies**: Supabase SSR with httpOnly cookies, secure, sameSite.
- [ ] **Rate limiting**: Abuse-prone operations (login, sign-up, reports, support, payment creation) rate limited.
- [ ] **Secret management**: No secrets in browser, no secret logging, env files gitignored, `.env.example` has fictional placeholders only.
- [ ] **Audit logs**: Privileged actions logged (publishing, unpublishing, role changes, ad approvals, refunds, settings updates).
- [ ] **Idempotent webhooks**: NOWPayments IPNs idempotent (duplicate/out-of-order/stale notifications cannot duplicate business actions), no duplicate ledger entries.
- [ ] **Concurrency-safe reservations**: Slot reservations use DB transactions or equivalent to prevent overlapping purchases.
- [ ] **Pagination and limits**: Reasonable limits on queries, no unbounded table scans.
- [ ] **File ownership**: Upload jobs owned by creator, verified.
- [ ] **Error handling**: Sanitized user-facing errors, no stack traces leaked.
- [ ] **Dependency security**: Current stable dependencies, lockfile reviewed, no unnecessary deps.

---

## 10. Testing

- [ ] **Unit tests**: Vitest + React Testing Library — pass.
- [ ] **Integration tests**: Supabase queries, RLS, payment flow mocked.
- [ ] **E2E tests**: Playwright — auth, admin upload, publication, advertising, payments, email, sitemap, SEO — pass (except documented external checks blocked by missing credentials/approvals).
- [ ] **Visual regression**: Compare updated frontend against existing UI at 1648×928 and mobile — three interfaces retain design language, changes limited to required for real data, routing, security, payments, uploads, accessibility, SEO.
- [ ] **Production build**: `npm run build` succeeds.
- [ ] **No mock data leakage**: `grep -R "pexels\|INITIAL_VIDEOS\|fake\|placeholder" app/ src/ --exclude-dir=node_modules` shows no production mock.
- [ ] **No secrets committed**: `git log --all --full-history -- "**/.env*"` shows no secrets, `.gitignore` excludes env files.

---

## 11. Remaining Launch Blockers (Documented)

- [ ] **UFOLOAD adult content / commercial approval**: BLOCKED — the TOS has no explicit adult-content clause, so written confirmation (or a replacement provider) is required. See DEPLOYMENT.md D.
- [ ] **Hosting approval**: BLOCKED if using Vercel Hobby or host that prohibits adult/commercial. Need approval and documentation.
- [ ] **Legal identity**: BLOCKED — owner must provide real business details.
- [ ] **Age assurance**: Evaluate jurisdiction-specific requirements, implement verification integration if required.
- [ ] **NOWPayments approval and wallet**: BLOCKED until written confirmation that NOWPayments permits this adult-entertainment advertising business exists; then configure the payout wallet and enable the accepted coins.
- [ ] **Resend domain verification**: Must verify DNS.
- [ ] **Search Console**: Must verify domain property, submit sitemap, monitor indexing — cannot promise ranking or indexing speed.

---

## 12. Final Acceptance Criteria (Must all be true before launch)

1. [ ] Original visual identity preserved (dark charcoal/black, hot-pink accents, 16:9 slots, three-column layout, responsive).
2. [ ] All three interfaces use real, authorized backend data (no mock).
3. [ ] No production demo datasets or fake business metrics remain — honest empty states.
4. [ ] All remaining controls have working behavior with loading/empty/error/success states.
5. [ ] Supabase Auth and server-side role authorization work.
6. [ ] RLS policies tested.
7. [ ] Admin can genuinely upload, manage, review, publish approved videos via the authorized UFOLOAD integration (or another provider the owner approved in writing).
8. [ ] Public watch pages play actual hosted videos.
9. [ ] Advertisers can reserve ten fixed placements and create real campaigns.
10. [ ] NOWPayments payment requests, signed-IPN verification, and confirmation processing work per actual API.
11. [ ] No campaign activates based on unverified payment or unapproved creative.
12. [ ] Resend transactional emails work with verified sending configuration.
13. [ ] Gemini metadata suggestions work where configured and never publish automatically.
14. [ ] Public pages use crawlable URLs and dynamic accurate metadata.
15. [ ] XML sitemap and video sitemap contain only eligible public records.
16. [ ] SEO and structured-data tests pass.
17. [ ] Automated unit, integration, E2E tests pass (except documented external checks blocked).
18. [ ] Production build succeeds.
19. [ ] DEPLOYMENT.md gives complete click-by-click setup.
20. [ ] GO_LIVE_CHECKLIST.md accurately lists remaining external decisions (this file).
21. [ ] No prohibited provider usage enabled (UFOLOAD uploads without written approval, Vercel Hobby commercial).
22. [ ] No secrets committed.
23. [ ] No feature described as operational when only simulated.
24. [ ] Final implementation report separates verified results from unverified assumptions and remaining blockers.

---

## Sign-off

- Owner name: _________________________
- Date: _________________________
- Hosting provider approved: _________________________
- Video provider approved: _________________________
- Legal review completed: _________________________
- NOWPayments approval confirmed + wallet configured: _________________________
- Resend domain verified: _________________________
- Supabase project: _________________________
- Search Console verified: _________________________

Do not launch until all critical blockers resolved and all acceptance criteria true.
