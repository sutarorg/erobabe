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

## Streamtape playback — `streamtape-playback.live.test.ts`

Checks what instant start on the watch page depends on, which the unit suite
can only simulate: how long Streamtape really makes a new media link wait, that
one link serves the iOS probe, the first frames and a seek (so one handshake per
file is enough), and that later requests reuse it at once. Outbound HTTPS to
`api.streamtape.com` and the Streamtape/tapecontent media hosts is required.

```bash
STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… STREAMTAPE_PLAYBACK_FILE_ID=… npm run test:live
```

`STREAMTAPE_PLAYBACK_FILE_ID` is the id in any of your videos' Streamtape links —
the part after `/e/` or `/v/`. Strictly read-only. The media link itself is a
credential and is never printed; the log shows only timings and the media host:

```text
[live-playback] new link after <ms> ms (media host <host>)   ← the wait the prepare request hides
[live-playback] the same file again after <ms> ms           ← must be ~0: no second ticket
[live-playback] first frames: first byte after <ms> ms, …   ← start-up time once the link is ready
[live-playback] seek to 50%: first byte after <ms> ms       ← seek time with the same link
```

The ticket and the media requests both come from the machine running the test,
just as they both come from the server in production. Timings depend on where
it runs; run it in the same region as the deployment for numbers close to what
visitors get.
