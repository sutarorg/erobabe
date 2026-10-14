> **Historical pre-implementation audit.** Its call graph and baseline results describe the starting revision, not the current application. See [DEPLOYMENT.md](../DEPLOYMENT.md#d-filekosh-device-uploads) for the gated implementation and remaining verification.

# Filekosh migration: current repository audit and verification

**Audit date:** 2026-10-14 (UTC)
**Source revision:** `7c8fe9a05cba88384ca80ca476a40a10bc87dfbc`
**Working branch:** `arena/2aae542e-erobabe`

`git ls-remote origin refs/heads/main` returned the same revision as the working branch's starting commit. The audit therefore inspected current `main` source without switching branches. The worktree was clean before verification. Historical implementation reports were not treated as evidence of active routes.

**Status:** Research/audit only. The [official API research](FILEKOSH_API_RESEARCH.md) found a real but incomplete contract. No application code or database behavior was changed, no migration was added/applied, and no provider records or media were altered. README, deployment instructions and environment comments now state this limitation.

## 1. Active publishing call graph

```text
/admin/(dashboard)/layout.tsx
  └─ Supabase getUser + profiles.role=admin + profiles.status=active
/admin/videos/upload (App Router page)
  ├─ categories from Supabase; metadata health check
  ├─ pasted links → splitUrlEntries → classifyVideoSource
  ├─ duplicate precheck → POST /api/admin/videos/duplicates
  ├─ optional image → POST /api/videos/storage-token
  │                    └─ createThumbnailUploadTarget
  │                       └─ browser XHR PUT → Supabase video-thumbnails
  ├─ direct link → POST /api/videos/upload-url
  │                ├─ requireActiveAdmin
  │                ├─ validate/deduplicate URL; custom image or ffmpeg frame
  │                ├─ createGeneratedVideo(provider=direct_url)
  │                ├─ publishVideo(playable_url=source, embed_url=null)
  │                └─ optional Streamtape thumbnail fallback + audit
  └─ player link → POST /api/videos/embed
                   ├─ requireActiveAdmin
                   ├─ normalize/validate/deduplicate embed; custom image
                   ├─ createGeneratedVideo(provider=embed)
                   ├─ publishVideo(playable_url=null, embed_url=source)
                   └─ optional Streamtape thumbnail fallback + audit
```

### `app/admin/(dashboard)/videos/upload/page.tsx`

The real page is titled **“Publish videos by link.”** There is no video-file selector or provider-video transfer. `Item.thumbnail` is the only `File` queued. The page supports multiple links, per-entry direct/embed override, required category, optional image, duplicate warnings/override, sequential publishing, AI/fallback metadata notices, and per-entry results.

`uploadThumbnailFile` obtains a signed Supabase URL and calls `uploadWithProgress`; `publishItem` then sends JSON to the direct or embed route. `uploading` on this page means **thumbnail** upload; `processing` means frame/metadata/publishing work, not Filekosh processing. No upload-job/status polling is wired in.

The current title/description/tags workflow is server generation, not editable local-file metadata fields; published title/description are displayed. Category and thumbnails remain administrator choices. Cancellation aborts image XHR and prevents subsequent queued work, but `postJson` does not accept an AbortSignal: already-running publishing can still finish. This is not provider cancellation.

### `src/admin/UploadView.tsx`

Explicitly labels all three ingestion modes as frontend simulations. Its progress is timer-driven and media properties are a pseudo-probe. It is imported by the old `src/admin/AdminApp.tsx`, not the App Router upload page. Changing it alone would not implement this task.

### `app/api/videos/upload-url/route.ts`

Despite its name, it saves direct media URLs; it neither issues upload authorization nor imports video bytes to a host. It validates category presence and up to 20 links, media extensions, public HTTP(S) URLs, duplicate URLs and database source keys. `createGeneratedVideo` later verifies the category exists. Optional thumbnail paths are resolved with ownership checks; otherwise ffmpeg samples the remote source. Success immediately publishes `provider=direct_url`, not a hosted-video job.

**Residual dependency:** `tryStreamtapeThumbnailFor` is called if no thumbnail was produced, after `publishVideo`, when credentials permit it. Thus neither the route comments nor a test name claiming “no Streamtape API” establishes provider independence. Filekosh completion must not blindly reuse this route. The route uses Node runtime and `maxDuration=300` for thumbnails, not as proof arbitrary video bodies fit a deployment limit.

### `app/api/videos/embed/route.ts`

Normalizes iframe markup/player links and publishes `provider=embed`. Known watch-page URLs can be converted to embed links. It shares category, generated metadata, tag, thumbnail, duplicate and audit conventions with direct publishing. It also calls Streamtape's thumbnail fallback when no image is supplied. Generic embeds are not Filekosh uploads, nor do they acquire a verified provider ID.

### `app/api/videos/storage-token/route.ts` and `lib/video/storage.ts`

Requires an active admin; JSON only, multipart requests return 415, non-thumbnail kinds return 400. Signs thumbnail uploads to public `video-thumbnails`, using admin-prefixed randomized object names, supported image types and a 10 MiB maximum. `resolveThumbnailUrl` verifies the path belongs to the uploading admin. Browser PUT keeps image bytes out of the route.

Legacy `video-incoming` helpers/constants remain (including a 2 GiB video limit and six-hour signed-download TTL), but no active route issues a video-upload target. These are not Filekosh constraints or a reason to route videos through Supabase.

`src/utils/uploadFile.ts` provides real XHR progress and abort events for PUT; older multipart/Streamtape helper text remains. `src/utils/uploadProgress.ts` also retains Streamtape labels. A future browser PUT must handle already-aborted signals, event cleanup, transport-specific timeout/header policy and indeterminate progress, rather than claiming these existing helpers implement Filekosh.

## 2. Provider, jobs and publishing utilities

### `lib/video/provider.ts`

`DEFAULT_VIDEO_PROVIDER` is `direct_url`. `getVideoProvider` maps `direct_url` and `internal` to `InternalProvider`; that object identifies itself as `internal` and is a non-hosting placeholder. Streamtape/UFOLOAD throw retirement errors; Uqload/unknown names throw unknown-provider errors. The interface has information/delete/URL methods, but **no actual upload method**. The placeholder's ready/delete-success answers cannot verify a provider upload.

Repository-wide caller search found no runtime call to `getVideoProvider` outside its definition (tests call it). The active publishing routes explicitly write `direct_url` or `embed`. Changing the factory/default alone would not switch those paths. `VIDEO_PROVIDER=filekosh` is not an enablement switch for this checkout.

### `lib/video/publishing.ts`

- `requireActiveAdmin`: Supabase `getUser`, then `profiles.role === admin` and `status === active`, then service client. New management routes must use this authorization before external requests or writes.
- `createGeneratedVideo`: verifies category, generates/sanitizes title/30–40-word description/tags with deterministic fallback, avoids repeated titles, creates a unique slug, inserts a **processing/private** row, attaches tags, deletes the inserted row if tag attachment fails.
- Existing admin-created rows start `rights_status=cleared` and `moderation_status=approved`. `publishVideo` and `markVideoReady` set published/public/cleared/approved. These helpers are not moderation engines; a future reconciler must not overwrite later rejection/unpublication or publish without verified provider readiness.
- `attachProviderFile` keeps a row processing/private, writing provider IDs/URLs and optional progress. `markVideoFailed`/`failUpload` keep failed videos draft/private. Some failure/progress updates do not check returned database errors; callers must not report success after a failed write.
- `createUploadJob` starts `uploading` at 0; its **default provider remains Streamtape**. `findUploadJobForSession` defaults to Streamtape too. It checks creator/provider, but despite its comment, does not enforce an unclaimed/nonterminal state or atomically claim a job.
- `completeUploadJob` unconditionally sets ready/completed/100. Readiness must be verified first; non-transactional sequence plus a lookup is not enough for retries/concurrent completion.
- Hosted lifecycle helpers have no active upload-route callers in this checkout. Direct/embed publishing creates no `upload_jobs`.
- `VIDEO_PROVIDER_VALUES` includes `direct_url`, `streamtape`, `ufoload`, `uqload`, `embed`, `internal`, `bunny`, `cloudflare`, `s3`; not Filekosh.

`lib/video/duplicates.ts` compares normalized source links and filenames, with a nonunique `source_key` index and explicit admin override. Useful for link warnings, but not byte-level deduplication or atomic hosted-upload idempotency. New upload sessions need durable server ownership and race-safe initiation/completion, not random new videos on each retry.

### `app/api/videos/status/route.ts`

Active-admin-only, reads stored video/job state. There is no provider reconciliation or provider factory call. Direct and Streamtape rows are labeled ready with explanatory notes; UFOLOAD/Uqload are stored history. It does not verify actual media readiness or availability. A Filekosh branch must use its verified status contract, never these unconditional history shortcuts.

## 3. Video management

`app/admin/(dashboard)/videos/page.tsx` loads up to 1,000 rows plus categories and passes them to `VideoManager.tsx`. The manager shows stored provider/status, source kind, category, thumbnail, views and carousel slots. It supports filters, selection/bulk delete, manual thumbnail changes, ffmpeg thumbnails and Streamtape thumbnail folder scan/import. It does not initiate hosted video uploads or poll encoding status.

`app/api/admin/videos/route.ts` uses `requireActiveAdmin` for PATCH/DELETE. PATCH changes thumbnails or carousel slots; DELETE removes catalog rows and best-effort thumbnail objects, with audit and public cache invalidation. It does **not delete provider media**. Provider deletion/cancellation and catalog deletion need explicit, separate semantics if added; do not change legacy deletion behavior incidentally.

Related real callers: `/api/admin/videos/duplicates`, `/api/admin/videos/thumbnails`, `/api/admin/videos/streamtape-thumbnails`, `/api/metadata/suggest`, `/api/admin/metadata/health`. Successful new hosted records should appear through the same catalog query, not through the simulated admin state.

## 4. Playback and legacy preservation

`app/(public)/video/[slug]/page.tsx` selects only published/public/rights-cleared/moderation-approved videos and passes stored URLs to `VideoPlayer`. It currently does **not select/pass `provider`**. `lib/video/playback.ts` selects by URL shape, preferring a real direct URL, then embed; known Streamtape addresses receive a special native-player path. Provider-specific Filekosh URL validation may need a provider prop at these actual callers, not just a factory change.

`src/components/VideoPlayer.tsx` renders:

- Direct URLs with native `<video>`, poster, preload, loading/error and retry controls.
- Streamtape via native `<video src=/api/videos/{id}/playback>` and warm-up POST `/api/videos/{id}/prepare`.
- Other embed sources with responsive iframe, fullscreen, lazy loading, `allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"` and `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"`.

The generic iframe validates HTTP(S)/userinfo via source selection, not an exact Filekosh origin, and has no provider-aware processing/deleted-video UI. Its existing sandbox is not proof the Filekosh player works. Never fabricate `/embed/<internal-id>` or pass an upload URL to the player.

`app/api/videos/[id]/playback/route.ts` validates UUID/range and all publication gates, obtains/caches a Streamtape ticket, consumes its IP-bound URL **on the server**, streams media ranges with no-store headers, retries an expired cached ticket once, and redacts upstream errors. `prepare/route.ts` applies the same access checks and warms tickets without returning a secret URL. Both intentionally retain real Streamtape API dependencies through `streamtape-tickets.ts`, `streamtape-media.ts` and `streamtape.ts`.

Therefore “Streamtape retired” means **new hosted uploads are retired**, not that the legacy playback API is unused. Preserve credentials and streaming-capable hosting while these rows exist. UFOLOAD/Uqload stored playback is retained without upload reconciliation. No rows/IDs/slugs/URLs/thumbnails/publication states have been rewritten in this work.

## 5. Schema audit and future migration

Relevant migrations inspected: `00000000000000` initial schema, `01` RLS, `03` admin publishing/profile security, `04` transit/thumbnail storage, `06` UFOLOAD bookkeeping, `07` Streamtape provider, `08` direct URLs, and `10` admin video tools. `09` adds category images; it does not change provider constraints.

- `videos.provider` default is still `internal`; constraint as expanded by `08` allows all nine historical/current values listed above. Filekosh is not allowed.
- `upload_jobs.provider` is text **without a provider CHECK constraint** in the current migration chain. Its default is still `streamtape` from `07`; `08` did not change it.
- Job status CHECK permits pending/uploading/processing/completed/failed/cancelled.
- Existing fields include video provider_file_id/public_id, playable_url/embed_url, provider_progress/error; job provider_file_id/upload_id/import_id/status, file_name/size, progress/error_message, creator, storage_path.
- `upload_jobs.provider_upload_id` has a global partial unique index, not a provider-scoped one. Confirm whether a Filekosh upload/session ID even exists before assigning semantics; never store expiring signed URLs there.
- `source_key` from `10` is a nonunique normalized-link index, not a concurrency lock.
- Public video SELECT is gated by all four publication/rights/moderation conditions; jobs are admin-only via RLS.

The next available migration number at this audit is **`00000000000011`**. Recheck before implementation. No migration is included now, because no Filekosh upload path is verified/enabled. When unblocked, expand the constraint while retaining all historical values; choose defaults consistent with explicit hosted-job creation; reuse existing columns where the confirmed lifecycle fits. Add concurrency guarantees only for a documented need. Do not modify historical migrations or update old provider labels. Test against a real temporary Postgres/Supabase database populated with legacy rows, including preservation of identifiers, URLs, metadata and publication state.

## 6. Search and test audit

Repository-wide search covered `streamtape`, `direct_url`, `ufoload`, `uqload`, `VIDEO_PROVIDER`, `provider_file_id`, `provider_public_id`, `playable_url`, `embed_url`, `upload_jobs` and upload-related endpoints, plus helper imports/callers. Residual dependencies exist in active routes, media/ticket/thumbnail libraries, system health, player selection, URL helpers, old browser helpers, migrations, tests and historical docs. There is no current hosted-upload start/complete/cancel API or relay directory.

Existing unit coverage was inspected for provider selection, publishing/metadata, direct/embed routes, upload page, source parsing, duplicate detection, thumbnails, video manager, playback/player, ticket/media and prepare routes. The fake Supabase harness provides active-admin fixtures, but is not a real database or migration validation. Some test descriptions are stale: `upload-page.test.tsx` says “no embed” while later assertions verify embed routing; `video-provider.test.ts` calls the factory the single decision point despite active publishing bypassing it. Follow assertions/callers rather than those comments.

Existing Playwright tests cover auth, payment/metadata access and SEO, not authenticated file uploads or Filekosh playback. Live tests cover OpenRouter and read-only Streamtape thumbnails; none validates Filekosh.

## 7. Checks actually run

Environment: Node `v22.22.3`; npm `10.9.8`; lockfile resolves Next.js `15.5.27`. No configured Supabase or authorized Filekosh staging account/media was used. Application fallback therefore serves empty database data. Checks were run on the unchanged application code; subsequent changes are documentation/comments only.

| Command | Actual result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; installed 223 packages. Deprecation warning for `whatwg-encoding`. No dependency manifests changed. |
| `npm run type-check` | Passed (exit 0). |
| `npm run test` | Passed: **45 test files, 653 tests** (exit 0). Existing React `act(...)` warnings in upload-page tests and expected metadata/fallback diagnostic logs were emitted. |
| `npm run build` | Passed (exit 0), Next.js 15.5.27, compiled and generated 65 static pages. Webpack cache serialization performance warnings; no build error. |
| `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --workers=2 --reporter=line` against `npm run start` | **10 passed, 10 failed** (exit 1). **9** browser tests failed before executing because Playwright's Chromium headless-shell executable was not installed. **1** request test (`seo.spec.ts`, video-sitemap structure) expected `video:video`, but the unconfigured Supabase fallback returned an empty `<urlset>`. This run is not a passing E2E suite. |
| Live Filekosh upload/processing/embed, desktop/mobile player acceptance | **Not run; blocked.** Required confirmation contract incomplete, no authorized test setup, and application outbound allowlist excludes Filekosh/storage hosts. Research-page retrieval does not lift this restriction. |
| Migration execution/preservation tests | **Not run.** No new migration and no real database configured. |
| Documentation review | `git diff --check`, local Markdown-link existence and code-fence balance checks passed. The generated tracked TypeScript build-info artifact was restored; only documentation/environment comments remain changed. |

No simulated Filekosh tests or invented provider fixtures were added. Required new-provider tests remain pending: configuration/secrets, documented HTTP contracts, provider failures/timeouts, real byte progress, cancellation/retry/idempotency races, authorization on all management operations, response identity/origin validation, processing/deleted media, responsive iframe playback and migration preservation. Existing green unit tests only establish the current baseline.

## 8. Safe deployment and next action

Keep current URL/embed publishing and legacy playback unchanged. Do not set `VIDEO_PROVIDER=filekosh`, invent credential variables, deploy the retired Streamtape relay instructions, or relabel historical rows. No new environment value or migration enables Filekosh in this patch.

The owner must obtain the clarification listed in [the research report](FILEKOSH_API_RESEARCH.md#5-exactly-what-must-be-obtained), written content/use approval and a private staging credential configuration. Then implement the real App Router flow and forward migration, run contract-based automated tests and a genuine staging upload/playback test before enabling hosted uploads. Browser CORS and deployment resource limits must be measured, not inferred from marketing or a successful Next.js build.
