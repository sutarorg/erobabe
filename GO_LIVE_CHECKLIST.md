# Erobabe launch gates — 2026-10-15

**Release: HOLD.** PASS means verified in the named environment only. BLOCKED requires credentials/approval/external action; NOT TESTED means no valid acceptance evidence. Do not infer production PASS from local tests. Final command evidence: `PRODUCTION_READINESS.md`.

| Gate | Status | Required action / evidence |
|---|---|---|
| Repository workflow map and baseline | PASS — repository | Fetched main `fe46b334…`; `docs/WORKFLOW_MAP.md`. |
| Migration SQL, permission and settlement regressions | PASS — local PGlite only | All application migration files execute with auth/storage infrastructure fixtures; direct-role and transaction tests. Not a Supabase staging sign-off. |
| Production Supabase schema/history/RLS | BLOCKED | Owner provisions isolated staging; backup/restore; run `docs/LAUNCH_PREFLIGHT.sql`; resolve overlaps/unsafe historic approvals; apply unapplied 14→15→16→17→18 after 00–13. Verify PostgREST and Storage policies with anon, two advertisers, active/suspended admin. |
| Concurrent inventory purchase | NOT TESTED — staging | Two independent authenticated connections reserve identical slot/date ranges simultaneously; exactly one succeeds. Test nonoverlapping dates, expired hold reuse, deadlock/serialization retries, stale UI and uncertain provider response. |
| Payment schema/quote/integrity | BLOCKED — provider staging | Exact real-schema checkout must create external_id, invoice and claim before address. Verify quote identity/price; replay signed IPN and status polling, failures, missing evidence, amount mismatch and refund. No production charges authorized by this audit. |
| Audited recovery and provider snapshot drift | PASS — local route/SQL tests only | Migration 18 requires an active admin, validates immutable quotes and atomically audits binding. Identical retry and audit-failure rollback covered; drifting provider snapshots never bypass settlement. Real concurrent/provider acceptance remains blocked. |
| NOWPayments account/settlement approval | BLOCKED | Written business approval, supported assets/networks, payout configuration, exact HTTPS IPN URL/secret, provider-approved test procedure, reconciliation/refund runbook and staffed exception handling. |
| Per-request portal authorization | PASS — local 10 middleware tests | Active role/status checked on every protected RSC request, not cached layout alone; suspension, wrong-role, missing profile and refreshed-cookie regressions. Real sessions still require staging acceptance below. |
| Auth/admin bootstrap | BLOCKED | Confirm signup metadata cannot set role; operator-controlled admin bootstrap; active/suspended roles via direct API/DB. Register PKCE callback/recovery redirects, verify inbox links, logout, recovery, session expiry and password policy. Never publish credentials. |
| Bunny real upload/playback | BLOCKED | Approved library account and library API key; real authorized short/bulk clips, TUS network evidence, interruption/resumption, metadata/size policy, actual frame thumbnail, status 4, private review then explicit publish, mobile playback/referrers. |
| Background auto-publish | BLOCKED | Set `CRON_SECRET` on the host and as a GitHub Actions secret, plus `SITE_URL`, then prove it end to end: run the "Publish finished uploads" workflow, close the upload tab while a file is **Encoding**, and confirm the video publishes with nobody confirming the session. A missing or wrong secret must answer 401 on `/api/cron/bunny-publish`. Do NOT add a sub-daily `crons` entry to `vercel.json` — Vercel Hobby fails the deployment on it. |
| Bunny retention/revocation | BLOCKED | Confirm 24h signature risk, account-side actual-byte budget, backup/retention approvals; review System Health media_retention queue and delete exact provider objects only with authorization; record verified outcomes. |
| Resend delivery | BLOCKED | Verified sender domain + SUPPORT_EMAIL; real support acknowledgement/notification and Supabase Auth SMTP delivery. Optional send failure must preserve ticket; schedule operational response process. |
| Optional OpenRouter features | BLOCKED if enabled | Real account/model/provider approval and authorized test; optional thumbnail ranking stays off unless both consent flags, image-capable model and approved provider are recorded. |
| Public eligibility, SEO and navigation | PASS — local fixtures/public browser tests | 404 semantics, empty/populated sitemap serialization, public routes, isolated production sidebar drawer and protected-route redirects. Real populated production behavior still needs staging acceptance. |
| All authenticated page/control content on desktop/mobile | NOT TESTED | Use staging accounts to click every navigation item, verify data/loading/errors, creative and report actions, profile/password, billing recovery, support history. Screenshot evidence at mobile and desktop sizes. |
| Analytics/rate protection | PASS — local SQL/component tests; BLOCKED — ingress | Atomic counters/dedup and loaded/visible timing tested. Configure trusted IP header overwrite, random hash secret, WAF/bot policy; exercise wrong IDs/replays/failed DB writes across replicas; schedule daily prune RPC. No certified human-traffic claims. |
| Creative moderation/storage policy | NOT TESTED / policy decision required | Public bucket exposes pending media by exact URL; MIME/10MB caps are not content scanning. Resolve need for private premoderation and byte-level scanning; finish/accept rejected-creative replacement and support-agent UI limitations before pilot. |
| Dependency security | FAIL — development tool chain | Five high npm findings remain for unpatched braces dependency chain. Production-only scan zero is insufficient to clear full audit. Compatible patch or formal scoped security risk disposition required. |
| Build/unit/lint/browser commands | See PRODUCTION_READINESS.md | Re-run all six commands against release commit, not historical logs; preserve warnings and external-test boundaries. |
| Lawful content, consent and moderation | BLOCKED | Counsel/operator verifies ownership/licenses, adult-performer records, consent, retention, distribution territories, escalation and removal procedures. Review previously auto-approved published records. |
| Age assurance and privacy | BLOCKED | Legal review by operating jurisdiction; implement required age-assurance/access controls. Frontend declaration alone is not evidence of age. Publish accurate data retention/privacy/cookie terms and real operator details. |
| Hosting and all provider policy approvals | BLOCKED | Record actual selected host/plan and written adult-business approval, including Supabase, Bunny, payments, email and optional AI. API access, a paid plan or successful deployment is not approval. |
| Deployment/DNS/HTTPS/environment | BLOCKED | Node 22.x, trusted HTTPS canonical domain, server-only secrets, allowlisted auth redirects, outbound providers, FFmpeg binary execution, request/time/resource limits, HTTPS redirects, production preview separation. |
| Backups/recovery/incident response | BLOCKED | Restore drill, database + Storage/provider inventory backup, migration rollback/forward-fix procedure, secret rotation, alerting, abuse escalation, removal SLA and on-call ownership. |

## Safe release order

1. Clear legal/provider/hosting and security-tooling gates; obtain staging authorization without sharing secrets in chat.
2. Restore backup in isolated staging, inspect history/preflight, apply migrations 14–18 in order, deploy matching app during a controlled write freeze.
3. Execute real acceptance above, attach redacted provider IDs, dates, results and operator sign-off to `PRODUCTION_READINESS.md`. Local SQL mocks cannot replace this.
4. Re-run checks and independent review. Only then approve merge/release and production deployment. Never restore permissive RLS as a rollback shortcut.

Detailed recovery and provider setup: `DEPLOYMENT.md` (especially the October 14 audit and October 15 recovery addenda). No live charge, production migration, account-policy approval or remote deletion was performed in this session.

## Recommendation data and privacy gate (new; migration 24)

- [ ] Review and apply `00000000000024_recommendations.sql` only after inspecting applied migration history and backing up staging data. Confirm tables, indexes, grants, RLS, eligibility RPCs and idempotency in real Supabase (PGlite tests are not production acceptance).
- [ ] Deploy matching app/API and no-store settings. Verify public eligibility on every surface and confirm admin-selected hero carousel is unchanged.
- [ ] Configure server-only random `ANALYTICS_HASH_SECRET`; configure `SITE_URL` and `CRON_SECRET` as repository Actions secrets. Run the daily `Prune recommendation data` workflow manually and verify 30-day event / 180-day profile-feedback cleanup.
- [ ] Verify opt-in is off by default; no profiling or recommendation events without consent; reset removes history; pause deletes profile rows and cookie; comments/likes are not linked to the profile; advertiser screens/logs do not expose viewing data.
- [ ] Test rejected-video/category suppression, “show less” demotion, empty profile cold start, disabled personalization, event errors, idempotency, rate limits, feed keysets and latest tie ordering against staging.
- [ ] Test Bunny Player.js and direct native playback events on authorized real media; Bunny autoplay stays off unless explicitly enabled. No completion or duration claim based on page visibility.
- [ ] Record baseline latency/coverage/empty rates before experiment. No uplift claim until sample size, randomization, guardrails and evaluation criteria are pre-registered and a valid experiment has run.
- [ ] Obtain privacy/legal review of 18+ age assurance, sensitive adult viewing retention, provider approval and actual rights/moderation obligations. The UI age prompt alone is not age verification.
