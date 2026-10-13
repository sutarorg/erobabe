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

## 2. Video Hosting — Direct MP4 URLs (resolved)

- [ ] **Owner policy verification**: Streamtape's Terms
  (https://streamtape.com/terms-and-conditions) and Copyright Policy
  (https://streamtape.com/copyright) prohibit sexual content involving minors and any
  content that violates third-party rights, require you to hold rights/consent, and allow
  removal at any time. They contain **no explicit clause permitting or banning lawful adult
  content**. Verify the current terms, check the account panel's content/embed settings,
  and ideally obtain Streamtape support's written answer on **lawful adult content,
  commercial use, API uploads and embedded playback**; keep it on file.
  - Verified (date / contact / reference): ______________________
  - If NOT verified: **Production video hosting is BLOCKED.** Leave
    `STREAMTAPE_ADULT_CONTENT_ALLOWED=false` — the app refuses every upload with a `503`
    naming the variable.
- [ ] **Credentials configured**: `STREAMTAPE_LOGIN`, `STREAMTAPE_API_KEY` (server-only),
  optional `STREAMTAPE_FOLDER_ID`; `VIDEO_PROVIDER=streamtape`.
- [ ] **Upload relay deployed**: `relay/streamtape-relay.mjs` on an always-on Node ≥ 18 host
  with HTTPS (not Vercel/serverless), `STREAMTAPE_RELAY_SECRET` identical in the relay and
  the app, `STREAMTAPE_RELAY_ALLOWED_ORIGINS` = the site origin(s), `STREAMTAPE_RELAY_URL`
  set in the app. `GET {relay}/health` answers 200.
- [ ] **Migration applied**: `supabase/migrations/00000000000007_streamtape_video_provider.sql`
  (older migrations untouched; legacy `ufoload`/`uqload` rows unchanged and still viewable).
- [ ] **Provider adapter**: `lib/video/provider.ts` resolves only `streamtape` and `internal`;
  `ufoload`, `uqload` and any other value fail closed with an actionable error.
- [ ] **Size limit matches the account**: Streamtape's API docs state no per-file limit (a
  2021 community README claims 15 GB). Verify the account's real limit and set
  `STREAMTAPE_MAX_UPLOAD_BYTES`; the app answers `413` before any bytes move.
- [ ] **Large-file upload architecture**: bytes go browser → relay → Streamtape (Vercel
  functions reject bodies above 4.5 MB). Verify a multi-hundred-MB file uploads without
  touching Supabase or a function body, and that the relay host's request timeout exceeds
  the longest expected upload. Streamtape documents no resumable protocol: an interrupted
  upload is restarted.
- [ ] **Concurrency/bandwidth**: Streamtape documents no remote-upload concurrency limit
  (the app caps a batch at `STREAMTAPE_MAX_ACTIVE_IMPORTS`, default 10) and answers
  `509` when bandwidth is exhausted — the app surfaces it and stops the batch.
- [ ] **Thumbnail stability**: thumbnails are stable public URLs (Supabase `video-thumbnails`,
  or Streamtape's `getsplash` URL) — never signed/expiring URLs.
- [ ] **Playback verification**: actual playback on desktop **and** mobile; the embed is
  `https://streamtape.com/e/{fileId}`; provider outages show as notes, not a broken watch page.
- [ ] **Sitemap inclusion**: only published, cleared, approved, public videos appear in
  `sitemap.xml` / `video-sitemap.xml`; rows still converting do not.
- [ ] **Live evidence recorded**: `LIVE_STREAMTAPE=1 npm run test:live` output and
  `test-results/streamtape-live-evidence.json` (field name, node response shape, CORS probe),
  plus the browser acceptance run (`tests/live/README.md`). Until these exist the direct
  browser→Streamtape path is **unproven** and the relay is mandatory.

### D. Click-by-click manual smoke test (Streamtape, staging first)

Run this on **staging** (own Supabase project) after the migration and before launch. The
automated suite cannot replace it (it has no real provider account).

1. Configure in the hosting environment: `VIDEO_PROVIDER=streamtape`, `STREAMTAPE_LOGIN`,
   `STREAMTAPE_API_KEY`, optional `STREAMTAPE_FOLDER_ID`, `STREAMTAPE_RELAY_URL`,
   `STREAMTAPE_RELAY_SECRET`, `NEXT_PUBLIC_OPENROUTER_API_KEY`, and `STREAMTAPE_ADULT_CONTENT_ALLOWED=false`.
2. Open Admin → **System Health**: *Video Provider* must say `streamtape (blocked — see
   DEPLOYMENT.md)`. Open `/admin/videos/upload`, choose a category and a small **cleared**
   video, press **Generate AI metadata & publish**. Expect an inline error naming
   `STREAMTAPE_ADULT_CONTENT_ALLOWED` and **no** request to Streamtape (fail-closed proof).
3. Set `STREAMTAPE_ADULT_CONTENT_ALLOWED=true` (only after the owner verification) and redeploy.
   *Video Provider* must read `streamtape · API reachable`.
4. Repeat with a small (10–50 MB) file. Watch the row: *Requesting an upload session…* →
   *Uploading to Streamtape — N%* (real byte progress) → *Finishing the upload…* →
   *Streamtape is converting the video…* → *Published · Streamtape has the video ready to play*.
   Review the AI (DeepSeek V3.2) title, description and tags shown on the row.
5. In the Streamtape file manager, confirm the file exists (in the configured folder).
6. In Supabase, confirm the `videos` row: `provider='streamtape'`, `provider_file_id` = the
   Streamtape file id, `embed_url=https://streamtape.com/e/{id}`, `status=published`,
   `visibility=public`, `rights_status=cleared`, `moderation_status=approved`; `tags`/`video_tags`
   populated; `audit_logs` has `video_published_from_upload` with `metadata_source: "ai"`.
   A `fallback` source means the AI was unavailable — review that title before leaving it public.
7. Open `/video/[slug]` in a private window, press **Play**, and confirm playback on a
   desktop browser and on a phone.
8. Press **Cancel** during a larger upload: the row returns to *Cancelled — ready to publish*,
   the job is `cancelled`, and no video is public.
9. Test *Upload by link* with a public direct `.mp4` URL: the row reports *Import started —
   Streamtape is downloading the link…*, then publishes once converted, or settles on *still
   converting* with a **Re-check status** button. Check `upload_jobs.provider_import_id` is
   set and `provider_file_id` stays `null` until Streamtape returns the file.
10. Force an error (wrong `STREAMTAPE_API_KEY` on staging): System Health shows the API as
    unreachable and the upload page shows a redacted, actionable error; nothing goes public.
11. Publish an iframe embed: it appears immediately (no provider involved) via `/api/videos/embed`.
12. Confirm `sitemap.xml` / `video-sitemap.xml` list only published/cleared/approved videos.
13. Record the evidence (screenshots, `provider_file_id`, slug) here: ______________________

**Rollback:** set `VIDEO_PROVIDER=internal` (uploads refuse, embeds and all published videos
keep working) or redeploy the previous release. The migration is additive; no data rollback
is needed. Legacy UFOLOAD/Uqload videos are unaffected either way.

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

## 7. OpenRouter AI metadata (DeepSeek V3.2, browser-direct)

- [ ] **Account and API key**: OpenRouter account created, dedicated key made at https://openrouter.ai/keys → `NEXT_PUBLIC_OPENROUTER_API_KEY` set in `.env.local` **and** in the hosting build environment, with a credit limit configured on the key.
- [ ] **Public-key exposure accepted**: the variable is compiled into the browser bundle by design — anyone can extract it and reuse it separately; restricting the UI to administrators does not prevent that. Documented rotation plan (change value → fresh build → redeploy) and no other secret stored in this variable.
- [ ] **Model configured**: request model is exactly `deepseek/deepseek-v3.2` at `https://openrouter.ai/api/v1/chat/completions` — verify no silent provider/model substitution in `lib/openrouter/browser-client.ts`.
- [ ] **Metadata generation tested**: the admin upload page generates title/description/tags **in the browser** and sends the prepared payload with the authorized publishing request; the server re-validates it and never calls any AI provider.
- [ ] **Structured output validated**: title/description lengths, tags against the permitted list, category against the taxonomy — unvalidated model output never enters the publishing workflow.
- [ ] **No backend AI endpoint**: `/api/gemini/*`, `/api/openrouter`, `/api/ai`, and AI Edge Functions all absent (404); publishing, auth, thumbnails and DB writes still work server-side.
- [ ] **Health check states tested**: Admin → System Health → "Test OpenRouter" distinguishes missing key, invalid key (401/403), quota/rate-limit (429), provider 5xx and connection failures; the API key is never displayed or logged; a key present is reported as *untested*, never as verified or operational.
- [ ] **Quota/rate-limit failures tested**: quota exhaustion surfaces an actionable 429 message; other provider errors surface redacted messages with no key material.
- [ ] **No auto-publish**: AI output never auto-publishes video or asserts facts about content not verified; suggestions require human review, and fallback metadata is clearly marked AI-unavailable.
- [ ] **Privacy**: no video bytes, thumbnails, user records, Supabase credentials, payment records, or full URLs with query parameters sent to OpenRouter — only filename, selected category, and existing title/tags.
- [ ] **Fallback**: app continues to work without a key or during OpenRouter outages (deterministic file-name metadata marked for review; no silent fallback to another AI provider).

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
7. [ ] Admin can genuinely publish approved videos by pasting direct MP4 URLs in the admin panel (`/admin/videos/upload`).
8. [ ] Public watch pages play actual hosted videos.
9. [ ] Advertisers can reserve ten fixed placements and create real campaigns.
10. [ ] NOWPayments payment requests, signed-IPN verification, and confirmation processing work per actual API.
11. [ ] No campaign activates based on unverified payment or unapproved creative.
12. [ ] Resend transactional emails work with verified sending configuration.
13. [ ] OpenRouter metadata suggestions work where configured (browser-direct, key tested) and never publish automatically.
14. [ ] Public pages use crawlable URLs and dynamic accurate metadata.
15. [ ] XML sitemap and video sitemap contain only eligible public records.
16. [ ] SEO and structured-data tests pass.
17. [ ] Automated unit, integration, E2E tests pass (except documented external checks blocked).
18. [ ] Production build succeeds.
19. [ ] DEPLOYMENT.md gives complete click-by-click setup.
20. [ ] GO_LIVE_CHECKLIST.md accurately lists remaining external decisions (this file).
21. [ ] No prohibited provider usage enabled (Vercel Hobby commercial).
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
