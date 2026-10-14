> **Historical research, rechecked 2026-10-14.** The official confirmation schema remains incomplete. A fail-closed implementation now exists; claims below about code being unchanged refer to the original research revision. See [DEPLOYMENT.md](../DEPLOYMENT.md#d-filekosh-device-uploads).

# Filekosh API research — integration blocked on incomplete contract

**Researched:** 2026-10-14 (UTC)
**Official reference found:** https://filekosh.com/docs
**Official specification:** https://filekosh.com/api/v1/openapi.json (`openapi: 3.0.3`, API version `1.0.0`)
**Decision:** Do not implement or enable hosted uploads yet. The API exists, but its published specification does not define the required upload-confirmation request. No authenticated request, video upload, or player acceptance test has succeeded in this investigation. This is not a completed migration.

## 1. Method and source register

Research used browser-enabled web search and page retrieval before any implementation. All returned chunks of the OpenAPI document were read. Public documentation was inspected without logging in, creating an account, uploading media, or probing private dashboard endpoints. Search results are discovery aids, not a provider contract.

| Official source | Observed result on the research date | What it establishes |
| --- | --- | --- |
| https://filekosh.com/ | Public homepage retrieved | Advertises uploads, anonymous viewing, third-party iframe embedding, and unlimited storage. Shows `<iframe src="https://filekosh.com/embed/your-video" allowfullscreen></iframe>`. This is an example, not an ID-to-URL contract. |
| https://filekosh.com/faq | Public FAQ retrieved | Advertises videos, images, archives, documents; says there are no file-size/storage limits and large files stream directly to storage. Does not specify API transport limits, codecs, containers, or upload headers. |
| https://filekosh.com/dashboard/upload | Redirected to https://filekosh.com/login | Dashboard requires a login. Its private implementation was not inspected or treated as a public API. |
| https://filekosh.com/support | Public support page retrieved | Lists support@filekosh.com and https://t.me/filekoshadmin; channel https://t.me/filekosh. No support message was sent. |
| https://filekosh.com/terms | Public terms retrieved; page says “Last updated: August 2026” | Requires rights to uploaded/shared content; prohibits illegal, harmful, deceptive, privacy/IP-infringing material, malware and earnings manipulation. Does not explicitly address lawful adult videos or approve Erobabe's use. |
| https://filekosh.com/docs | Scalar API-reference shell retrieved | Links its API client to `https://filekosh.com/api/v1/openapi.json`. Establishes the provenance of the specification, not just a guessed API path. |
| https://filekosh.com/api/v1/openapi.json | Public JSON retrieved in two chunks | Official programmatic API, authentication, base URL, create/PUT/confirm flow and operations below. Several contracts are incomplete. |
| https://filekosh.com/dashboard/api | Redirected to login | Cannot inspect account-specific quick-start instructions or key controls without authorized access. Key creation location is documented by the OpenAPI description. |
| https://filekosh.com/api-docs | Page displays 404 | Documentation-discovery check only; not an upload endpoint. |
| https://filekosh.com/how-it-works | Returned Cloudflare 522 page | Unavailable during research; no conclusions drawn from its missing content. |

Searches included `Filekosh official API documentation video upload authentication`, `"filekosh" API upload documentation SDK OpenAPI`, `site:filekosh.com API developer authentication upload`, `"filekosh" github upload API`, `"filekosh.com" "API"`, `"Filekosh" developer documentation SDK changelog`, `"Filekosh" adult content terms`, `"filekosh.com" "videos/confirm"`, and `"FileKosh API"`. Results were empty or unrelated; no relevant SDK, GitHub implementation, quick-start, changelog, or additional confirmation example was identified. In particular, examples for FileMoon, Files.com, or other providers are **not** evidence for Filekosh. Absence from these searches does not prove that no additional documentation exists.

## 2. Confirmed API facts

All API details in this section come from the [official OpenAPI specification](https://filekosh.com/api/v1/openapi.json). They describe published documentation, not successful live observations.

### Authentication and access

- API base: `https://filekosh.com/api/v1`.
- Global security scheme: HTTP bearer, named `ApiKey`, with `bearerFormat: fk_live_...`.
- Description instructs: `Authorization: Bearer fk_live_...`; create a key in **Dashboard → API**.
- API description states **approximately 120 requests/minute per key**. It does not define burst accounting, response headers, `Retry-After`, error schemas, or backoff rules.
- Scopes, key expiration, account approval requirements, sandbox accounts and key rotation/revocation procedures are not documented in this specification.
- Never send the bearer key to a browser, iframe, storage host, log, audit record, or `NEXT_PUBLIC_*` environment variable.

### Local-file upload

The documented sequence is:

1. `POST https://filekosh.com/api/v1/videos`.
2. **PUT bytes** to the returned `uploadUrl`.
3. `POST https://filekosh.com/api/v1/videos/confirm`.

Creation has an `application/json` request body:

| Field | Schema | Required? |
| --- | --- | --- |
| `title` | string | Yes |
| `originalName` | string | Yes |
| `mimeType` | string | Yes |
| `sizeBytes` | integer | Yes |
| `durationSeconds` | integer | No |
| `platform` | `APP` or `WEB` | No; no default specified for this operation |

The `201` response is described only as **`id, slug, uploadUrl`**. There is no response content schema, required-field list, example, URL expiration, signed-header list or storage-host allowlist. A flat JSON object cannot be assumed solely from that description.

The complete published confirmation entry is:

```json
"/videos/confirm": {
  "post": {
    "summary": "Confirm uploaded file(s) → READY",
    "responses": {
      "200": { "description": "results" }
    }
  }
}
```

**Blocking omission:** no `requestBody`, parameters, response content schema, or example identifies how to confirm a particular uploaded file. Do not assume `{id}`, `{ids}`, an array, storage keys, ETags, or an empty body. The `{ ids: [] }` description on **batch-delete** does not establish the confirmation payload.

PUT is documented as bytes to a presigned URL, not multipart form-data. Browser CORS, required `Content-Type`/checksum headers, acceptable PUT success codes, maximum object size, multipart/resumable support, URL renewal, and partial-upload cleanup remain unspecified. “Unlimited” marketing is not a technical guarantee for a single presigned PUT.

### Retrieval, identity and playback

`GET https://filekosh.com/api/v1/videos/{id}` has a JSON **object** schema with these properties:

- `id`, `slug`, `title`, `status`, `mimeType`, `url`: strings.
- `platform`: `APP` or `WEB`.
- `sizeBytes`, `durationSeconds`: integers.
- `embedUrl`: nullable string, described as **“Iframe embed URL (WEB videos only).”**
- `variants`: array of objects with `id`, `label`, `lang` strings.
- `stats`: object containing integer `views`, `validViews`, `downloads`, `likes`, `dislikes`, `comments`, and string `earningsUsd`.
- `createdAt`: date-time string.

The schema has **no required properties** and `status` has **no enum**. Reject incomplete responses before storing IDs or publishing; do not make all properties mandatory merely because they are listed. Confirmation's summary names `READY`, but pending/failure/deletion states and what readiness guarantees about transcoding are not specified.

The API description says video `{id}` paths accept either the internal ID or share-link slug (after `/w/` or `/f/`). This does not mean an arbitrary internal ID can be substituted into `/embed/`. Prefer a validated returned `embedUrl`, with `platform: WEB` on creation. The permanence/expiry of returned player URLs still needs confirmation. The `url` field is **not documented as a direct media URL**; it must not be used as native-video media by assumption.

The [homepage](https://filekosh.com/) explicitly advertises embedding on websites, blogs and forums. That confirms general embedding support, not compatible sandbox permissions, approved Erobabe content, a stable URL formula, or successful playback in this application.

### Other documented operations

Paths below are relative to the API base and inherit bearer authentication. An operation's existence does not mean its full request/response contract is specified.

| Method/path | Documented input | Documented response / limitation |
| --- | --- | --- |
| `GET /account` | None specified | 200 “OK”; no schema. |
| `GET /videos` | Query: `limit` integer (default 25, max 100), `cursor`, `platform` (`APP`/`WEB`), `status`, `q` | 200 “List + nextCursor”; envelope unspecified. |
| `PATCH /videos/{id}` | JSON with optional `title`, `platform` | 200 “Video”; no response content schema on this operation. |
| `DELETE /videos/{id}` | Path ID | 200 “deleted”; no schema, repeat-delete semantics, or in-flight cancellation guarantees. |
| `POST /videos/batch` | No body schema | 201 “videos[]”; incomplete. |
| `PATCH /videos/batch` | No body schema | 200 “results”; incomplete. |
| `POST /videos/batch-delete` | Summary says `Body: { ids: [] }` | 200 “deleted count”; no content schema. |
| `POST /videos/import` | JSON `items` array required; each item requires string `url`, with optional `title`, `platform`, `mimeType`, `durationSeconds` | 202 “{ jobId }”; described as asynchronous. Supported source URLs, fetch authentication, job states and failure results unspecified. |
| `GET /imports/{id}` | Path ID | 200 “job”; no schema. Its parameter description incorrectly/ambiguously describes a *video* slug/internal ID, whereas import returns `jobId`. Ask provider which identifier to use. |
| `POST /videos/convert` | JSON `link` required (Filekosh `/w/`, `/f/` or bare slug); optional `platform` default `WEB` | 201 “{ slug, platform, shareUrl }”; clones a Filekosh link. Not a documented Streamtape migration mechanism. |
| `POST /videos/{id}/publish-web` / `publish-app` | Path ID | 201 web/app copy; schema unspecified. |
| `GET /videos/{id}/variants` | Path ID | 200 described as `{ variants: [{ id, label, lang }] }`. |
| `POST /videos/{id}/variants/presign` | JSON optional `mimeType` (default `video/mp4`) | 201 described as `{ uploadUrl, storageKey }`; then PUT bytes. Not the main-video confirmation contract. |
| `POST /videos/{id}/variants` | JSON `storageKey`, `label`, `lang`, all required | 201 described as `{ variant: { id, label, lang } }`. |
| `DELETE /videos/{id}/variants/{variantId}` | Path identifiers | 200 “deleted”; no schema. |

No processing webhook contract, signature verification instructions, progress endpoint, status enum, dedicated cancel operation, resumable protocol, idempotency key, retry policy, timeout, exact size limit, or supported video codec/container matrix was found. Do not substitute Erobabe's old 2 GB transit constant or Streamtape's limits.

## 3. Content-policy gate

The [terms](https://filekosh.com/terms) require rights and prohibit illegal and other unacceptable content, but do **not explicitly permit Erobabe's intended lawful adult-content hosting, commercial distribution, API use and embedding**. Lack of an explicit prohibition is not approval. The owner needs written provider confirmation covering the account, intended content and use, plus any age/consent, territorial, moderation, retention and embed restrictions. Preserve Erobabe's existing rights/moderation/publication checks regardless of provider approval.

## 4. Engineering decisions — proposals, not provider facts or shipped features

1. Prefer browser `File`/`Blob` PUT to a short-lived, server-authorized URL **only after** Filekosh confirms browser support, CORS, hosts, headers, limits and expiry. Keep API bearer authentication exclusively on the server. A scoped upload URL is temporary upload authorization, not a public playback URL; return it only to the initiating active administrator, never persist it in public video fields or logs.
2. Report actual XHR byte progress separately from provider readiness. A 100% PUT is not a published video. No timer-generated processing percentages. Do not infer cross-origin player success from an iframe `load` event.
3. Do not buffer video bodies in Next.js (`arrayBuffer`, `formData`, base64). If browser PUT is unsupported, choose a streaming-capable upload worker only after measuring host body-size, execution, egress and cancellation limits. No relay or storage vendor is assumed yet.
4. Keep provider creation/confirmation/status separate from current URL and generic-embed publishing. Use active-admin authentication, server-owned jobs, atomic claims/idempotency, category/metadata helpers, existing thumbnail storage, safe errors and audit events. Existing helper lookups alone do not provide concurrency protection (see audit).
5. Store verified `id` as `provider_file_id`, verified `slug` as `provider_public_id`, and validated returned `embedUrl` as `embed_url`; leave `playable_url` null unless stable direct-media support is officially documented. These are proposed mappings. Do not invent a provider upload-session ID when the API only returns a video ID.
6. Allow only the exact HTTPS `https://filekosh.com` origin for provider embeds, with no userinfo, unexpected port, private token/query data or unverified path. Test the actual player before choosing any sandbox changes. Keep Streamtape ticket/media/thumbnail paths intact for legacy records; do not route new Filekosh uploads through their fallback.
7. Add the next forward-only migration only alongside the gated implementation; at the audited revision the next number is `00000000000011`. Preserve every historical provider value/row. Do not change global defaults to an unusable provider or relabel existing videos.
8. Retry safe reads with bounded, jittered backoff subject to provider guidance. Never automatically repeat an ambiguous create, confirm or delete operation until idempotency/reconciliation semantics are known.

## 5. Exactly what must be obtained

Send the following to **support@filekosh.com** or the support handle linked from https://filekosh.com/support. This message is a draft; it has not been sent:

> We are integrating Erobabe's authenticated administrator uploads with your official v1 API at https://filekosh.com/api/v1, using WEB videos for third-party iframe playback. We found https://filekosh.com/docs and its OpenAPI specification. Please provide an authorized, versioned upload quick-start or corrected specification covering:
>
> 1. The exact POST /videos 201 JSON envelope and error examples, including id, slug, uploadUrl and any expiry/required upload headers.
> 2. The exact POST /videos/confirm request body/headers, single and multi-file examples, success/error responses, byte-integrity checks, repeated-confirm behavior and readiness guarantees. That operation currently has no requestBody in OpenAPI.
> 3. Supported browser PUT/CORS configuration, upload hostnames, signed headers, Content-Type/checksum requirements, URL lifetime/renewal, technical per-object limits and supported formats. Is multipart or resumable upload available for large videos?
> 4. All video and import status values, asynchronous processing/failure/deletion behavior, polling intervals or signed webhooks, and the GET /imports/{id} response and identifier semantics.
> 5. Rate-limit/error headers, timeouts, safe retry/idempotency rules, cancellation and partial-object/orphan cleanup behavior (including DELETE during transfer).
> 6. A real sanitized WEB video response and stable embed URL, URL expiry/retention rules, permitted iframe sandbox/permissions, domain restrictions, and mobile playback guidance. Is url a share link rather than media?
> 7. Written approval for our intended lawful, rights-cleared adult-content catalog, commercial API uploads and third-party embedding, including account-specific or regional restrictions.
> 8. How to provision a limited staging/test API key and any API-access approval needed. Please do not send production secrets in an issue or shared document.

The owner should provide the missing documentation/support response here (with secrets removed), and provision authorized staging credentials through private server configuration, **not chat**. Also supply a small rights-cleared test video, an active staging administrator/category, and a deployment environment with outbound access to Filekosh and its confirmed storage/player hosts.

This coding sandbox's outbound host allowlist does not include Filekosh or its storage hosts. Browser research retrieval is not an authenticated application-network test. Live validation needs an authorized environment with those hosts reachable in addition to the documentation and credentials.

## 6. Gate outcome and delivery scope

- **Confirmed:** Official programmatic API exists; bearer authentication, presigned PUT sequence, WEB embed property, approximate rate limit and operations above.
- **Unresolved/blocking:** Confirmation body and schemas; upload/browser transport details; processing/failure semantics; content permission; authorized live acceptance.
- **Delivered now:** Research, current-main source audit and baseline test results in [FILEKOSH_REPOSITORY_AUDIT.md](FILEKOSH_REPOSITORY_AUDIT.md), plus corrected README/deployment/environment guidance.
- **Intentionally not delivered:** Provider requests, credential variables consumed by runtime, upload UI/endpoints, database migration, default-provider change, or Filekosh playback claims. There is no simulated upload or guessed API implementation.
- **Completion requires:** Verified contract implementation, migration preservation tests, real active-admin device upload with measured progress, authenticated confirmation/readiness, verified stored identity/embed, desktop/mobile playback (including seeking, retry and deleted media), cancellation/retry/idempotency/security tests, and staging evidence. Passing existing mocked tests/build is not proof of Filekosh functionality.
