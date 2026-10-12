# Live UFOLOAD integration tests

These tests talk to the **real** UFOLOAD API with a real key. They are excluded
from `npm run test` (see `vitest.config.ts`) and are skipped unless you opt in.

```bash
LIVE_UFOLOAD=1 UFOLOAD_API_KEY=ufo_... npm run test:live
```

| Variable | Purpose |
| --- | --- |
| `LIVE_UFOLOAD=1` | Required. Without it every test is skipped. |
| `UFOLOAD_API_KEY` | Required. Server-only key from the UFOLOAD dashboard → Developers. |
| `LIVE_UFOLOAD_FILE` | Optional. Absolute path to a **small** real video. Enables the full direct-upload test (chunked PUT → complete → wait for `ready`). |
| `LIVE_UFOLOAD_IMPORT_URL` | Optional. A public direct video URL. Enables the URL-import test. |
| `LIVE_UFOLOAD_KEEP=1` | Optional. Keep the files the tests create (default: delete them again). |
| `LIVE_UFOLOAD_APPROVED=1` | Optional. Waives the assertion that the approval gate is closed. Only set this when UFOLOAD has approved the account **and** `UFOLOAD_ADULT_CONTENT_APPROVED=true` is in the environment you are testing. |

What the tests do:

1. **Read check** — `GET /api/v1/files?limit=1`; proves the key, the base URL and
   the account work.
2. **Fail-closed check** — with the approval flag off, an upload session must be
   refused with an actionable message.
3. **Direct upload** (only with `LIVE_UFOLOAD_FILE`) — asks for a grant, PUTs the
   file in the documented chunk size, completes the upload, waits for the file to
   reach `ready`, and deletes the file afterwards.
4. **URL import** (only with `LIVE_UFOLOAD_IMPORT_URL`) — starts an import, waits
   for the task to finish and the created file to reach `ready`, cancels the task
   and deletes the file.
5. **Unauthenticated probe** — confirms a bad key is reported as a configuration
   error naming `UFOLOAD_API_KEY`.

Notes:

- The key is never printed; error messages are redacted.
- The upload spends account quota while it runs. A 50 MB–200 MB file is enough to
  prove chunking (raise it deliberately if you want to test resume).
- Nothing here proves the *admin UI* end-to-end. For that, follow the manual
  smoke test in `GO_LIVE_CHECKLIST.md` (D1–D9) with a real account.
