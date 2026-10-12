# Streamtape migration — audit, research & decision report (Prompt 1)

Research date: **2026-10-12** (UTC). Branch: `arena/f6d90aa6-erobabe`, base commit `9277afa`.
All live claims below were either executed (marked RUN) or explicitly marked BLOCKED. Nothing is
claimed as tested unless it was run in this environment.

---

## 1. End-to-end map of the current system (as audited)

### 1.1 Direct file upload (active UFOLOAD flow)

```
app/admin/videos/upload/page.tsx (real page; NOT src/admin/UploadView.tsx — see §1.5)
  │  user picks files + category, optional thumbnail
  ├─ POST /api/gemini/suggest            → title/description/tags while bytes still local (client preview)
  ├─ POST /api/videos/storage-token      → signed Supabase upload for the thumbnail only
  ├─ POST /api/videos/ufoload-session    → requireActiveAdmin → UfoloadProvider.initDirectUpload
  │     (POST {UFOLOAD_API_BASE}/files/uploads, API key server-only)
  │     → startUfoloadUpload() creates upload_jobs row (provider='ufoload',
  │       provider_upload_id=<grant.upload_id>) and returns {jobId, uploadId, url,
  │       authorization (upload-scoped grant), chunkSize, maxBytes}
  ├─ browser PUT chunks → grant URL (src/utils/ufoloadUpload.ts + putUploadChunk;
  │     byte progress, resume via GET offset, keep-alive via session route)
  ├─ POST /api/videos/upload {uploadId, jobId, categoryId, fileName, thumbnailPath, metadata}
  │     → findUploadJobForSession(uploadId, userId)        [never trusts browser for file id]
  │     → createGeneratedVideo (Gemini or prepared metadata; videos row status='processing',
  │       visibility='private'; tags upserted; metadata source 'ai'|'fallback')
  │     → UfoloadProvider.completeDirectUpload → file id from provider
  │     → attachProviderFile(embed_url=https://ufoload.com/e/{id}, playable_url=/v/{id},
  │       provider_public_id, provider_progress) ; job → processing/failed
  │     → markVideoReady ONLY when provider status==='ready'
  ├─ GET /api/videos/status?jobId|videoId → reconcileUfoloadRecord (file or import task),
  │     promotes to public only on provider 'ready'; removes transit object; audit note
  └─ cancel: POST /api/videos/ufoload-cancel {uploadId} (DELETE /files/uploads/{id})
             + DELETE ?jobId → job 'cancelled'
```

### 1.2 Upload by link

```
page → POST /api/videos/upload-url {categoryId, entries:[{url, thumbnailPath}]}
  → assertPublicHttpUrl (SSRF guard: no localhost/RFC1918/link-local/credentials)
  → startUfoloadImport → provider POST /files/import → 202 + task id
  → upload_jobs.provider_import_id (deliberately NOT provider_file_id)
  → response status 'queued' (never 'published'); row private
  → /api/videos/status reconciles task → file → conversion; grace 6 h then failed
  → concurrency cap MAX_ACTIVE_IMPORTS=10 (provider 409/429 stops the batch)
```

### 1.3 Embed mode (provider-independent — must be preserved)

`POST /api/videos/embed` → `extractIframeSource` (public-URL validation) → `createGeneratedVideo`
(provider='embed') → `publishVideo` immediately (no provider polling). No UFOLOAD involvement.

### 1.4 Gemini metadata + publish gates

* Client preview: `app/api/gemini/suggest/route.ts` → `lib/gemini/client.ts`
  (`suggestVideoMetadata`, Zod `suggestionSchema`, structured output, loose-JSON repair,
  retry ×2, `PERMITTED_TAGS`/`KNOWN_CATEGORIES` whitelists).
* Server truth: `createGeneratedVideo` uses prepared metadata when valid, otherwise calls Gemini;
  on any failure → `fallbackSuggestion` (filename-derived) with `source:'fallback'` +
  warning surfaced to the admin and counted in the UI. Fallback is never labelled AI.
* Public gate: `app/(public)/video/[slug]/page.tsx` queries
  `status='published' AND visibility='public' AND rights_status='cleared' AND
  moderation_status='approved'`; renders `embed_url` iframe (preferred), else `playable_url`
  `<video>`, else placeholder; increments views, related videos, canonical/OG metadata,
  VideoObject JSON-LD. Sitemap: `app/sitemap.ts` + `app/video-sitemap.xml/route.ts`.
* Audit: `video_published_from_upload` / `video_import_started` / `video_published_from_embed`
  rows in `audit_logs`.

### 1.5 Real vs simulated upload UI (verified by imports)

* **Real**: `app/admin/videos/upload/page.tsx`, linked from `app/admin/AdminNav.tsx` and
  `app/admin/videos/page.tsx`. All `/api/videos/*` calls originate here.
* **Simulated**: `src/admin/UploadView.tsx` — imported only by `src/admin/AdminApp.tsx`
  (`src/App.tsx` demo shell, referenced from root `index.html`); it never calls the API and
  mutates local state only. **Do not wire production to it.** (Left untouched — it is a demo.)

### 1.6 Database & RLS (verified in migrations)

* `videos.provider`: check constraint history — `000000` (uqload…), `000003` (+embed),
  `000006` (+ufoload). `upload_jobs.provider` has **no** check constraint (default set by
  `000006` to 'ufoload'). RLS: `upload_jobs` admin-only (`00000000000001`), videos public read
  filtered by status; writes admin/service (`00000000000003` adds publish functions/guards).
* `000006` added generic columns reusable by Streamtape: `videos.provider_public_id`,
  `provider_progress`, `provider_error`; `upload_jobs.provider_upload_id` (unique partial),
  `provider_import_id`, `provider_status`.
* Legacy rows `provider IN ('uqload','ufoload')` keep stored `embed_url`/`playable_url`;
  `/api/videos/status` already refuses to contact retired Uqload and must do the same for
  UFOLOAD after this migration.

### 1.7 Tests (baseline RUN in this environment, 2026-10-12)

* `npm ci` ✓ · `npm run type-check` ✓ · `npm test` ✓ **29 files / 384 tests passed**.
* Suites: `tests/unit/ufoload-*.test.ts` (9 files), `upload-page.test.tsx`, `video-*`,
  `gemini.test.ts`, route harness with `helpers/mock-ufoload.ts`.
* `tests/live/ufoload.live.test.ts` (gated `LIVE_UFOLOAD=1`), excluded by `vitest.config.ts`.
* `tests/e2e/{auth,payments,seo}.spec.ts` (Playwright, `npm run test:e2e`).
* **RUN note**: `npx playwright install chromium` FAILS in this sandbox (browser CDN blocked) —
  `npm run test:e2e` is **BLOCKED** here (reported in Prompt 3).

---

## 2. Streamtape research (authoritative first)

| # | Fact | Source (fetched 2026-10-12) |
|---|------|------------------------------|
| R1 | Base URL `https://api.streamtape.com`; GET/POST; HTTPS only (HTTP → 302). Credentials: **API Login & API Key** from User Panel → Account Settings (`streamtape.com/accpanel`) | https://streamtape.com/api |
| R2 | Response envelope `{status, msg, result}`; status codes: 200 OK, 400 bad params, 403 permission denied/wrong key/not yours, 404 not found, **451 unavailable for legal reasons**, **509 bandwidth exceeded (retry later, peak hours)**, 50x server errors. Use `status` to branch, `msg` only for display | https://streamtape.com/api |
| R3 | Upload: `GET /file/ul?login&key&folder&sha256&httponly` → `{status,msg,result:{url, valid_until}}` (e.g. `https://tapecontent.net/xfsupload/<id>`). “Uploads shall be POSTed to the upload URL … multipart/form-data”. curl example field name: **`file1`**: `curl -F file1=@file https://tapecontent.net/xfsproupload/<id>` | https://streamtape.com/api |
| R4 | `login`/`key` are listed *not required* for `/file/ul` (anonymous upload URLs possible); required for `account/info`, `listfolder`, `runningconverts`, `failedconverts`, `getsplash`, `remotedl/*`, file management | https://streamtape.com/api |
| R5 | File info: `GET /file/info?file=<id(s),max 100>&login&key` → `result` is a **map keyed by file id**: `{id, name, size, type, converted: true, status: 200}` | https://streamtape.com/api |
| R6 | `GET /file/listfolder` → `result:{folders:[{id,name}], files:[{name,size,link,created_at,downloads,linkid,convert}]}`; `convert` example value `"converted"` | https://streamtape.com/api |
| R7 | `GET /file/runningconverts` → array `{name, folderid, status:'new'|'pending', progress:0–1 (0.75), retries, link, linkid}`; `GET /file/failedconverts` → `{status:'error', …}` | https://streamtape.com/api |
| R8 | `GET /file/getsplash?file=` → `result: "https://thumb.tapecontent.net/thumb/<id>/thumb.jpg"` (stable-looking splash URL) | https://streamtape.com/api |
| R9 | Remote upload: `remotedl/add?login&key&url&folder&headers&name` → `{id, folderid}`; `remotedl/status?id` → `result:<idMap>{id, remoteurl, status:'new', bytes_loaded, bytes_total, folderid, added, last_update, extid, url}`; `remotedl/remove?id` (or `"all"` — **never use "all"**). Full status vocabulary beyond `'new'` **not documented** | https://streamtape.com/api |
| R10 | Embed player: `https://streamtape.com/e/{fileId}` (documented in “Custom Player Color”/subtitles/thumbnail examples); watch links `https://streamtape.com/v/{fileId}/{name}`; Player.js supported | https://streamtape.com/api |
| R11 | Terms: prohibit child sexual content (CSAM), rights violations; user warrants rights/consent; **no explicit clause either permitting or banning lawful consensual adult content**; copyright/DMCA policy with takedowns | https://streamtape.com/terms-and-conditions · https://streamtape.com/copyright |
| R12 | Secondary (corroborating, not authoritative): wrappers confirm field `file` also used and envelope `{status,msg,result}`; 15 GB size claim (2021 README); upload-node **response body is not documented anywhere** | github.com/scaldings/streamtape-api-python, github.com/whomiri/streamtape-api, github.com/swadhinbiswas/Streamtape |
| R13 | Mirrors of the same API doc exist (`strtpe.link/api`, `strcloud.link/api`, `stapadblockuser.art/api`) — identical content, used only to corroborate R1–R10 | fetched 2026-10-12 |

### What could NOT be verified from this environment (BLOCKED — precise reasons)

1. **Sandbox egress** is allowlisted to `github.com`, `codeload.github.com`, `api.github.com`,
   `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. RUN: `curl https://api.streamtape.com/file/ul`
   → `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (connection blocked). No live API call is possible.
2. **No credentials**: no `STREAMTAPE_*`, `UFOLOAD_*`, `GEMINI_*`, `SUPABASE_*`, or `.env.local`
   present (RUN: `env | grep …` empty).
3. **CORS of the upload node**: cannot be proven — no network path, no credentials, no browser
   (Playwright browser download RUN → `Download failure, code=1`). Server-side curl would not
   prove CORS anyway (browser-enforced).
4. **Upload-node multipart field name** (`file1` per official example vs `file` in wrappers) and
   **exact response body** (undocumented) — require a real authenticated/anonymous live upload.
5. Whether `/file/info` lists a file immediately after the node accepts it (before conversion).
6. Full `remotedl/status` transition vocabulary (`new → ? → done`), and whether the finished
   entry's `url`/`extid` reliably carries the file id.
7. Account-level limits: per-file max size, concurrent upload slots, bandwidth (509) thresholds,
   adult-content/account settings in the panel.
8. Staging Supabase + admin account + real Gemini key for the browser acceptance flow.

---

## 3. Required decision

### 3.1 Direct browser upload: **NOT PROVEN → BLOCKER**

Per the gate, direct browser→node upload is only approvable with evidence of (a) readable CORS
response, (b) exact multipart field name, (c) exact response body/ID mapping. None can be
produced from this environment (§2 BLOCKED 1–4). **No fake/mock upload path will ship.**

### 3.2 Approved architecture: browser → streaming relay → Streamtape node

The bytes never pass through Next.js/Vercel (function body limit 4.5 MB — already documented in
this repo’s `src/utils/api.ts` and DEPLOYMENT.md), and CORS against the provider node is no
longer a dependency of the app:

```
Admin browser ── multipart POST (XHR, byte progress, cancel=abort)
      │            {RELAY}/upload/{signed-token}
      ▼
Streaming relay (standalone Node ≥18 process, NOT Next.js/Vercel)
      │  verifies HMAC token (minted server-side by the app), one-shot, streams body
      ▼
Streamtape upload node (URL from GET /file/ul — host-allowlisted, https)
      └── response (status + body) passed through verbatim to the browser
```

**Deployment requirements (documented in DEPLOYMENT.md):** an always-on Node 18+ host (VPS,
Docker, Fly.io, Railway, Cloud Run…); env `STREAMTAPE_RELAY_SECRET` (shared with the app),
`STREAMTAPE_RELAY_ALLOWED_ORIGINS`, port; **must not** run as a Vercel/serverless function;
HTTPS in front; single-instance in-memory one-shot token cache (multi-instance → shared store).
If `STREAMTAPE_RELAY_URL` is unset, the session route fails closed with an actionable error.

**Transfer design:** one multipart POST per file (Streamtape documents no chunk/resume protocol —
this is a provider constraint to state in docs/UI). Progress and cancellation are real
(`xhr.upload.onprogress`, `xhr.abort` → relay aborts upstream → provider drops the partial body).

**File-id provenance (never guess):** server parses the pass-through node response for a
candidate id, then **confirms server-side** via `/file/info` (id + name + size must match the
job); fallback: bounded `/file/listfolder` reconciliation (exact name+size+created-window,
unclaimed id only). If neither resolves within the bounded window, the row stays
`processing`/private with a re-check action, and eventually fails with an actionable reason —
never marked live.

### 3.3 Provider policy gate

Terms (R11) neither clearly permit nor ban lawful consensual adult content → keep the repo’s
fail-closed pattern: `STREAMTAPE_ADULT_CONTENT_ALLOWED=false` default; uploads refuse with an
actionable message until the owner verifies (a) Streamtape ToS/copyright policy for their use,
(b) the account’s content settings in the panel, (c) rights/consent for their catalog.

---

## 4. Files to add / modify / retire / test

| Action | File | Reason |
|--------|------|--------|
| add | `lib/video/streamtape-protocol.ts` | pure envelope/parsers/status mapping/errors/redaction/embed URL (browser-safe) |
| add | `lib/video/streamtape.ts` | server-only provider: `/file/ul`, `/file/info`, converts, splash, remotedl, account/info, rename/delete, fail-closed gate |
| add | `lib/video/streamtape-flow.ts` | session start, completion + file-id confirmation, reconciliation, remote-import lifecycle |
| add | `lib/video/relay-token.ts` | HMAC sign/verify for relay tokens (server-only) |
| add | `relay/streamtape-relay.mjs` | zero-dependency streaming relay (standalone process) |
| add | `app/api/videos/streamtape-session/route.ts` | upload URL + relay token + job (JSON only) |
| add | `app/api/videos/streamtape-cancel/route.ts` | cancel session/import bookkeeping (remotedl/remove for imports) |
| add | `supabase/migrations/00000000000007_streamtape_video_provider.sql` | allow `streamtape` in `videos_provider_check`; default new jobs; processing index. Forward-only, additive |
| add | `tests/unit/streamtape-{protocol,provider,flow,session-route,upload-route,status-route,upload-url-route,cancel-route}.test.ts`, `relay-token.test.ts`, `relay.test.ts` | required coverage (success/error envelopes, malformed JSON, status mapping, redaction, credential safety, oversize, fake ids, duplicate completion, remote validation, failure stays private…) |
| add | `tests/live/streamtape.live.test.ts` | opt-in real suite (`LIVE_STREAMTAPE=1`): account info, upload URL, real small upload, id capture, conversion polling, splash/embed, remote import, cleanup policy, CORS header probe (with real-browser check still required) |
| add | `tests/e2e/streamtape-upload.acceptance.spec.ts` | gated real-browser acceptance (`LIVE_E2E_STREAMTAPE=1` + staging creds), skips otherwise |
| add | `docs/STREAMTAPE_MIGRATION.md` | this report |
| modify | `lib/video/provider.ts` | factory: `streamtape` active default; `ufoload`/unknown fail closed with migration-aware errors |
| modify | `lib/video/publishing.ts` | provider unions → `streamtape`; error mapping for `StreamtapeError`; session lookup accepts streamtape jobs |
| modify | `app/api/videos/upload/route.ts` | Streamtape completion (uploadId session, node-response candidate + server-side confirmation) |
| modify | `app/api/videos/status/route.ts` | Streamtape reconciliation; legacy `ufoload`/`uqload` answered as stored, never contacted |
| modify | `app/api/videos/upload-url/route.ts` | `remotedl/add` + status shape; caps; queued ≠ published |
| modify | `app/admin/videos/upload/page.tsx` | single multipart POST to relay with real progress/cancel; copy updates; keep embed/thumbnail/Gemini flows |
| modify | `app/admin/system-health/page.tsx` | Streamtape: configured + real `account/info` reachability, no secrets, never “operational” from a flag alone |
| modify | `src/utils/uploadFile.ts` | add multipart-with-progress helper; remove UFOLOAD chunk/resume helpers |
| modify | `next.config.mjs` | allow `streamtape.com` / `tapecontent.net` / `thumb.tapecontent.net` image hosts |
| modify | `.env.example`, `DEPLOYMENT.md`, `GO_LIVE_CHECKLIST.md`, `README.md`, `tests/live/README.md`, `vitest.live.config.ts` | env names, relay deployment, live-test commands, remove UFOLOAD active setup steps |
| retire | `lib/video/ufoload.ts`, `ufoload-protocol.ts`, `ufoload-flow.ts`, `app/api/videos/ufoload-session/*`, `ufoload-cancel/*`, `src/utils/ufoloadUpload.ts` | replaced; no dead routes may remain |
| retire | `tests/unit/ufoload-*.test.ts` (9), `helpers/mock-ufoload.ts`, `tests/live/ufoload.live.test.ts` | replaced by Streamtape suites (same behavioral coverage) |
| untouched | migrations `000000`–`000006`, legacy rows/embed URLs, Gemini client, embed route, thumbnails, ads/auth/payments/UI design, `src/admin/UploadView.tsx` (demo shell) | history preserved; unrelated areas unchanged |

---

## 5. Migration / rollback plan

* **DB**: single forward migration `00000000000007` (constraint + default + index). No edits to
  applied migrations; no rewrites of existing rows. Legacy `uqload`/`ufoload` videos keep their
  stored `embed_url`/`playable_url` and continue to render; `/api/videos/status` marks them
  historical and performs **no** provider calls.
* **Deploy order**: run migration → set env (`VIDEO_PROVIDER=streamtape`,
  `STREAMTAPE_LOGIN/KEY/FOLDER_ID`, `STREAMTAPE_ADULT_CONTENT_APPROVED`-equivalent gate,
  `STREAMTAPE_RELAY_URL`, `STREAMTAPE_RELAY_SECRET`) → deploy relay → deploy app → System Health
  → smoke test (`GO_LIVE_CHECKLIST.md` §D).
* **Rollback**: set `VIDEO_PROVIDER=internal` (new uploads refuse, embeds keep working) or
  redeploy previous app version; migration 000007 needs no down-script for that (constraint still
  accepts `ufoload`); legacy playback unaffected either way. Relay can stay deployed idle.
* **Credential rotation**: generate new credentials in the Streamtape panel → update
  `STREAMTAPE_LOGIN` / `STREAMTAPE_API_KEY` in the hosting secrets only (server-only, never
  `NEXT_PUBLIC_*`) → redeploy → System Health. Relay-secret rotation: change
  `STREAMTAPE_RELAY_SECRET` in the relay and the app together (in-flight sessions become
  invalid; admins restart them).

## 6. Pass/fail checklist for implementation + real-upload acceptance

Implemented only if: factory fails closed on unknown/`ufoload`; no credentials in any response,
log, audit row or error (unit-tested redaction); upload bytes only browser→relay→node; session/
completion/status/import/cancel all admin-gated; file id confirmed server-side; row public only
on provider `converted=true` (never on “uploaded” or “queued”); Gemini `source:'ai'` persisted
only for real AI output; embed `https://streamtape.com/e/{id}` saved; legacy rows untouched;
`npm ci`/`type-check`/`test`/`build` green; live suite present & skipped without opt-in.

Real-upload acceptance (requires owner env — currently **BLOCKED**): live suite proves upload URL
acquisition → real bytes → node response/field-name evidence → file id → `/file/info`
conversion → splash + embed reachable; then staging browser run proves byte progress → conversion
wait → `source:'ai'` metadata persisted → publish → `/video/[slug]` renders the Streamtape iframe
→ player frame loads (desktop+mobile) → sitemap only lists eligible rows.

---

## 7. Implementation & acceptance status (updated after Prompts 2–3, 2026-10-12)

### Implemented

* Provider/protocol/flow modules, relay + signed one-shot tokens, session/upload/status/
  upload-url/cancel routes, real admin page rewired (not `src/admin/UploadView.tsx`),
  System Health with a real `/account/info` probe, forward migration `00000000000007`,
  `.env.example` and docs. UFOLOAD code, routes, helpers and tests are retired; legacy rows are
  untouched and never contacted.
* Two defects were found *by the new tests* and fixed: (1) HTTP-509 hit the generic 5xx branch
  and lost its bandwidth hint; (2) an HTTP-200 envelope failure (e.g. 403) bypassed credential
  redaction.

### Commands actually run in the build sandbox

| Command | Result |
| --- | --- |
| `npm ci` | PASS (255 packages) |
| `npm run type-check` | PASS |
| `npm test` | PASS — 29 files / 396 tests |
| `npm run build` | PASS |
| `npm run test:e2e` | **BLOCKED** — `browserType.launch: Executable doesn't exist`; the Playwright browser download is blocked by the sandbox's egress allowlist. 10 pre-existing e2e tests could therefore not run (they failed identically before this change for the same reason); the new acceptance spec is skipped (gated). |
| `LIVE_STREAMTAPE=1 npm run test:live` | **BLOCKED** — fails fast: `STREAMTAPE_LOGIN and STREAMTAPE_API_KEY must be set` (no credentials in the sandbox; egress to `api.streamtape.com` is also blocked). Without `LIVE_STREAMTAPE=1` all 8 tests skip. |

### Live acceptance: **BLOCKED — NOT PERFORMED**

No video was uploaded to Streamtape, no conversion was observed, no Gemini `source:'ai'` call
was made against the real API, nothing was published to a staging database, and no public page
or player was loaded. Nothing in this PR claims otherwise. Unproven (needs the owner's account +
staging): upload-node field name (`file1` vs `file`) and response body, node CORS in a real
browser, `remotedl/status` vocabulary, real size/concurrency limits, adult-content account
settings, player playback on desktop/mobile.

### Known limitations / follow-ups

* Streamtape documents no resumable upload: an interrupted upload restarts.
* The relay's single-use cache is in-memory (single instance).
* Concurrent completion of the *same* session is rejected by a read-then-write check, not a
  database constraint; the unique index on `provider_upload_id` plus the `video_id` check make
  duplicate publication unlikely but a DB-level guard would be stricter.
* `lib/video/streamtape-flow.ts` has no dedicated unit file; its behaviour is covered through the
  route tests.
