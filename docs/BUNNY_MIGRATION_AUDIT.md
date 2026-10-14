# Pre-implementation audit and file checklist

Baseline: main commit 9aa06f8, inspected on the session branch without switching branches. Checked-in code is authoritative.

- README, DEPLOYMENT, GO_LIVE_CHECKLIST, .env.example: replace gated provider instructions; preserve payment/auth/hosting instructions.
- Upload page: retain layout/batch/local selection; replace PUT with scoped resumable TUS, processing polling, recovery and required retryable thumbnail.
- Provider routes/utilities: delete retired session/confirmation and validation modules; introduce Bunny server-only API, signature, schemas and recovery routes. Never retry non-idempotent create on uncertain outcomes.
- storage-token/storage: keep thumbnail-only signed upload; verify stored thumbnail before publication.
- localVideoThumbnail/frame-thumbnail/thumbnail-quality: reuse actual-frame quality scoring; sample throughout local clip, select best, output 1280×720 with restrained grade/sharpen. Keep existing remote/manual thumbnail tool, not an upload fallback.
- playback/VideoPlayer/watch page: strict Bunny embed built from stored library/GUID; poster before user interaction, loading and retry; preserve layout/SEO/related content and historical direct-media playback.
- VideoManager/admin API: preserve metadata, category, manual thumbnail, carousel and delete tools; label re-upload-required records; delete is catalog-only.
- system-health: server-side read-only Stream API probe, no secret output.
- migrations 00–11: immutable; add 12, archive retired hosted records without removing metadata, remove obsolete completion RPC, restrict legacy session writes; Bunny service-only sessions and locked transactional completion.
- Tests: remove old provider tests; replace with provider/signature/auth/validation/recovery, SQL atomicity and real browser thumbnail/TUS tests; retain unrelated tests.
- Remove obsolete provider-specific reports and rewrite current implementation reports. Audit all runtime provider references and publishing functions.

Findings: old integration is configuration-gated and not a proven live upload; thumbnails currently return the first non-black frame at native aspect ratio and are optional; old completion RPC publishes immediately after administrator authorization. New completion must additionally require a verified thumbnail and actual Finished status. No media transfer or credentials are available in this checkout. Historical external-hosted records must be unpublished/re-upload-required, not represented as migrated.
