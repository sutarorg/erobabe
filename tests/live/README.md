# Live Streamtape integration tests

These tests talk to the **real** Streamtape API with real credentials. They are
excluded from `npm test` (see `vitest.config.ts`) and skipped unless you opt in.

```bash
LIVE_STREAMTAPE=1 STREAMTAPE_LOGIN=... STREAMTAPE_API_KEY=... npm run test:live
```

| Variable | Purpose |
| --- | --- |
| `LIVE_STREAMTAPE=1` | Required. Without it every test is skipped. |
| `STREAMTAPE_LOGIN` / `STREAMTAPE_API_KEY` | Required. User Panel → Account Settings → API/FTP credentials. |
| `STREAMTAPE_FOLDER_ID` | Optional. Upload into this folder. |
| `LIVE_STREAMTAPE_FILE` | Optional. Absolute path to a small video **you have the rights/consent to use**. Default: a 3-second synthetic ffmpeg test pattern (requires `ffmpeg`). |
| `LIVE_STREAMTAPE_IMPORT_URL` | Optional. Public direct video URL; enables the `remotedl` test. |
| `LIVE_STREAMTAPE_ORIGIN` | Optional. `Origin` for the CORS probe (default `https://erobabe.com`). |
| `LIVE_STREAMTAPE_KEEP=1` | Optional. Keep created files. Default: delete **only the files this run created** (never a blanket delete). |

## What the suite proves (when it runs)

1. `/account/info` authenticates; bad credentials produce a redacted, actionable error.
2. `/file/ul` returns an upload URL on an allowed host.
3. **Evidence for the open questions** in `docs/STREAMTAPE_MIGRATION.md`:
   which multipart field name the node accepts (`file1` vs `file`), the node's
   response shape, whether the id in it is confirmable via `/file/info`, and the
   node's CORS headers (Node-side hint only).
4. A small real upload → confirmed file id → polling `/file/info` until
   `converted`, with `/file/failedconverts` checked → splash URL → the embed
   page `https://streamtape.com/e/{id}` answers 200.
5. Optional `remotedl/add` → `remotedl/status` vocabulary captured.

Evidence is written to `test-results/streamtape-live-evidence.json`
(git-ignored; credentials are redacted).

## What it does NOT prove

* **Browser CORS.** A Node `fetch` cannot prove that a browser may read the node's
  response. The app therefore uses the relay; the authoritative browser check is
  the gated Playwright spec below.
* The admin UI, Gemini `source: "ai"` metadata, publication and public playback.

## Browser acceptance (staging only)

```bash
LIVE_E2E_STREAMTAPE=1 \
PLAYWRIGHT_BASE_URL=https://staging.example.com \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
npx playwright test streamtape-upload.acceptance
```

Requires a **staging** deployment (own Supabase project) with real Streamtape,
Gemini and relay configuration, `STREAMTAPE_ADULT_CONTENT_ALLOWED=true`, and an
active admin account. The spec refuses to run against the production hostname.
It uploads one synthetic video, asserts the relay transfer, Gemini
`source: "ai"`, conversion, publish, the saved record, the public Streamtape
iframe + frame load, and sitemap eligibility; screenshots, video and trace are
attached to the report. It never deletes or edits existing videos — the created
slug and provider id are printed so the operator decides whether to keep or remove them.

## Manual click-by-click checklist

See `GO_LIVE_CHECKLIST.md` §D (D1–D12).
