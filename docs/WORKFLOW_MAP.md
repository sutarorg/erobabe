# Workflow map — inspected before implementation, 2026-10-14

> **Historical document (superseded 2026-10-27).** Video uploads and Bunny
> Stream are retired. This file is kept for provenance; read
> `docs/DAMPLIPS_EMBEDS.md` for the current catalog flow (damplips embeds,
> `npm run import:damplips`, `/api/videos/stream`).

Baseline: fetched origin/main fe46b33460d83a86cf9af44a251284067ce86b05.
Runtime: Next App Router (`app`), shared production UI/utilities in `src`, Supabase SSR cookie auth, privileged server client for publishing/payment/public catalog. The hash SPA has no Next entry point.

## Video
`admin/videos/upload` → active-admin session reservation (`api/videos/bunny/sessions`) → persistent `bunny_uploads` → Bunny library video + short-lived TUS signature → `src/utils/bunnyUpload` transfers bytes directly to Bunny. Browser samples actual frames, scores locally (optional explicitly approved OpenRouter vision ranking), obtains Storage token and uploads thumbnail. Confirm/status routes independently query Bunny and verify thumbnail objects. Stage/finish/fail RPCs atomically maintain videos, upload_jobs, sessions. Existing finish RPC publishes automatically, while manual video tools enforce rights/moderation; this discrepancy needs review. Metadata suggestions use OpenRouter server-side. FFmpeg is still used for manual existing-media thumbnails and must stay packaged. Public catalog/watch/sitemaps independently require published/public/rights-cleared/moderation-approved. Retired-provider media support is retained for historical rows; requires_reupload cannot be published.

Intended: provider completion produces a private reviewable record; only explicit authorized review can publish. Failed thumbnails/encoding must retain provider identity so retry does not retransmit bytes. Remote deletion needs an auditable retention/cleanup decision.

## Advertising/payment
Ten seeded ad_slots (five per rail), database price_cents authoritative. Current browser uploads a creative to Storage, inserts pending creative/campaign rows, then calls NOWPayments create with campaign IDs. Create checks ownership/DB prices but checks overlaps without a lock and attaches campaigns after the external call. Payments retain historical Bcon columns; external_id is required. NOWPayments order_id is invoice_number. IPN verifies HMAC, looks up provider truth, compares amounts; polling has separate weaker fulfillment logic. Confirmation currently updates payment, invoice and campaigns in separate requests (partial failure risk).

Intended: database-controlled pending creation/holds → atomic pre-provider campaign claim → persisted order identity → provider address → verified identity/order/asset/address/fiat/actual crypto → transactional settlement/invoice/campaign transition. Paid + approved + in-date + correct slot/owner + active accounts are independently required for delivery. Refund disables delivery. Uncertain provider creation must be reconciled by order, not blindly retried. Visibility-qualified impressions/clicks need validated IDs, deduplication and atomic counters; current audit logs are not metrics.

## Accounts/operations
Auth sign-up trigger creates restricted advertiser profiles; profile column privileges protect role/status. Middleware refreshes sessions; portal layouts gate roles; mutation routes must independently check active roles. Admin video/category handlers have server checks, but broad advertiser RLS permits campaign/creative/payment forgery and advertiser-profile status changes. Support/report handlers persist rows and optionally notify through Resend; current input limits/escaping are insufficient and advertiser support uses a fake email.

Admin pages cover content, advertising, payments, reports and operations; some are read-only listings, not complete moderation consoles. Advertiser analytics reads campaign counters. Resend failure must not lose a persisted support request; missing configuration must never fake a successful mutation.

## Verification boundaries
Unit tests use route/provider fixtures; PostgreSQL-compatible PGlite tests run migration SQL with auth/storage infrastructure fixtures. Browser tests cover public/auth boundaries and mocked media, not genuine staging. No staging credentials/account approvals are available. Hosting/adult-content policy, legal age assurance/consent, provider approval, email delivery, real TUS and payment settlement remain external gates.
