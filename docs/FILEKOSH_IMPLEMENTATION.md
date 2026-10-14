# FileKosh device-upload implementation — 2026-10-14

## Status

Implemented and locally validated, **not production/live-provider accepted**.
Creation fails closed until verified provider contract and browser transport configuration
are supplied. The official `/docs` and `/api/v1/openapi.json` still omit confirmation
body, create response schema, signed PUT headers, MIME/codec matrix, storage hosts,
expiry/renewal and browser CORS requirements. There were no configured FileKosh/Supabase
credentials; the application-network allowlist excludes FileKosh/storage hosts.
No deployment, live upload, real storage persistence or iframe acceptance is claimed.

## Changes

- Replaced App Router upload page with multi-file device drag/drop, editable titles,
  category, actual thumbnail previews, real XHR progress, bounded workers (default 2),
  independent states, failure retries and safe transfer cancellation.
- Server-only FileKosh adapter plus admin-authorized session and confirmation routes.
  JSON metadata only; browser PUTs original File bytes to provider storage.
- Durable server-owned reservations prevent blind create retries after uncertain outcomes.
  Confirmation claims are atomic; uncertain POST outcomes reconcile through GET.
- Confirmation requires matching READY WEB video metadata and returned FileKosh-origin
  embed before atomic Supabase persistence. READY-but-database-failed sessions retry
  persistence without a second video transfer.
- Local `<video>` + canvas captures actual interior frames into compressed JPEGs; failed
  decoding is reported separately. Images PUT through existing Supabase signed targets.
- Public watch page/player handles verified returned embeds, retaining legitimate stored
  direct/generic-embed playback and explicitly marking retired-provider records unsupported.
- Removed link/embed ingestion routes and their unused parsing/duplicate/provider helpers,
  old simulation upload modes, active Streamtape API/tickets/media/thumbnail routes/tests,
  multipart relay client, transit helpers and obsolete setup guides/configuration.
  There was no relay directory in the starting checkout. Historical migrations remain
  unchanged; remaining provider references identify unsupported history or retained posters.
- Added noninteractive ESLint configuration; lint previously prompted for initial setup.
  Existing legacy warnings remain warnings rather than being hidden as a clean lint run.

## Important files

Added: `lib/video/filekosh.ts`, `filekosh-validation.ts`,
`app/api/videos/filekosh/sessions/route.ts`, `confirm/route.ts`,
`src/utils/localVideoThumbnail.ts`, migration `00000000000011_filekosh_uploads.sql`,
four FileKosh/local-thumbnail test files plus direct-transfer tests, `.eslintrc.json`.

Modified: actual admin upload page and video manager, public video page/player,
shared PUT helper, thumbnail storage/authorization helpers, System Health,
`.env.example`, README and deployment/checklist documentation.

Removed: `lib/video/streamtape*.ts`, Streamtape thumbnail route, video playback/prepare
API routes, upload-url/embed ingestion routes, URL entries/links/duplicate helpers,
unused provider abstraction, transit and relay helpers, obsolete workflow tests/docs.
Legacy standalone UploadView now delegates to the real authenticated dashboard.

## Database/configuration

Apply migration 11 **forward**, after previous migrations, without changing existing
SQL history. It preserves provider records, adds MIME/size/share fields, creates a
service-role-only session table and transactional `finish_filekosh_upload` function.
Video/job finalization and session completion roll back together on failure; retries
cannot republish later-moderated records or insert duplicate catalog entries.

Required server variables: `FILEKOSH_API_KEY`, `FILEKOSH_CONTRACT_VERIFIED`,
`FILEKOSH_BROWSER_UPLOAD_VERIFIED`, `FILEKOSH_ALLOWED_MIME_TYPES`,
`FILEKOSH_MAX_UPLOAD_BYTES`, `FILEKOSH_UPLOAD_HOSTS`,
`FILEKOSH_UPLOAD_HEADERS_JSON`, `FILEKOSH_CONFIRM_BODY_TEMPLATE`.
Optional: `FILEKOSH_UPLOAD_CONCURRENCY` (integer clamped 1–3).
Existing Supabase public URL/key and server-only service key remain required.
No real secrets or guessed provider confirmation example are supplied.
See DEPLOYMENT.md section D for exact setup, testing and troubleshooting.

## Actual checks

| Command | Result |
| --- | --- |
| `npm run type-check` | Passed. |
| `npm run lint` | Passed with 44 warnings (legacy image/markup/hooks guidance); no errors. |
| `npm test` | Passed: 37 files, 447 tests. Retired-workflow tests were removed, replacements exercise device queue, transport, authorization, contract gate, confirmation, partial failure, retries, cancellation and playback. |
| `npm run build` | Passed, Next.js 15.5.27; public/admin/advertiser/payment routes compile. |
| Embedded PostgreSQL migration test (part of `npm test`) | Passed on a schema fixture: SQL executes, legacy record survives, anonymous private-session access is denied, unconfirmed finalization fails, repeated finalization yields one video/job. This is not a live Supabase schema inspection. |
| `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --workers=2 --reporter=line` | 10 passed, 10 failed. Nine could not launch because Chromium headless-shell is absent. One assumes a populated video sitemap, but unconfigured Supabase produces an empty sitemap. Matches the recorded starting-environment limitations; not a passing browser suite. |
| `git diff --check` | Passed after cleanup. |
| Live FileKosh/CORS/Supabase/player test | Not run; blocked as above. |

## Remaining limitations

- Operator must obtain the missing contract and authorized staging/browser evidence;
  do not bypass gates with guessed values. The structural confirmation template is an
  extension point, not a verified provider request schema.
- Strict response validation may reject legitimate undocumented response variations;
  update the adapter from verified examples, never silently publish incomplete data.
- FileKosh `url` is not documented as direct media, so native playback is not used.
  Sandbox has no popup/top-navigation permissions but compatibility remains untested;
  it cannot remove in-player advertising.
- No invented resumable, expired-URL-renewal, cancellation or orphan-deletion API.
  Cancel aborts XHR. Unknown create outcomes, partial/expired uploads and provider
  retention need reconciliation/cleanup. Catalog deletion does not delete remote media.
- Reload recovery can finish known sessions; browser File objects and generated JPEGs
  not yet stored are not durable. No global rate coordinator across administrators;
  concurrency/backoff respects responses but cannot guarantee a shared per-key budget.
- Live production schema must be checked on staging before applying the migration.
  Existing npm dependency advisories were reported during installation; no broad
  dependency/security upgrade was attempted as part of this provider migration.
