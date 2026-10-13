# Live tests

These tests talk to real external services with real credentials. They are
**never** part of `npm test` (`vitest.config.ts` excludes `tests/live/**`); run
them deliberately with the dedicated config:

```bash
npm run test:live
```

The config is `vitest.live.config.ts` (`environment: node`, no parallel files,
long timeouts).

## Gemini — `gemini.live.test.ts`

Proves a real API key works end-to-end, which the mocked unit suite cannot.
Outbound HTTPS to `generativelanguage.googleapis.com` / `aiplatform.googleapis.com`
is required (CI sandboxes usually block it).

```bash
GEMINI_API_KEY=AQ.… npm run test:live
```

It asserts 1) the key probes successfully and reports which endpoint answered
(`gemini` or `vertex`), 2) a real title/description/tags suggestion comes back,
and 3) a bogus key is rejected with an actionable message that contains no key
material.

The same check is available to admins at runtime: **Admin → System Health →
“Test Gemini”** (`POST /api/admin/gemini/health`).

## Notes

- Keys issued by Google AI Studio now start with `AQ.` (authorization keys).
  The client sends the key to the Gemini API first and retries once against
  Vertex AI express mode if that endpoint rejects the credential as
  "not an API key"; set `GEMINI_API_BACKEND=vertex` to skip the first attempt.
- Never paste real production keys into an issue, a commit, or a bug report.
