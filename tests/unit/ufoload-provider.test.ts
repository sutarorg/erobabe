import { describe, it, expect, vi } from "vitest";
import { UfoloadProvider } from "@/lib/video/provider";
import {
  UFOLOAD_API_BASE,
  UFOLOAD_PUBLIC_API_BASE,
  assertUploadNodeUrl,
  isUfoloadEmbedUrl,
  isUfoloadPublicId,
  parseFile,
  parseImport,
  parseUfoloadEmbedUrl,
  parseUploadGrant,
  ufoloadEmbedUrl,
} from "@/lib/video/ufoload";
import { ProviderApiError, VideoProviderConfigError } from "@/lib/video/errors";
import { UFOLOAD_MAX_CHUNK_BYTES } from "@/lib/video/limits";
import { PAPI_EXAMPLE, TEST_API_KEY, createFakeUfoload } from "./helpers/fake-ufoload";

/**
 * Contract tests for the UFOLOAD client.
 *
 * They run against `helpers/fake-ufoload.ts`, a mock written from UFOLOAD's
 * OpenAPI document. They prove the client follows the documented contract
 * (auth, request shapes, response handling, error mapping); they do NOT prove
 * a real upload, encode or playback works — see the live smoke test in
 * DEPLOYMENT.md.
 */

const ENV = { UFOLOAD_API_KEY: TEST_API_KEY, UFOLOAD_ADULT_CONTENT_APPROVED: "true" };

function makeProvider(overrides: Record<string, string | undefined> = {}, ufo = createFakeUfoload(), extra: Record<string, unknown> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const provider = new UfoloadProvider({
    env: { ...ENV, ...overrides },
    fetchImpl: ufo.fetch,
    sleep,
    random: () => 0,
    ...extra,
  });
  return { provider, ufo, sleep };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderApiError);
    return error as ProviderApiError;
  }
  throw new Error("expected the call to fail");
}

describe("UFOLOAD authentication", () => {
  it("sends the API key only as a Bearer header — never in a URL or a body", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "clip.mp4", size: 1000, mimeType: "video/mp4" });
    await provider.getDirectUploadState(grant.uploadId);
    await provider.completeDirectUpload(grant.uploadId, { size: 1000 });
    await provider.startImport({ url: "https://cdn.example.com/a.mp4" });
    await provider.listImports();
    const fileId = [...ufo.files.keys()][0];
    await provider.getFile(fileId);

    expect(ufo.calls.length).toBeGreaterThanOrEqual(6);
    for (const call of ufo.calls) {
      expect(call.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(call.url).not.toContain(TEST_API_KEY);
      expect(call.url).not.toMatch(/[?&]key=/);
      expect(JSON.stringify(call.body ?? "")).not.toContain(TEST_API_KEY);
      expect(call.host).toBe("ufoload.com");
    }
  });

  it("calls the documented REST v1 endpoints with the documented methods", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "clip.mp4", size: 1000 });
    await provider.getDirectUploadState(grant.uploadId);
    await provider.completeDirectUpload(grant.uploadId, { size: 1000 });
    const task = await provider.startImport({ url: "https://cdn.example.com/a.mp4" });
    await provider.listImports();
    await provider.cancelImport(task.id);
    const second = await provider.createDirectUpload({ filename: "b.mp4", size: 10 });
    await provider.cancelDirectUpload(second.uploadId);

    const summary = ufo.calls.map((call) => `${call.method} ${call.path}`);
    expect(summary).toEqual([
      "POST /api/v1/files/uploads",
      `GET /api/v1/files/uploads/${grant.uploadId}`,
      `POST /api/v1/files/uploads/${grant.uploadId}/complete`,
      "POST /api/v1/files/import",
      "GET /api/v1/files/import",
      `DELETE /api/v1/files/import/${task.id}`,
      "POST /api/v1/files/uploads",
      `DELETE /api/v1/files/uploads/${second.uploadId}`,
    ]);
    expect(ufo.calls[0].url.startsWith(UFOLOAD_API_BASE)).toBe(true);
  });
});

describe("direct upload initialisation", () => {
  it("sends filename, exact size and mime type, and returns the grant UFOLOAD issued", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload({ chunkSize: 4 * 1024 * 1024, maxBytes: 5_000_000_000 }));
    const grant = await provider.createDirectUpload({ filename: "My Clip.mp4", size: 123456789, mimeType: "video/mp4" });

    expect(ufo.calls[0].body).toEqual({ filename: "My Clip.mp4", size: 123456789, mime_type: "video/mp4" });
    expect(grant).toEqual({
      uploadId: expect.stringMatching(/^upl_/),
      url: `https://upload.ufoload.com/07/_node/v1/ingest/${grant.uploadId}`,
      authorization: `UfoGrant grant_${grant.uploadId}`,
      chunkSize: 4 * 1024 * 1024,
      maxBytes: 5_000_000_000,
      expiresAt: expect.any(String),
    });
  });

  it("returns the node URL exactly as UFOLOAD sent it — it is never rebuilt", async () => {
    const odd = "https://upload.ufoload.com/42/_node/v1/ingest/upl_custom";
    const { provider } = makeProvider({}, createFakeUfoload({ nodeUrl: () => odd }));
    expect((await provider.createDirectUpload({ filename: "a.mp4", size: 5 })).url).toBe(odd);
  });

  it("derives the Authorization value from `grant` when the ready-made one is missing", () => {
    const grant = parseUploadGrant({
      upload_id: "u1",
      url: "https://upload.ufoload.com/01/_node/v1/ingest/u1",
      grant: "abc.def",
      chunk_size: 1024,
      max_bytes: 4096,
      expires_at: "2026-10-12T12:00:00Z",
    });
    expect(grant.authorization).toBe("UfoGrant abc.def");
  });

  it("never lets chunk_size exceed UFOLOAD's 256 MiB node limit", () => {
    const grant = parseUploadGrant({
      upload_id: "u1",
      url: "https://upload.ufoload.com/01/_node/v1/ingest/u1",
      authorization: "UfoGrant x",
      chunk_size: 2 * UFOLOAD_MAX_CHUNK_BYTES,
      max_bytes: 10 * UFOLOAD_MAX_CHUNK_BYTES,
    });
    expect(grant.chunkSize).toBe(UFOLOAD_MAX_CHUNK_BYTES);
  });

  it.each([
    ["missing upload_id", { url: "https://upload.ufoload.com/1/x", authorization: "UfoGrant x", chunk_size: 1, max_bytes: 1 }],
    ["missing url", { upload_id: "u", authorization: "UfoGrant x", chunk_size: 1, max_bytes: 1 }],
    ["missing grant", { upload_id: "u", url: "https://upload.ufoload.com/1/x", chunk_size: 1, max_bytes: 1 }],
    ["missing chunk_size", { upload_id: "u", url: "https://upload.ufoload.com/1/x", authorization: "UfoGrant x", max_bytes: 1 }],
    ["missing max_bytes", { upload_id: "u", url: "https://upload.ufoload.com/1/x", authorization: "UfoGrant x", chunk_size: 1 }],
    ["a header-injecting grant", { upload_id: "u", url: "https://upload.ufoload.com/1/x", authorization: "UfoGrant x\r\nX-Evil: 1", chunk_size: 1, max_bytes: 1 }],
  ])("rejects a grant with %s instead of guessing", (_label, body) => {
    expect(() => parseUploadGrant(body)).toThrow(ProviderApiError);
  });

  it("refuses node URLs the browser could not safely send a grant to", () => {
    expect(() => assertUploadNodeUrl("http://upload.ufoload.com/1/_node/v1/ingest/u")).toThrow(/not https/);
    expect(() => assertUploadNodeUrl("https://user:pass@upload.ufoload.com/1/x")).toThrow(/credentials/);
    expect(() => assertUploadNodeUrl("https://127.0.0.1/_node/v1/ingest/u")).toThrow(/public host/);
    expect(() => assertUploadNodeUrl("https://localhost/_node/v1/ingest/u")).toThrow(/public host/);
    expect(() => assertUploadNodeUrl("not a url")).toThrow(/valid URL/);
    expect(assertUploadNodeUrl("https://upload.ufoload.com/07/_node/v1/ingest/u")).toBe("https://upload.ufoload.com/07/_node/v1/ingest/u");
  });

  it("cancels the session and fails when UFOLOAD's byte ceiling is below the file size", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload({ maxBytes: 1_000_000_000 }));
    // The fake would refuse this at init; force the odd case where it grants a smaller ceiling.
    ufo.respondOnce(
      (call) => call.method === "POST" && call.path === "/api/v1/files/uploads",
      {
        status: 201,
        json: {
          upload_id: "upl_small",
          url: "https://upload.ufoload.com/07/_node/v1/ingest/upl_small",
          authorization: "UfoGrant g",
          chunk_size: 1024,
          max_bytes: 500,
          expires_at: "2026-10-12T12:00:00Z",
        },
      }
    );
    ufo.uploads.set("upl_small", { id: "upl_small", filename: "a.mp4", size: 1000, state: "pending" });

    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 1000 }));
    expect(error.status).toBe(413);
    expect(error.code).toBe("payload_too_large");
    expect(ufo.calls.some((call) => call.method === "DELETE" && call.path.endsWith("/upl_small"))).toBe(true);
  });

  it("validates its own input before calling UFOLOAD", async () => {
    const { provider, ufo } = makeProvider();
    await expect(provider.createDirectUpload({ filename: "", size: 10 })).rejects.toThrow(/file name/);
    await expect(provider.createDirectUpload({ filename: "a.mp4", size: 0 })).rejects.toThrow(/size/);
    await expect(provider.createDirectUpload({ filename: "a.mp4", size: 1.5 })).rejects.toThrow(/size/);
    expect(ufo.calls).toHaveLength(0);
  });
});

describe("direct upload state and completion", () => {
  it("reports the session state and the file id once completed", async () => {
    const { provider } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 10 });
    expect(await provider.getDirectUploadState(grant.uploadId)).toEqual({ state: "pending", fileId: null });

    const { file } = await provider.completeDirectUpload(grant.uploadId, { size: 10 });
    expect(await provider.getDirectUploadState(grant.uploadId)).toEqual({ state: "completed", fileId: file.id });
  });

  it("completes through the authenticated endpoint and returns UFOLOAD's own file id", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 77 });
    const result = await provider.completeDirectUpload(grant.uploadId, { size: 77 });

    expect(ufo.calls.at(-1)).toMatchObject({ method: "POST", path: `/api/v1/files/uploads/${grant.uploadId}/complete`, body: { size: 77 } });
    expect(result.file.id).toMatch(/^01J9ZQ8W5N3X7K2M4P/);
    expect(result.file.state).toBe("processing");
    expect(result.file.status).toBe("queued");
    expect(result.duplicate).toBe(false);
  });

  it("surfaces the duplicate flag UFOLOAD sets for content it already hosts", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 10 });
    ufo.respondOnce((call) => call.path.endsWith("/complete"), {
      status: 200,
      json: { file: { id: "01EXISTINGFILE0000000000AA", name: "a.mp4", status: "ready", progress: 100 }, duplicate: true },
    });
    const result = await provider.completeDirectUpload(grant.uploadId, { size: 10 });
    expect(result.duplicate).toBe(true);
    expect(result.file.state).toBe("ready");
  });

  it("treats 409 upload_busy as retryable and any other 409 as final", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 10 });

    ufo.failNext("POST /complete", ufo.error(409, "upload_busy", "still finishing"));
    const busy = await failureOf(provider.completeDirectUpload(grant.uploadId));
    expect(busy).toMatchObject({ status: 409, code: "upload_busy", retryable: true });

    ufo.failNext("POST /complete", ufo.error(409, "quota_exceeded", "no space"));
    const quota = await failureOf(provider.completeDirectUpload(grant.uploadId));
    expect(quota).toMatchObject({ status: 409, code: "conflict", retryable: false });
    expect(quota.message).toMatch(/storage|closed/i);
  });

  it("cancels a session, and reports 409 when UFOLOAD is already finishing it", async () => {
    const { provider } = makeProvider();
    const open = await provider.createDirectUpload({ filename: "a.mp4", size: 10 });
    await expect(provider.cancelDirectUpload(open.uploadId)).resolves.toBeUndefined();

    const finished = await provider.createDirectUpload({ filename: "b.mp4", size: 10 });
    await provider.completeDirectUpload(finished.uploadId);
    const error = await failureOf(provider.cancelDirectUpload(finished.uploadId));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/can no longer be cancelled/);
  });
});

describe("file status", () => {
  it("normalises UFOLOAD file statuses — only an explicit `ready` is ready", () => {
    const base = { id: "01FILE" };
    expect(parseFile({ ...base, status: "uploading" }).state).toBe("processing");
    expect(parseFile({ ...base, status: "queued" }).state).toBe("processing");
    expect(parseFile({ ...base, status: "processing", progress: 42 })).toMatchObject({ state: "processing", progress: 42 });
    expect(parseFile({ ...base, status: "ready", progress: 80 })).toMatchObject({ state: "ready", progress: 100 });
    expect(parseFile({ ...base, status: "failed", error: "unsupported codec" })).toMatchObject({ state: "failed", error: "unsupported codec" });
    // Unknown / missing statuses must never be mistaken for ready.
    expect(parseFile({ ...base, status: "transcoding-v2" }).state).toBe("processing");
    expect(parseFile({ ...base }).state).toBe("processing");
    expect(parseFile({ ...base, status: "READY" }).state).toBe("processing");
  });

  it("maps duration, size and quality fields and clamps progress", () => {
    const file = parseFile({ id: "01F", status: "processing", progress: 250, duration_ms: 61500, width: 1920, height: 1080, max_quality: 1080, size: "2048" });
    expect(file).toMatchObject({ progress: 100, durationMs: 61500, width: 1920, height: 1080, maxQuality: 1080, size: 2048 });
    expect(parseFile({ id: "01F", status: "processing", progress: -5 }).progress).toBe(0);
  });

  it("rejects a file object with no id", () => {
    expect(() => parseFile({ status: "ready" })).toThrow(ProviderApiError);
    expect(() => parseFile(null)).toThrow(ProviderApiError);
  });

  it("never exposes signed links or posters, which expire", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0001", status: "ready", progress: 100 });
    const file = await provider.getFile("01FILEFILEFILEFILEFILE0001");
    const serialised = JSON.stringify(file);
    expect(serialised).not.toContain("sig=");
    expect(serialised).not.toContain("master.m3u8");
    expect(serialised).not.toContain("poster");
    expect(Object.keys(file)).not.toContain("links");
  });

  it("returns 404 as an actionable not-found error", async () => {
    const { provider } = makeProvider();
    const error = await failureOf(provider.getFile("01NOSUCHFILE"));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
    expect(error.message).toMatch(/deleted|moderation/i);
  });
});

describe("stable embed URL", () => {
  it("accepts only the documented https://ufoload.com/e/{11-char id} shape", () => {
    expect(ufoloadEmbedUrl("gi4o0tlro01")).toBe("https://ufoload.com/e/gi4o0tlro01");
    expect(parseUfoloadEmbedUrl("https://ufoload.com/e/gi4o0tlro01")).toBe("gi4o0tlro01");
    expect(isUfoloadPublicId("gi4o0tlro01")).toBe(true);

    for (const bad of [
      "http://ufoload.com/e/gi4o0tlro01",
      "https://evil.example/e/gi4o0tlro01",
      "https://ufoload.com.evil.example/e/gi4o0tlro01",
      "https://ufoload.com/e/short",
      "https://ufoload.com/e/gi4o0tlro01/extra",
      "https://ufoload.com/e/gi4o0tlro01?autoplay=1",
      "https://ufoload.com/dl/gi4o0tlro01",
      "https://user@ufoload.com/e/gi4o0tlro01",
      "https://ufoload.com/e/01J9ZQ8W5N3X7K2M4P6R8T0V2Y", // a 26-char ULID is not a public id
    ]) {
      expect(isUfoloadEmbedUrl(bad), bad).toBe(false);
    }
    expect(() => ufoloadEmbedUrl("01J9ZQ8W5N3X7K2M4P6R8T0V2Y")).toThrow();
  });

  it("uses a public id carried by the REST file object", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0002", status: "ready", progress: 100, public_id: "abcDEF12345" });
    const file = await provider.getFile("01FILEFILEFILEFILEFILE0002");
    expect(file.publicId).toBe("abcDEF12345");
    expect(await provider.resolveEmbedUrl(file)).toBe("https://ufoload.com/e/abcDEF12345");
    // Nothing else had to be asked.
    expect(ufo.calls.some((call) => call.host === "api.ufoload.com")).toBe(false);
  });

  it("falls back to papi file/info (documented to accept the ULID) when REST carries no public id", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0003", status: "ready", progress: 100, papiFilecode: PAPI_EXAMPLE.filecode });
    const file = await provider.getFile("01FILEFILEFILEFILEFILE0003");
    expect(file.publicId).toBeNull();

    expect(await provider.resolveEmbedUrl(file)).toBe(PAPI_EXAMPLE.protected_embed);
    const papi = ufo.calls.find((call) => call.host === "api.ufoload.com");
    expect(papi?.url.startsWith(`${UFOLOAD_PUBLIC_API_BASE}/file/info?file_code=01FILEFILEFILEFILEFILE0003`)).toBe(true);
    expect(papi?.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it("rebuilds the URL from the validated filecode when protected_embed disagrees with it", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0004", status: "ready", progress: 100 });
    ufo.respondOnce((call) => call.host === "api.ufoload.com", {
      status: 200,
      json: { msg: "OK", status: 200, result: [{ filecode: "gi4o0tlro01", protected_embed: "https://evil.example/e/gi4o0tlro01" }] },
    });
    const file = await provider.getFile("01FILEFILEFILEFILEFILE0004");
    expect(await provider.resolveEmbedUrl(file)).toBe("https://ufoload.com/e/gi4o0tlro01");
  });

  it("returns null — never a guess — when UFOLOAD gives no usable identifier", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0005", status: "ready", progress: 100 });
    const file = await provider.getFile("01FILEFILEFILEFILEFILE0005");

    for (const result of [[], [{ filecode: "tooShort" }], [{ filecode: "01J9ZQ8W5N3X7K2M4P6R8T0V2Y" }], [{}]]) {
      ufo.respondOnce((call) => call.host === "api.ufoload.com", { status: 200, json: { msg: "OK", status: 200, result } });
      expect(await provider.resolveEmbedUrl(file)).toBeNull();
    }
  });

  it("never turns the file's own ULID into an embed URL", async () => {
    const { provider, ufo } = makeProvider();
    const ulid = "01FILEFILEFILEFILEFILE0006";
    ufo.addFile({ id: ulid, status: "ready", progress: 100 });
    const file = await provider.getFile(ulid);
    ufo.respondOnce((call) => call.host === "api.ufoload.com", { status: 200, json: { msg: "OK", status: 200, result: [] } });
    const embed = await provider.resolveEmbedUrl(file);
    expect(embed === null || !embed.includes(ulid)).toBe(true);
  });
});

describe("URL import", () => {
  it("starts an import and returns the TASK id, which is not a file id", async () => {
    const { provider, ufo } = makeProvider();
    const task = await provider.startImport({ url: "https://cdn.example.com/video.mp4" });
    expect(ufo.calls[0]).toMatchObject({ method: "POST", path: "/api/v1/files/import", body: { url: "https://cdn.example.com/video.mp4" } });
    expect(task.id).toMatch(/^imp_/);
    expect(task).toMatchObject({ state: "queued", fileId: null, progress: 0 });
  });

  it("finds a task in the import list by its actual id — not by name, URL or position", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addImport({ id: "imp_A", url: "https://cdn.example.com/same.mp4", name: "same.mp4", status: "running", progress: 10 });
    ufo.addImport({ id: "imp_B", url: "https://cdn.example.com/same.mp4", name: "same.mp4", status: "done", progress: 100, file_id: "01FILEB" });
    ufo.addImport({ id: "imp_C", url: "https://cdn.example.com/other.mp4", name: "other.mp4", status: "failed", error: "404 from origin" });

    expect(await provider.findImport("imp_B")).toMatchObject({ id: "imp_B", state: "done", fileId: "01FILEB" });
    expect(await provider.findImport("imp_A")).toMatchObject({ id: "imp_A", state: "running", progress: 10, fileId: null });
    expect(await provider.findImport("imp_C")).toMatchObject({ state: "failed", error: "404 from origin" });
    expect(await provider.findImport("imp_missing")).toBeNull();
  });

  it("normalises import statuses and never treats an unknown one as done", () => {
    for (const status of ["queued", "running", "done", "failed", "cancelled"] as const) {
      expect(parseImport({ id: "i", status }).state).toBe(status);
    }
    expect(parseImport({ id: "i", status: "paused-by-ufo" }).state).toBe("running");
    expect(parseImport({ id: "i", status: "done", file_id: "01F" })).toMatchObject({ fileId: "01F", progress: 100 });
    expect(() => parseImport({ status: "queued" })).toThrow(ProviderApiError);
  });

  it("skips a malformed list entry instead of hiding the others", async () => {
    const { provider, ufo } = makeProvider();
    ufo.respondOnce((call) => call.path === "/api/v1/files/import" && call.method === "GET", {
      status: 200,
      json: { items: [{ nope: true }, { id: "imp_ok", status: "queued", progress: 0 }] },
    });
    expect((await provider.listImports()).map((task) => task.id)).toEqual(["imp_ok"]);
  });

  it("reports the 10-active-imports limit (409) as retryable with a wait", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload({ maxActiveImports: 2 }));
    await provider.startImport({ url: "https://cdn.example.com/1.mp4" });
    await provider.startImport({ url: "https://cdn.example.com/2.mp4" });
    const error = await failureOf(provider.startImport({ url: "https://cdn.example.com/3.mp4" }));
    expect(error).toMatchObject({ status: 409, code: "too_many_imports", retryable: true });
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.message).toMatch(/maximum of 10 active URL imports/);
    // A write is not auto-retried: exactly one POST per attempt.
    expect(ufo.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/files/import")).toHaveLength(3);
  });

  it("explains a rejected link (400)", async () => {
    const { provider, ufo } = makeProvider();
    ufo.failNext("POST /files/import", ufo.error(400, "invalid_url", "address is in a private range"));
    const error = await failureOf(provider.startImport({ url: "https://cdn.example.com/x.mp4" }));
    expect(error).toMatchObject({ status: 400, code: "bad_request", retryable: false });
    expect(error.message).toMatch(/direct, public http\(s\) link/);
  });
});

describe("error mapping", () => {
  const cases: Array<[string, number, string | null, string, string, boolean]> = [
    // label, status, provider code, expected code, message fragment, retryable
    ["401 bad key", 401, "unauthorized", "unauthorized", "UFOLOAD_API_KEY", false],
    ["402 negative balance", 402, null, "payment_required", "balance is negative", false],
    ["404 unknown folder", 404, "not_found", "not_found", "destination folder", false],
    ["409 not enough storage", 409, "quota_exceeded", "conflict", "storage", false],
    ["413 file too large", 413, "too_large", "payload_too_large", "too large", false],
    ["429 concurrent upload limit", 429, "rate_limited", "rate_limited", "concurrent-upload limit", true],
    ["503 direct upload unavailable", 503, "direct_upload_unavailable", "direct_upload_unavailable", "direct upload is temporarily unavailable", true],
    ["500 upstream trouble", 500, null, "upstream_error", "having trouble", true],
  ];

  it.each(cases)("maps %s on initialisation to an actionable error", async (_label, status, code, expectedCode, fragment, retryable) => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload(), { maxRetries: 0 });
    ufo.failNext("POST /files/uploads", code ? ufo.error(status, code, "details from ufoload", { "Retry-After": "7" }) : { status, json: {} });

    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 10 }));
    expect(error.status).toBe(status);
    expect(error.code).toBe(expectedCode);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(fragment);
    expect(error.message).not.toContain(TEST_API_KEY);
  });

  it("503 direct_upload_unavailable never offers to route the file through the server", async () => {
    const { provider, ufo } = makeProvider();
    ufo.failNext("POST /files/uploads", ufo.error(503, "direct_upload_unavailable", "no node"));
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 10 }));
    expect(error.message).toMatch(/does not fall back to sending the file through its own servers/);
    // Exactly one init attempt: a failed init is not silently re-sent through some other path.
    expect(ufo.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(ufo.calls.every((call) => call.path !== "/api/v1/files")).toBe(true);
  });

  it("a plain 503 without the direct_upload_unavailable code is an ordinary upstream failure", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload(), { maxRetries: 0 });
    ufo.failNext("POST /files/uploads", { status: 503, json: {} });
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 10 }));
    expect(error.code).toBe("upstream_error");
  });

  it("honours Retry-After on a rate-limited read and retries it with backoff", async () => {
    const { provider, ufo, sleep } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0007", status: "processing", progress: 10 });
    ufo.respondOnce((call) => call.method === "GET" && call.path.startsWith("/api/v1/files/01"), ufo.error(429, "rate_limited", "slow down", { "Retry-After": "2" }), 2);

    const file = await provider.getFile("01FILEFILEFILEFILEFILE0007");
    expect(file.progress).toBe(10);
    expect(ufo.calls.filter((call) => call.method === "GET")).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(2000); // Retry-After, no jitter (random() = 0)
  });

  it("gives up after the configured retries and reports the rate limit", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload(), { maxRetries: 1 });
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0008", status: "processing" });
    ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), ufo.error(429, "rate_limited", "slow down", { "Retry-After": "1" }), 5);
    const error = await failureOf(provider.getFile("01FILEFILEFILEFILEFILE0008"));
    expect(error).toMatchObject({ status: 429, code: "rate_limited", retryable: true, retryAfterSeconds: 1 });
    expect(ufo.calls).toHaveLength(2);
  });

  it("caps how long a Retry-After may stall a request", async () => {
    const { provider, ufo, sleep } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0009", status: "processing" });
    ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), ufo.error(429, "rate_limited", "x", { "Retry-After": "3000" }));
    await provider.getFile("01FILEFILEFILEFILEFILE0009");
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(5000);
  });

  it("retries idempotent reads on 5xx but never repeats a write", async () => {
    const { provider, ufo } = makeProvider();
    ufo.addFile({ id: "01FILEFILEFILEFILEFILE0010", status: "ready", progress: 100 });
    ufo.respondOnce((call) => call.method === "GET" && call.path.endsWith("0010"), { status: 502, json: {} }, 1);
    expect((await provider.getFile("01FILEFILEFILEFILEFILE0010")).state).toBe("ready");

    ufo.respondOnce((call) => call.method === "POST" && call.path === "/api/v1/files/uploads", { status: 502, json: {} }, 3);
    await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(ufo.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("reports invalid JSON on a success status", async () => {
    const { provider, ufo } = makeProvider();
    ufo.respondOnce(() => true, { status: 200, text: "<html>maintenance</html>" });
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(error).toMatchObject({ code: "invalid_response", retryable: false });
    expect(error.message).toMatch(/not valid JSON/);
    expect(error.message).not.toContain("maintenance");
  });

  it("reports an empty success body where fields are required", async () => {
    const { provider, ufo } = makeProvider();
    ufo.respondOnce(() => true, { status: 201, text: "" });
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(error.code).toBe("invalid_response");
  });

  it("times out a call that never answers", async () => {
    const { provider, ufo } = makeProvider({}, createFakeUfoload(), { timeoutMs: 30, maxRetries: 0 });
    ufo.respondOnce(() => true, { status: 200, hang: true });
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(error).toMatchObject({ code: "timeout", status: 0, retryable: true });
    expect(error.message).toMatch(/did not answer/);
  });

  it("reports an unreachable UFOLOAD as a retryable network error without leaking details", async () => {
    const provider = new UfoloadProvider({
      env: ENV,
      fetchImpl: (async () => {
        throw new TypeError(`getaddrinfo ENOTFOUND ufoload.com (Authorization: Bearer ${TEST_API_KEY})`);
      }) as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 0,
    });
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(error).toMatchObject({ code: "network", status: 0, retryable: true });
    expect(error.message).not.toContain(TEST_API_KEY);
    expect(error.message).not.toContain("ENOTFOUND");
  });
});

describe("no key leakage", () => {
  it("redacts the key from provider-supplied error text", async () => {
    const { provider, ufo } = makeProvider();
    ufo.failNext(
      "POST /files/uploads",
      ufo.error(400, "bad", `your key ${TEST_API_KEY} and ufo_anotherSecretToken12345 are wrong`)
    );
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    for (const text of [error.message, JSON.stringify({ ...error, message: error.message }), String(error)]) {
      expect(text).not.toContain(TEST_API_KEY);
      expect(text).not.toContain("anotherSecretToken");
    }
    expect(error.message).toContain("[redacted]");
  });

  it("redacts a key that does not look like `ufo_…` too (the exact configured value is always removed)", async () => {
    const odd = "ZZ-custom-key-value-0123456789";
    const ufo = createFakeUfoload();
    const provider = new UfoloadProvider({
      env: { UFOLOAD_API_KEY: odd, UFOLOAD_ADULT_CONTENT_APPROVED: "true" },
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers as HeadersInit);
        headers.set("authorization", `Bearer ${TEST_API_KEY}`); // let the mock accept the call, then make it fail
        return ufo.fetch(input, { ...init, headers });
      }) as typeof fetch,
      sleep: async () => {},
    });
    ufo.failNext("POST /files/uploads", ufo.error(400, "bad", `the key ${odd} is not valid`));
    const error = await failureOf(provider.createDirectUpload({ filename: "a.mp4", size: 5 }));
    expect(error.message).not.toContain(odd);
    expect(error.message).toContain("[redacted]");
  });

  it("does not put the key on the grant, the file or the import results", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 5 });
    const { file } = await provider.completeDirectUpload(grant.uploadId);
    const task = await provider.startImport({ url: "https://cdn.example.com/a.mp4" });
    for (const value of [grant, file, task, await provider.getFile(file.id), await provider.listImports()]) {
      expect(JSON.stringify(value)).not.toContain(TEST_API_KEY);
    }
    expect(ufo.calls.length).toBeGreaterThan(3);
  });
});

describe("configuration gates (fail closed)", () => {
  it("is disabled — and makes no request — without the adult-content approval flag", async () => {
    const { provider, ufo } = makeProvider({ UFOLOAD_ADULT_CONTENT_APPROVED: undefined });
    expect(provider.isEnabled()).toBe(false);
    const error = await provider.createDirectUpload({ filename: "a.mp4", size: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(VideoProviderConfigError);
    expect(error.code).toBe("adult_content_not_approved");
    expect(error.details).toMatch(/written/i);
    expect(ufo.calls).toHaveLength(0);
  });

  it("is disabled without an API key", async () => {
    const { provider, ufo } = makeProvider({ UFOLOAD_API_KEY: undefined });
    expect(provider.isEnabled()).toBe(false);
    const error = await provider.startImport({ url: "https://cdn.example.com/a.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(VideoProviderConfigError);
    expect(error.code).toBe("api_key_missing");
    expect(ufo.calls).toHaveLength(0);
  });

  it("lists every problem when both are missing", () => {
    const { provider } = makeProvider({ UFOLOAD_API_KEY: "", UFOLOAD_ADULT_CONTENT_APPROVED: "false" });
    const readiness = provider.readiness();
    expect(readiness.enabled).toBe(false);
    expect(readiness.problems.map((problem) => problem.code)).toEqual(["adult_content_not_approved", "api_key_missing"]);
    expect(() => provider.assertEnabled()).toThrow(VideoProviderConfigError);
  });

  it.each(["TRUE", "True", "1", "yes", " true", "false", ""])("treats UFOLOAD_ADULT_CONTENT_APPROVED=%j as NOT approved", (value) => {
    const { provider } = makeProvider({ UFOLOAD_ADULT_CONTENT_APPROVED: value });
    expect(provider.isEnabled()).toBe(false);
  });

  it("is enabled only with a key and the exact flag value `true`", () => {
    const { provider } = makeProvider();
    expect(provider.isEnabled()).toBe(true);
    expect(provider.readiness()).toEqual({ enabled: true, problems: [] });
  });

  it("rejects a key with embedded whitespace instead of sending a broken header", () => {
    const { provider } = makeProvider({ UFOLOAD_API_KEY: "ufo_abc def" });
    expect(provider.isEnabled()).toBe(false);
    expect(provider.readiness().problems.map((problem) => problem.code)).toContain("api_key_malformed");
  });

  it("trims a pasted key rather than rejecting a trailing newline", async () => {
    const { provider, ufo } = makeProvider({ UFOLOAD_API_KEY: `  ${TEST_API_KEY}\n` });
    expect(provider.isEnabled()).toBe(true);
    await provider.listImports();
    expect(ufo.calls[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it("lets cleanup calls through when only the approval flag is missing", async () => {
    const { provider, ufo } = makeProvider();
    const grant = await provider.createDirectUpload({ filename: "a.mp4", size: 5 });
    const { provider: withdrawn } = makeProvider({ UFOLOAD_ADULT_CONTENT_APPROVED: "false" }, ufo);
    await expect(withdrawn.cancelDirectUpload(grant.uploadId)).resolves.toBeUndefined();
  });
});
