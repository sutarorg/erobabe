# Bunny Stream migration — final delivery report

Date: October 14, 2026. Repository: `sutarorg/erobabe`.
Working branch: `arena/185da4ab-erobabe`; audited baseline: `9aa06f8` (main).

## Summary

Implemented Bunny Stream as the only new-video hosting/upload/processing/playback
provider. Local multiple-file selection and the existing admin layout are retained.
Browser TUS uploads have measured progress, four parallel upload workers, retries,
pause, identity-bound resumability and private metadata recovery. There is no
application-level video-size cap. Each upload is staged immediately with status
Encoding while Bunny transcodes asynchronously; upload workers never wait for
encoding. Library API credentials stay server-only. No video-byte relay or Supabase
video upload remains.

The local thumbnail pipeline ranks ten actual candidate frames throughout a clip
using the existing quality scorer (detail, exposure, contrast, colour and interior
composition). It produces a restrained sharpened/cropped 1280×720 JPEG. Signed
Supabase image upload and verified object existence are mandatory before publishing.
Thumbnail and persistence failures retry independently of transferred video bytes.
Existing manual ffmpeg tools share the restrained grading settings.

Only documented Bunny Finished status 4 can publish through the locked atomic
session/video/upload-job RPC. Processing catalog rows remain private until then,
and the admin library reconciles status in the background. Standard encoding is
required; JIT 7/8 deliberately remain in Encoding. Original MIME/size are reserved
local metadata, duration comes from Bunny
`length`; encoded `storageSize` is not misrepresented as original size.

Playback validates stored library/GUID and exact canonical Bunny embed, with poster,
loading and retry UI. Known historical direct-media/trusted player formats remain;
arbitrary iframe origins are rejected. Cards/watch/admin/SEO consume the stored
thumbnail. Existing category/carousel/manual-image tools, authentication, advertiser,
advertising, payments and email runtime functionality were not replaced.

A forward-only migration archives retired hosted records without deleting metadata,
IDs, URLs or thumbnails, disables their old publication RPC and restricts old recovery
rows to read-only. The administrator sees a re-upload link. No legacy media bytes
were transferred or fabricated. Historical migration files 00–11 are untouched.

Optional OpenRouter vision ranking is implemented, disabled by default, explicitly
consent-gated and provider-pinned. Live image capability is checked before transmitting
up to four actual low-resolution candidates. Any failure retains the deterministic
local winner. No unverified model slug is made a default.

System Health now performs safe server-side Stream API connectivity and displays
recent session lifecycle/failure/thumbnail diagnostics. Browser reports are diagnostic,
not trusted proof of provider readiness.

## Verification results

| Command | Final result |
| --- | --- |
| `npm run type-check` | Passed |
| `npm run test` | Passed: **486 tests, 40 files** |
| `npm run build` | Passed; existing non-fatal Next.js image/lint warnings remain |
| `npm run test:e2e` | **21 passed, 3 pre-existing failures**; all four new Bunny browser tests pass |
| `git diff --check` | Passed |

Unit/route tests mock Bunny and Storage; they are **not live provider acceptance**.
SQL tests include both a targeted PostgreSQL fixture and all actual migrations 00–12
applied unmodified in PGlite with only Supabase-managed auth/storage infrastructure
stubbed. They verify real-schema completion, RLS/grants, preservation and idempotency,
but are not a production Supabase migration run.

New browser tests actually decode a generated video (including a black intro), score
its frames and validate JPEG output/dimensions; corrupt files return no placeholder.
The maintained TUS client is exercised against a **mock TUS protocol**, including
real byte requests, progress, pause, HEAD recovery and a single resource identity.

### E2E failures independently reproduced on original main

The same tests were run against an isolated archive of commit `9aa06f8` without
switching the session branch. All three fail there identically:

1. `auth.spec.ts:16`: expects `/auth/sign-in`; existing administrator redirect is
   `/admin/signin?next=...`.
2. `seo.spec.ts:17`: expects HTTP 404 for a nonexistent video; Next.js streaming
   currently returns HTTP 200 with the missing-page UI in this environment.
3. `seo.spec.ts:31`: expects `video:video` entries; without configured live Supabase
   data the honest video sitemap is empty (namespace present, no video entries).

These unrelated runtime/tests were not rewritten to hide their failures.

The sandbox initially had no Playwright browser. Verification used a disposable
npm-distributed Chromium binary/shared libraries (not committed), with:

```bash
LD_LIBRARY_PATH=/tmp/al2023/lib \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium npm run test:e2e
```

Normal development/CI should use `npx playwright install --with-deps chromium`
then `npm run test:e2e`. The executable override is optional, not a production
application dependency. The isolated baseline server and temporary repository copy
were removed/stopped after comparison. Native binaries, datasets and test artifacts
are excluded from the patch.

## Required and optional environment variables

### Required for core application and Bunny uploads

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` **or** legacy alias `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `NEXT_PUBLIC_SITE_URL` (production canonical origin); `SITE_URL` remains the
  documented server-site setting in `.env.example`.
- `BUNNY_STREAM_LIBRARY_ID` (server-only, positive numeric selected library ID)
- `BUNNY_STREAM_API_KEY` (server-only, **that library's Video Library API key**)

### Optional migration settings

- `OPENROUTER_THUMBNAIL_ENABLED`: default false.
- `OPENROUTER_THUMBNAIL_CONTENT_APPROVED`: default false; both gates must be true.
- `OPENROUTER_THUMBNAIL_MODEL`: no default; live catalogue must list image input.
- `OPENROUTER_THUMBNAIL_PROVIDER`: explicitly approved provider slug; no fallback routing.
- `OPENROUTER_API_KEY`: required only when using metadata AI or optional vision ranking.
- `FFMPEG_PATH`: optional executable override for the existing manual direct-media
  thumbnail tool, not required for automatic local upload thumbnails.

### Existing integration settings (unchanged)

- Payments: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` required for enabled
  production payments; `NOWPAYMENTS_DEFAULT_PAY_CURRENCY`,
  `NOWPAYMENTS_IPN_CALLBACK_URL` optional.
- Metadata AI: `OPENROUTER_API_KEY` when enabled; `OPENROUTER_MODEL`,
  `OPENROUTER_MAX_OUTPUT_TOKENS` optional.
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` for enabled production email;
  `SUPPORT_EMAIL` for the configured support address.
- Tests: `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optional;
  `CI` is a runner flag and `NODE_ENV` is framework-managed, not an application secret.
- `NEXT_PUBLIC_POSTHOG_KEY` remains only a commented future example, not an active
  dependency introduced here.

All retired upload environment variables and feature gates were removed. Remove
retired deployment secrets/jobs as well. Never commit credentials or use public
variable prefixes for Bunny, Supabase service, payment, OpenRouter or email keys.

## Bunny credential setup (click-by-click)

1. Sign in at `https://dash.bunny.net/`; enable MFA/billing/security.
2. Click **Stream** → **Add/Create Video Library**; name it and choose storage
   regions/resolutions, then create it.
3. Open that library → **API** settings.
4. Copy **Video Library ID** to server variable `BUNNY_STREAM_LIBRARY_ID`.
5. Reveal/copy **Video Library API Key** to server secret `BUNNY_STREAM_API_KEY`.
   Do not use account/CDN/Storage keys or a different library's key.
6. Add values to local `.env.local` and application host → Settings → Environment
   Variables/Secrets, with separate staging/production libraries. Next.js cannot
   read secrets stored only in Supabase Edge Function settings.
7. In library Security settings allow actual production/staging referrers. Use
   standard encoding; leave embed playback-token authentication off unless a future
   signed playback implementation is added. Redeploy after changing environments.

See **DEPLOYMENT.md section D** for the complete setup, policy, recovery and test guide.

## Exact forward migration procedure

Back up DB and test staging first. Migrations 00–11 must already be applied, not edited
or re-run. This checkout has no `supabase/config.toml`; initialize locally if needed.

```bash
# Install/use Supabase CLI per its supported installation method.
supabase init  # only if local config.toml is absent
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase db push --dry-run
# Review that only expected pending migrations are listed, then:
supabase db push
```

The new files are `supabase/migrations/00000000000012_bunny_stream_uploads.sql`
and `supabase/migrations/00000000000013_bunny_background_encoding.sql`.
Dashboard alternative: SQL Editor → New query → run both files once, in order,
then reconcile your migration ledger before future CLI pushes. Do not use both
methods to apply the same migration.

Verify `bunny_uploads` RLS/service-only grants, the stage/finalize/fail RPCs, archived
`requires_reupload` rows, retained thumbnail URLs, and removal of the obsolete
finalizer. No migration was applied to a live Supabase project in this session.

## Deployment and genuine acceptance procedure

1. Back up and apply SQL on staging; configure the server environment and public
   Supabase/site variables. Choose Node.js 20+ hosting that permits this business.
2. Deploy the branch changes with `npm ci` / `npm run build`. Validate System Health:
   missing config vs auth failure vs API connected, and session diagnostics.
3. Sign in as an active admin; select multiple authorized local clips and a category.
4. Verify automatic previews, actual Network POST/HEAD/PATCH to Bunny TUS, measured
   progress and no application/Supabase video bytes. Exercise interruption/cancel,
   reload/reselection and safe retry. Verify image PUT to signed thumbnail Storage.
5. Verify Bunny status 4 and exactly one persisted video/job with real library/GUID,
   thumbnail, duration and original upload metadata. Induce thumbnail/DB failures
   and retry without another video transfer.
6. Test cards, admin lists, watch poster/controls, SEO thumbnails and allowed
   production referrers on desktop/mobile. Record sanitized live acceptance evidence.
7. Review orphan/failed provider media manually; deleting a catalog row does not
   automatically delete Bunny media. Preserve historical metadata and a reviewed
   old→new mapping when authorized source files are re-uploaded.

## Remaining blockers and honest migration status

- **No live Bunny or Supabase credentials were available**; real provider upload,
  thumbnail Storage, actual transcoding, account restrictions and mobile/desktop
  playback have not been verified. Sandbox application egress is restricted.
- **No hosted media transfer has occurred.** SQL reports and a clear re-upload
  workflow are in DEPLOYMENT.md. Do not fabricate migrated IDs or remove archives.
- Bunny's current AUP [Adult Content](https://bunny.net/acceptable-use/) conditionally
  accepts adult providers only under Slovenia/all-50-US-state laws and other terms;
  [ToS](https://bunny.net/tos/) still apply. This is not evidence this catalogue,
  account or hosting plan is approved. Obtain legal/support/account confirmation.
- Verify app hosting/content/commercial terms, performer age/consent/copyright,
  legal identity, jurisdiction-specific age assurance, payments approval/wallet and
  Resend domain configuration before launch.
- Optional external frame ranking must remain off without documented selected
  model/provider permission and data-processing consent. No example model was
  assumed vision-capable or approved.
- Browser codec support varies; unsupported/corrupt sources fail visibly and cannot
  publish without a usable real frame. Convert authorized sources locally if needed.
- Unknown create outcomes require dashboard-marker reconciliation, not blind POST
  replay. Incomplete TUS resources have provider expiry; re-signing does not extend
  the original resource lifetime. Completed sessions never republish moderated or
  deleted videos.
- Full E2E has the three verified pre-existing failures described above.
- `npm audit` reports 12 dependency advisories (2 critical in existing test tooling,
  plus other existing tooling/transitive advisories). No broad unrelated dependency
  upgrades were made; review these separately before production.

**Status:** repository migration implemented and tested as described; production
activation requires migration/configuration and genuine authorized staging acceptance.
No claim of live acceptance, account approval or completed legacy-media transfer is made.

## Complete file manifest

### Created

- `app/api/videos/bunny/confirm/route.ts`
- `app/admin/(dashboard)/videos/upload/page.tsx`
- `app/admin/(dashboard)/videos/VideoManager.tsx`
- `app/api/videos/bunny/sessions/route.ts`
- `app/api/videos/bunny/thumbnail-rank/route.ts`
- `docs/BUNNY_MIGRATION_AUDIT.md`
- `lib/video/bunny-validation.ts`
- `lib/video/bunny.ts`
- `lib/video/thumbnail-ranking.ts`
- `lib/video/thumbnail-style.ts`
- `src/utils/bunnyUpload.ts`
- `supabase/migrations/00000000000012_bunny_stream_uploads.sql`
- `supabase/migrations/00000000000013_bunny_background_encoding.sql`
- `tests/e2e/bunny-media.spec.ts`
- `tests/unit/bunny-migration.test.ts`
- `tests/unit/bunny-routes.test.ts`
- `tests/unit/bunny-schema.test.ts`
- `tests/unit/provider-retirement.test.ts`
- `tests/unit/thumbnail-ranking.test.ts`
- `tests/unit/thumbnail-transfer.test.ts`

### Updated

- `.env.example`
- `.gitignore`
- `DEPLOYMENT.md`
- `GO_LIVE_CHECKLIST.md`
- `IMPLEMENTATION_AUDIT.md`
- `IMPLEMENTATION_REPORT.md`
- `README.md`
- `app/(public)/video/[slug]/page.tsx`
- `app/admin/(dashboard)/system-health/page.tsx`
- `app/admin/(dashboard)/videos/VideoManager.tsx`
- `app/admin/(dashboard)/videos/page.tsx`
- `app/admin/(dashboard)/videos/upload/page.tsx`
- `app/api/admin/videos/route.ts`
- `app/api/videos/status/route.ts`
- `app/api/videos/storage-token/route.ts`
- `lib/video/frame-thumbnail.ts`
- `lib/video/playback.ts`
- `lib/video/storage.ts`
- `lib/video/thumbnail-quality.ts`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `src/components/VideoPlayer.tsx`
- `src/utils/localVideoThumbnail.ts`
- `src/utils/uploadFile.ts`
- `tests/live/README.md`
- `tests/unit/frame-thumbnail.test.ts`
- `tests/unit/local-video-thumbnail.test.ts`
- `tests/unit/upload-page.test.tsx`
- `tests/unit/video-playback.test.ts`
- `tests/unit/video-player.test.tsx`

### Deleted

- `app/api/videos/filekosh/confirm/route.ts`
- `app/api/videos/filekosh/sessions/route.ts`
- `docs/FILEKOSH_API_RESEARCH.md`
- `docs/FILEKOSH_IMPLEMENTATION.md`
- `docs/FILEKOSH_REPOSITORY_AUDIT.md`
- `lib/video/filekosh-validation.ts`
- `lib/video/filekosh.ts`
- `tests/unit/filekosh-migration.test.ts`
- `tests/unit/filekosh-routes.test.ts`
- `tests/unit/filekosh-transfer.test.ts`
