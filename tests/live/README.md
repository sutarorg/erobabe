# Live tests

These tests talk to real external services with real credentials. They are
**never** part of `npm test` (`vitest.config.ts` excludes `tests/live/**`); run
them deliberately with the dedicated config:

```bash
npm run test:live
```

The config is `vitest.live.config.ts` (`environment: node`, no parallel files,
long timeouts).

## OpenRouter — `openrouter.live.test.ts`

Proves a real API key works end-to-end, which the mocked unit suite cannot.
Outbound HTTPS to `openrouter.ai` is required (CI sandboxes usually block it).

```bash
OPENROUTER_API_KEY=sk-or-… npm run test:live
```

It asserts 1) the key probes successfully and reports the model that answered, 2) a real title/description/tags suggestion comes back,
and 3) a bogus key is rejected with an actionable message that contains no key
material.

The same check is available to admins at runtime: **Admin → System Health →
“Test OpenRouter”** (`POST /api/admin/metadata/health`).

## Notes

- The model defaults to `deepseek/deepseek-v3.2`; override it with
  `OPENROUTER_MODEL`. Reasoning is disabled for speed.
- Keys issued by OpenRouter start with `sk-or-`. Create one at openrouter.ai/keys.
- Never paste real production keys into an issue, a commit, or a bug report.

## Streamtape file manager — `streamtape-thumbnails.live.test.ts`

Proves the configured Streamtape credentials can read the thumbnails folder and
that the name matcher finds an image for a video of the same name. Outbound
HTTPS to `api.streamtape.com` is required (CI sandboxes usually block it).

```bash
STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… npm run test:live
```

Strictly read-only — nothing is uploaded, renamed, or deleted. It asserts 1) the
account answers, 2) the thumbnails folder is found and holds at least one image,
3) a video named after an image matches that image, and 4) the dry-run scan
completes without an error.

Useful environment variables: `STREAMTAPE_THUMBNAIL_FOLDER_ID` (skip the folder
search) and `STREAMTAPE_THUMBNAIL_FOLDER_NAME` (default `thumbnails`).

The same check is available to admins at runtime: **Admin → Videos → Streamtape
thumbnails → “Check folder”**.
