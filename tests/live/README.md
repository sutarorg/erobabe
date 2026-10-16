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

- The model defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`; override it with
  `OPENROUTER_MODEL`. Reasoning is disabled for speed. The free route is subject
  to OpenRouter's rate limits and availability.
- Keys issued by OpenRouter start with `sk-or-`. Create one at openrouter.ai/keys.
- Never paste real production keys into an issue, a commit, or a bug report.

## Bunny Stream

No live Bunny test has run in this checkout. Follow DEPLOYMENT.md section D with
authorized staging credentials, a live Supabase project and browser network access.
Verify genuine TUS upload, thumbnail storage, status 4, atomic publication, resume,
cancellation, duplicate prevention and desktop/mobile playback. Mocked tests and
browser protocol fixtures are not provider integration evidence.
