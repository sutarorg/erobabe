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

Proves a real OpenRouter key works end-to-end, which the mocked unit suite
cannot. Outbound HTTPS to `openrouter.ai` is required (CI sandboxes usually
block it).

```bash
NEXT_PUBLIC_OPENROUTER_API_KEY=sk-or-… npm run test:live
```

It asserts 1) a tiny probe succeeds against
`https://openrouter.ai/api/v1/chat/completions` with the exact model
`deepseek/deepseek-v3.2`, 2) a real title/description/tags suggestion comes
back, and 3) a bogus key is rejected with an actionable message that contains
no key material.

The same check is available to admins at runtime: **Admin → System Health →
“Test OpenRouter”** — it performs the identical probe directly from the
browser (no backend proxy).

## Notes

- `NEXT_PUBLIC_OPENROUTER_API_KEY` is a **public** client build variable: it
  is compiled into the browser bundle by design and does not protect anything.
  Visitors can extract it from the frontend and reuse it separately — rotating
  the key (and adding credit limits in the OpenRouter dashboard) is the
  mitigation.
- Never paste real production keys into an issue, a commit, a doc, or a bug
  report — live-test output must never contain them either.
