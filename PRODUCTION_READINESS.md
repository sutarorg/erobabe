# Production readiness — 2026-10-15

## Decision: HOLD — not production-ready

Code changes and local automated verification are delivered; required staging, policy, legal and operational acceptance are incomplete. No production deployment, live charge, production migration or remote media deletion was performed. A successful build is not release approval. See `AUDIT_REPORT.md` for remaining code/policy follow-ups and `GO_LIVE_CHECKLIST.md` for every gate.

Baseline fetched before modification: `fe46b33460d83a86cf9af44a251284067ce86b05`. Branch: `arena/0a9f0b83-erobabe`. Review PR: https://github.com/sutarorg/erobabe/pull/44 (**draft, not merged**). GitHub automatically started a Vercel preview check; that is not production/provider acceptance.

## Automated evidence

Environment: Linux sandbox, Node **22.22.3**, npm **10.9.8**. Final resolved versions: Next **15.5.28**, React **19.2.6**, Vitest **4.1.11**, Vite **8.3.4**, esbuild **0.28.2**, PostCSS **8.5.30**, eslint-config-next **15.5.27**.

| Command | Result / scope |
|---|---|
| `npm ci` | PASS, exit 0. Reports the five known high development-tooling advisories below. |
| `npm run type-check` | PASS, exit 0. Includes TSX tests now, not only `.ts` tests. |
| `npm run lint` | PASS, exit 0; **0 errors, 24 warnings** (existing image optimization / JSX guidance). Supported `eslint app lib src middleware.ts --ext .ts,.tsx` replaces deprecated `next lint`. |
| `npm run test` | PASS, exit 0; **48 files, 597 tests passed**, no unit-test files skipped. |
| `npm run build` | PASS, exit 0; production App Router output generated. No live DB/provider credentials. Expected missing-Supabase warnings/empty public prerender do not prove integration health. |
| `npm run test:e2e` | PASS, exit 0; **26 passed**. Local Next dev server and Chromium 153.0.8010.0; public/API boundaries, actual local frame extraction, mocked TUS protocol, desktop/mobile production sidebar components with isolated router, every real portal URL's anonymous redirect. Not authenticated staging page-content acceptance. |
| `npm run test:live` | Exit 0, but **15 skipped / 1 skipped file** under the existing credential gate. **NOT VERIFIED**, not a live-integration PASS. |
| `npm audit --omit=dev --json` | PASS, exit 0; **0 reported production vulnerabilities**. Advisory scan, not a security guarantee. |
| `npm audit --json` | **FAIL**, exit 1; **5 high, 0 critical**, all in one braces/Next ESLint development chain. |
| `git diff --check` | PASS, no whitespace errors. |

Sandbox browser invocation:

```sh
LD_LIBRARY_PATH=/tmp/al2023/lib \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium \
npm run test:e2e
```

Chromium and its packaged Linux libraries were obtained via `@sparticuz/chromium` in a **workspace-only tools directory**, not added to application dependencies/Git. Normal CI should use Playwright's supported browser installation (`npx playwright install --with-deps chromium`). The first browser attempt lacked libnspr4; extracting the supplied libraries resolved it. An npm 10 dependency-update resolver bug was worked around with npm 11.6.4 for lock generation; final normal npm 10 `npm ci` succeeded without special flags.

### Baseline and reproduced failures

Before implementation: `npm ci`, type-check, lint, build and **40 files / 489 unit tests** passed. Once a working browser was available, the unchanged browser expectations reproduced **21 passed / 3 failed**: admin redirect expected advertiser login, empty video sitemap expected populated entries, missing-video document returned 200. Corrected redirect/empty-catalog expectations with populated unit fixtures, and fixed the HTTP status defect rather than weakening its assertion. No failing test file was removed or skipped.

### Database evidence (local, not staging)

`launch-integrity-schema.test.ts` applies every checked-in migration with Supabase-managed auth/storage fixture schemas and exercises actual SQL roles, protected-field attempts, DB pricing, two-advertiser reservation conflicts, required external_id, pre-provider claim, transactional rollback on invoice failure, idempotence, refund behavior, delivery eligibility, rate budgets and stored counters. `bunny-schema.test.ts` proves private completion, explicit review/publication, view deduplication and durable deletion retention. PGlite is a local PostgreSQL-compatible engine, **not actual Supabase, network PostgREST/Storage or two concurrent independent connections**.

Ten middleware regressions additionally verify active-role access, wrong-role rejection, fresh suspension checks on RSC navigation, fail-closed profile reads and refreshed cookies. Portal layout caching is not used as the request authorization boundary.

Route tests use mocked providers/in-memory adapters separately. Browser thumbnail tests decode a genuine generated local clip; TUS tests use a deterministic protocol fixture, **not Bunny's real service**. Visibility tests prove loaded/50%/1s behavior, not anti-fraud certification.

## Genuine external acceptance

| Integration | Status | What is missing |
|---|---|---|
| Supabase/Auth/Storage | BLOCKED | Authorized isolated staging credentials, migrated actual schema/policies, real signup/recovery email flow, direct REST/Storage attacks and two-session races. |
| Bunny | BLOCKED | Approved account/library and authorized source clip; real TUS completion, thumbnail verification, processing, playback and recovery evidence. |
| NOWPayments | BLOCKED | Business approval and approved staging/test procedure; actual checkout/schema, signed IPN delivery, status reconciliation, under/overpayment, expiration and refund evidence. No live charges made. |
| Resend | BLOCKED | Verified sender/domain and real inbox delivery/SMTP evidence. |
| OpenRouter | NOT TESTED / BLOCKED if enabled | No configured authorized credentials/model approval; existing live tests skipped. Optional thumbnail ranking remains consent-gated/off by default. |
| Hosting/legal/DNS/HTTPS/backups | BLOCKED | No selected approved hosting plan, written provider approval, legal sign-off, production configuration or recovery drill evidence. |

No relevant provider credentials were configured in this session. Sandbox outbound access is limited to GitHub/package registries; genuine acceptance must run in an authorized staging/CI environment with provider egress. Do not paste credentials into chat.

## Exact release-clearing steps

1. Obtain compatible patched development tooling for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), or a formal approved tooling-only risk disposition. The registry's available braces release is still 3.0.3; blindly forcing a framework downgrade is not a safe fix.
2. Owner/counsel supplies actual lawful-business/hosting/provider approvals, content rights/consent/recordkeeping, operator identity, age assurance and privacy/removal requirements. Resolve public pending-creative storage/scanning policy and unfinished creative-replacement/support-agent UI scope before the pilot.
3. Restore an authorized backup to staging; run `docs/LAUNCH_PREFLIGHT.sql`, resolve historical conflicts, apply unapplied migrations **14 → 15 → 16 → 17 → 18** after the retained history, and deploy matching app in a write freeze. Follow the DEPLOYMENT addendum; never restore permissive RLS as rollback.
4. Configure secrets through the deployment secret manager, trusted-IP header overwrite/WAF, daily event pruning, alerting, supported Node/FFmpeg, canonical HTTPS domain, PKCE redirects and sender verification.
5. Perform all genuine acceptance scenarios in GO_LIVE_CHECKLIST, especially two advertisers racing, provider success followed by DB failure, refund/stale notification behavior, suspension, real multi-file retries and every authenticated page on mobile/desktop. Record timestamps, redacted provider IDs and operator sign-off here.
6. Re-run all checks on the reviewed release commit, clear/accept remaining risks, then explicitly approve merge/deployment. The current review PR must not be treated as launch authorization.


## October 15 continuation evidence

Recovery now has dedicated handler regressions plus independent full-migration SQL coverage; migration **18 payment_recovery** adds active-admin-attributed, immutable, retry-safe binding with transactional audit rollback. Checkout and recovery share exact quote validation. Stale provider snapshots no longer bypass transactional settlement, and automatic fulfillment explicitly uses zero tolerance rather than the utility's legacy 2%. See the October 15 DEPLOYMENT addendum for the required matching application/RPC rollout and historical mismatch review.

The previous verifier was temporarily tested against the five newly added snapshot/amount regressions: **five failures reproduced**, then the working implementation was restored and the entire suite rerun. That filtered diagnostic run intentionally selects only its five cases; no acceptance tests were removed or marked skipped. The same five high tooling advisories remain after a new registry/audit check; no force downgrade, advisory suppression or risk acceptance was performed.
