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

## 2. Video Hosting — CRITICAL BLOCKER

- [ ] **Uqload written approval**: Uqload TOS (https://uqload.vc/tos) prohibits pornography, nudity, sexual content. Obtain written confirmation that lawful adult content, commercial use, API upload, and intended playback (embed or direct) are permitted. Keep email/letter on file.
  - If approval obtained: set `UQLOAD_API_KEY`, `UQLOAD_ADULT_CONTENT_APPROVED=true`, `VIDEO_PROVIDER=uqload`, test upload, document approval date and contact.
  - If NOT obtained: **Production video hosting is BLOCKED**. Do not enable Uqload for adult content.
- [ ] **Replacement provider approved**: If Uqload not approved, owner must approve replacement (Bunny.net Stream, Cloudflare Stream, Mux, or self-hosted S3 + transcoding). Verify replacement provider's Acceptable Use Policy explicitly permits adult content and commercial use.
- [ ] **Provider adapter implemented**: `lib/video/provider.ts` must have working adapter for chosen provider (Uqload adapter exists but disabled, internal adapter is fallback).
- [ ] **Large-file upload architecture**: Verify uploads not routed through Vercel Function body limit. Use provider direct upload server or dedicated worker on host that permits adult content.
- [ ] **Thumbnail stability**: Thumbnails must be stable URLs, not short-lived signed URLs, so Googlebot can fetch for video sitemap.
- [ ] **Playback verification**: Test actual playback on desktop and mobile, handle expired URLs, blocked embeds, provider outages gracefully.
- [ ] **Sitemap inclusion**: Only published, cleared, approved, public videos in sitemap and video-sitemap. Verify unpublished videos disappear.

---

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

## 5. Bcon Global Payments

- [ ] **Account created**: Bcon Global account, KYC completed if required.
- [ ] **Store created per chain**: e.g., Ethereum store for USDT.
- [ ] **Receiving wallet configured**: Authorized wallet address set in Bcon dashboard (e.g., Ethereum address for USDT-ERC20).
- [ ] **Token and network chosen**: e.g., USDT on Ethereum, or USDT on Tron — set `BCON_PAYMENT_CURRENCY` and `BCON_CHAIN` accordingly.
- [ ] **API key obtained**: Per-chain API key from Store Settings → Copy Generated Keys → set `BCON_API_KEY`.
- [ ] **Callback endpoint configured**: `https://YOUR_DOMAIN/api/bcon/callback` set in Bcon dashboard.
- [ ] **Test payments**: Create test payment via `/api/bcon/create` with $1, simulate callback, verify `payments` table status, `payment_events` immutable, invoice paid, campaign activation.
- [ ] **Verification logic**: Callback validation (external_id, address, txid, amount tolerance) tested, idempotency tested (duplicate callback does not duplicate ledger).
- [ ] **Under/overpayment handling**: Test underpaid/overpaid cases, ensure logged for admin review, not silently discarded.
- [ ] **Refund process defined**: Real, auditable refund workflow using actual wallet procedures — not fabricated automatic reversals that provider doesn't support.
- [ ] **Checkout UX**: Amount, USD equivalent, ticker, network, address, QR, copy button, expiration, pending/confirmed status, network instructions — all displayed, consistent with dark theme.

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

## 7. Groq AI

- [ ] **Account and API key**: Groq account, API key created at https://console.groq.com → `GROQ_API_KEY` set.
- [ ] **Model configured**: `GROQ_MODEL` set to current model, e.g., `llama-3.1-8b-instant`, matches docs.
- [ ] **Metadata generation tested**: Publisher sends source filename/URL path and selected category to Groq, receives title, description, and tags server-side, and blocks publication if Groq is not configured or returns incomplete metadata.
- [ ] **No auto-publish**: AI output never auto-publishes video or asserts facts about content not verified.
- [ ] **Privacy**: No video bytes, private rights docs, payment records, or unnecessary personal info sent to Groq.
- [ ] **Fallback**: App continues to work without Groq if not configured.

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
- [ ] **Idempotent webhooks**: Bcon callbacks idempotent, no duplicate ledger entries.
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

- [ ] **Uqload adult content approval**: BLOCKED — TOS prohibits pornography/nudity. Need written approval or replacement provider. See DEPLOYMENT.md D.
- [ ] **Hosting approval**: BLOCKED if using Vercel Hobby or host that prohibits adult/commercial. Need approval and documentation.
- [ ] **Legal identity**: BLOCKED — owner must provide real business details.
- [ ] **Age assurance**: Evaluate jurisdiction-specific requirements, implement verification integration if required.
- [ ] **Bcon wallet**: Owner must configure authorized receiving wallet.
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
7. [ ] Admin can genuinely upload, manage, review, publish approved videos via authorized hosting integration.
8. [ ] Public watch pages play actual hosted videos.
9. [ ] Advertisers can reserve ten fixed placements and create real campaigns.
10. [ ] Bcon payment requests and confirmation processing work per actual API.
11. [ ] No campaign activates based on unverified payment or unapproved creative.
12. [ ] Resend transactional emails work with verified sending configuration.
13. [ ] Groq metadata suggestions work where configured and never publish automatically.
14. [ ] Public pages use crawlable URLs and dynamic accurate metadata.
15. [ ] XML sitemap and video sitemap contain only eligible public records.
16. [ ] SEO and structured-data tests pass.
17. [ ] Automated unit, integration, E2E tests pass (except documented external checks blocked).
18. [ ] Production build succeeds.
19. [ ] DEPLOYMENT.md gives complete click-by-click setup.
20. [ ] GO_LIVE_CHECKLIST.md accurately lists remaining external decisions (this file).
21. [ ] No prohibited provider usage enabled (Uqload without approval, Vercel Hobby commercial).
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
- Bcon wallet configured: _________________________
- Resend domain verified: _________________________
- Supabase project: _________________________
- Search Console verified: _________________________

Do not launch until all critical blockers resolved and all acceptance criteria true.
