import { describe, it, expect } from "vitest";
import {
  UFOLOAD_MAX_CHUNK_BYTES,
  UfoloadError,
  assertUfoloadIdentifier,
  describeUfoloadError,
  extractUfoloadError,
  isUfoloadIdentifier,
  mapUfoloadStatus,
  parseAcceptedOffset,
  parseFileEnvelope,
  parseFileList,
  parseFileWithLinks,
  parseImportEnvelope,
  parseImportList,
  parseImportTask,
  parseUploadGrant,
  parseUploadState,
  pickPublicIdentifier,
  planNextChunk,
  reconcileResumeOffset,
  redactSecret,
  uploadPercent,
  ufoloadEmbedUrl,
  ufoloadPlayerIdentifier,
  ufoloadWatchUrl,
} from "@/lib/video/ufoload-protocol";

/**
 * Contract tests for the UFOLOAD protocol layer.
 *
 * Every fixture below mirrors a field the provider's own documentation /
 * OpenAPI description defines; none of them are invented. The parsers are the
 * only place that touches raw provider JSON, so these tests are what keep a
 * malformed or changed response from silently corrupting a video row.
 */

/** `POST /api/v1/files/uploads` — 201, from the documented example. */
function grantFixture(overrides: Record<string, unknown> = {}) {
  return {
    upload_id: "upl_01HZX8J9K2N7T4Q1",
    url: "https://upload.ufoload.com/17/_node/v1/ingest/upl_01HZX8J9K2N7T4Q1",
    grant: "5f2c1e...",
    authorization: "UfoGrant 5f2c1e...",
    chunk_size: 8388608,
    max_bytes: 2147483648,
    expires_at: "2026-10-12T14:00:00Z",
    ...overrides,
  };
}

/** A `File` object as described by the OpenAPI `File` schema. */
function fileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE",
    name: "my trip.mp4",
    size: 84829193,
    mime_type: "video/mp4",
    status: "processing",
    visibility: "public",
    progress: 40,
    duration_ms: 512000,
    width: 1920,
    height: 1080,
    max_quality: 720,
    views: 0,
    error: null,
    poster: "https://ufoload.com/i/pp/abc.jpg",
    folder_id: null,
    created_at: "2026-10-12T12:00:00Z",
    updated_at: "2026-10-12T12:04:00Z",
    renditions: [],
    tracks: [],
    ...overrides,
  };
}

describe("upload grant parsing", () => {
  it("reads every field the browser needs for the chunked transfer", () => {
    const grant = parseUploadGrant(grantFixture());

    expect(grant.uploadId).toBe("upl_01HZX8J9K2N7T4Q1");
    // The node address is taken verbatim; it is never constructed by the app.
    expect(grant.url).toBe("https://upload.ufoload.com/17/_node/v1/ingest/upl_01HZX8J9K2N7T4Q1");
    expect(grant.authorization).toBe("UfoGrant 5f2c1e...");
    expect(grant.chunkSize).toBe(8388608);
    expect(grant.maxBytes).toBe(2147483648);
    expect(grant.expiresAt).toBe("2026-10-12T14:00:00.000Z");
  });

  it("caps the advertised chunk size at the documented 256 MiB ceiling", () => {
    const grant = parseUploadGrant(grantFixture({ chunk_size: 1024 * 1024 * 1024 }));
    expect(grant.chunkSize).toBe(UFOLOAD_MAX_CHUNK_BYTES);
  });

  it("fails instead of inventing a missing URL, grant or chunk size", () => {
    expect(() => parseUploadGrant(grantFixture({ url: undefined }))).toThrow(/upload node URL/i);
    expect(() => parseUploadGrant(grantFixture({ authorization: undefined }))).toThrow(/grant/i);
    expect(() => parseUploadGrant(grantFixture({ upload_id: undefined }))).toThrow(/upload id/i);
    expect(() => parseUploadGrant(grantFixture({ chunk_size: 0 }))).toThrow(/chunk size/i);
  });

  it("rejects a non-HTTPS node URL", () => {
    expect(() => parseUploadGrant(grantFixture({ url: "http://upload.ufoload.com/1/_node" }))).toThrow(/HTTPS/i);
  });

  it("reads the documented direct-upload states and refuses unknown ones", () => {
    expect(parseUploadState({ state: "pending" }).state).toBe("pending");
    expect(parseUploadState({ state: "completed", file_id: "01ABC" }).fileId).toBe("01ABC");
    expect(() => parseUploadState({ state: "mystery" })).toThrow(/unknown upload state/i);
  });
});

describe("file parsing", () => {
  it("maps a documented File object onto the app's shape", () => {
    const file = parseFileEnvelope({ file: fileFixture(), duplicate: false });

    expect(file.id).toBe("01J6FSPD0S1N7M4HP2Y7Z1B5GE");
    expect(file.status).toBe("processing");
    expect(file.progress).toBe(40);
    // duration_ms is converted once, here, so every caller sees seconds.
    expect(file.durationSeconds).toBe(512);
    expect(file.posterUrl).toBe("https://ufoload.com/i/pp/abc.jpg");
    expect(file.duplicate).toBe(false);
  });

  it("flags a deduplicated upload", () => {
    expect(parseFileEnvelope({ file: fileFixture({ status: "ready" }), duplicate: true }).duplicate).toBe(true);
  });

  it("surfaces the provider's failure reason", () => {
    const file = parseFileEnvelope({ file: fileFixture({ status: "failed", error: "unsupported codec" }) });
    expect(file.status).toBe("failed");
    expect(file.error).toBe("unsupported codec");
    expect(mapUfoloadStatus(file.status)).toBe("failed");
  });

  it("refuses a file without an id or with an unknown status", () => {
    expect(() => parseFileEnvelope({ file: { status: "ready" } })).toThrow(/without an id/i);
    expect(() => parseFileEnvelope({ file: fileFixture({ status: "transcoding" }) })).toThrow(/unknown file status/i);
  });

  it("keeps the short public id only when the provider actually sent one", () => {
    expect(pickPublicIdentifier({ public_id: "aBcD1234xyz" })).toBe("aBcD1234xyz");
    expect(pickPublicIdentifier({ id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE" })).toBeNull();
    expect(pickPublicIdentifier({ public_id: ".." })).toBeNull();
    expect(pickPublicIdentifier(null)).toBeNull();
  });

  it("reads the signed links but never treats them as permanent addresses", () => {
    const { file, links } = parseFileWithLinks({
      file: fileFixture({ status: "ready" }),
      links: {
        playback: "https://cdn.ufoload.com/hls/x/master.m3u8?sig=abc",
        poster: "https://cdn.ufoload.com/i/x.jpg",
        expires_at: "2026-10-12T18:00:00Z",
      },
    });
    expect(file.status).toBe("ready");
    expect(links.expiresAt).toBe("2026-10-12T18:00:00.000Z");
    expect(links.playback).toContain("sig=");
  });

  it("ignores unusable entries in a list instead of failing the whole read", () => {
    const files = parseFileList({ items: [fileFixture(), { nope: true }, fileFixture({ id: "01SECOND" })], total: 3 });
    expect(files.map((file) => file.id)).toEqual(["01J6FSPD0S1N7M4HP2Y7Z1B5GE", "01SECOND"]);
  });
});

describe("import task parsing", () => {
  /** `Import` schema: status is queued | running | done | failed | cancelled. */
  const task = {
    id: "imp_01HZX9",
    url: "https://example.com/video.mp4",
    name: "video.mp4",
    status: "running",
    progress: 35,
    created_at: "2026-10-12T12:00:00Z",
  };

  it("keeps the task id separate from the file id", () => {
    const running = parseImportEnvelope({ import: task });
    expect(running.id).toBe("imp_01HZX9");
    expect(running.fileId).toBeNull();

    const done = parseImportTask({ ...task, status: "done", file_id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE" });
    expect(done.status).toBe("done");
    expect(done.fileId).toBe("01J6FSPD0S1N7M4HP2Y7Z1B5GE");
    expect(done.id).toBe("imp_01HZX9");
  });

  it("reads a failed task's reason", () => {
    const failed = parseImportTask({ ...task, status: "failed", error: "source returned 404" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("source returned 404");
  });

  it("rejects tasks with an unknown status and lists tolerate bad rows", () => {
    expect(() => parseImportTask({ ...task, status: "downloading" })).toThrow(/unknown import status/i);
    expect(parseImportList({ items: [task, { id: "x", status: "nope" }] })).toHaveLength(1);
  });
});

describe("provider errors are actionable", () => {
  const cases: Array<[number, unknown, RegExp]> = [
    [401, { error: { code: "unauthorized" } }, /UFOLOAD_API_KEY/],
    [402, { error: { code: "balance_negative" } }, /balance/i],
    [404, { error: { code: "not_found" } }, /could not find/i],
    [409, { error: { code: "quota_exceeded" } }, /quota/i],
    [413, { error: { code: "too_large" } }, /larger than the UFOLOAD plan/i],
    [429, { error: { code: "rate_limited" } }, /rate-limited/i],
    [500, { error: { code: "oops", message: "upstream exploded" } }, /upstream exploded/],
  ];

  it.each(cases)("explains a %i response", (status, payload, pattern) => {
    const error = describeUfoloadError(status as number, payload);
    expect(error).toBeInstanceOf(UfoloadError);
    expect(error.message).toMatch(pattern as RegExp);
    expect(error.status).toBe(status);
  });

  it("names the documented direct-upload fallback for 503 direct_upload_unavailable", () => {
    const error = describeUfoloadError(503, { error: { code: "direct_upload_unavailable" } });
    expect(error.code).toBe("direct_upload_unavailable");
    expect(error.message).toMatch(/server upload fallback|retry when direct upload is back/i);
  });

  it("explains the concurrent-import limit", () => {
    const error = describeUfoloadError(429, { error: { code: "too_many_active" } });
    expect(error.message).toMatch(/maximum number of active imports/i);
  });

  it("tells the caller to retry while an upload is still finalizing", () => {
    expect(describeUfoloadError(409, { error: { code: "upload_busy" } }).message).toMatch(/retrying in a moment/i);
  });

  it("reads the provider's error envelope", () => {
    expect(
      extractUfoloadError({
        error: { code: "name_taken", message: "Имя занято", details: { reason: "name_taken" } },
      })
    ).toEqual({ code: "name_taken", message: "Имя занято", reason: "name_taken" });
  });

  it("never lets a secret appear in a message", () => {
    const key = "ufo_livesecretkey123456";
    expect(redactSecret(`Bearer ${key} failed`, key)).toBe("Bearer [redacted] failed");
    expect(redactSecret(`token=${key}`)).toContain("[redacted]");
  });
});

describe("stable player addresses", () => {
  it("uses the documented embed and watch paths", () => {
    expect(ufoloadEmbedUrl("aBcD1234xyz")).toBe("https://ufoload.com/e/aBcD1234xyz");
    expect(ufoloadWatchUrl("aBcD1234xyz")).toBe("https://ufoload.com/v/aBcD1234xyz");
  });

  it("prefers the public id and falls back to the ULID", () => {
    expect(ufoloadPlayerIdentifier({ id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE", publicId: "aBcD1234xyz" })).toBe("aBcD1234xyz");
    expect(ufoloadPlayerIdentifier({ id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE", publicId: null })).toBe("01J6FSPD0S1N7M4HP2Y7Z1B5GE");
  });

  it("refuses to build an address from a missing or malformed identifier", () => {
    expect(() => ufoloadEmbedUrl("")).toThrow(/malformed/i);
    expect(() => ufoloadEmbedUrl("../../etc/passwd")).toThrow(/malformed/i);
    expect(() => assertUfoloadIdentifier(null)).toThrow(/malformed/i);
    expect(isUfoloadIdentifier("short")).toBe(false);
    expect(isUfoloadIdentifier("01J6FSPD0S1N7M4HP2Y7Z1B5GE")).toBe(true);
  });
});

describe("chunk planning", () => {
  it("walks a file in exact, non-overlapping offsets", () => {
    const size = 20 * 1024 * 1024;
    const chunkSize = 8 * 1024 * 1024;
    const offsets: Array<{ offset: number; length: number }> = [];
    let offset = 0;
    for (;;) {
      const plan = planNextChunk({ size, offset, chunkSize });
      if (plan.done) break;
      offsets.push({ offset: plan.offset, length: plan.length });
      offset = plan.offset + plan.length;
    }

    expect(offsets).toEqual([
      { offset: 0, length: 8 * 1024 * 1024 },
      { offset: 8 * 1024 * 1024, length: 8 * 1024 * 1024 },
      { offset: 16 * 1024 * 1024, length: 4 * 1024 * 1024 },
    ]);
    // Nothing is skipped and nothing is duplicated.
    expect(offsets.reduce((total, chunk) => total + chunk.length, 0)).toBe(size);
  });

  it("never exceeds the provider's chunk size, the 256 MiB ceiling, or max_bytes", () => {
    expect(planNextChunk({ size: 100, offset: 0, chunkSize: 10 }).length).toBe(10);
    expect(planNextChunk({ size: 10 * 1024 * 1024 * 1024, offset: 0, chunkSize: 10 * 1024 * 1024 * 1024 }).length).toBe(
      UFOLOAD_MAX_CHUNK_BYTES
    );
    expect(planNextChunk({ size: 1000, offset: 0, chunkSize: 100, maxBytes: 250 }).length).toBe(100);
    expect(planNextChunk({ size: 1000, offset: 200, chunkSize: 100, maxBytes: 250 }).length).toBe(50);
  });

  it("reports completion instead of a zero-length chunk", () => {
    expect(planNextChunk({ size: 10, offset: 10, chunkSize: 4 })).toEqual({ offset: 10, length: 0, done: true });
    expect(planNextChunk({ size: 10, offset: 40, chunkSize: 4 }).done).toBe(true);
  });

  it("falls back to the documented ceiling when no usable chunk size is advertised", () => {
    // A missing/zero chunk_size means "no preference" — the remaining bytes are
    // still bounded by the documented 256 MiB chunk ceiling.
    expect(planNextChunk({ size: 10, offset: 0, chunkSize: 0 }).length).toBe(10);
    expect(planNextChunk({ size: 10, offset: 0, chunkSize: Number.NaN }).length).toBe(10);
    expect(() => planNextChunk({ size: -1, offset: 0, chunkSize: 4 })).toThrow(/unknown file size/i);
    expect(() => planNextChunk({ size: 10, offset: -2, chunkSize: 4 })).toThrow(/negative offset/i);
  });
});

describe("progress and resume arithmetic", () => {
  it("never reports 100% before every byte was accepted", () => {
    expect(uploadPercent(0, 1000)).toBe(0);
    expect(uploadPercent(999, 1000)).toBe(99);
    expect(uploadPercent(1000, 1000)).toBe(100);
    expect(uploadPercent(2000, 1000)).toBe(100);
  });

  it("resumes from the offset the provider accepted, not from what we hoped", () => {
    // A chunk that was only partially received must be re-sent from its start.
    expect(reconcileResumeOffset({ accepted: 8 * 1024 * 1024, sent: 16 * 1024 * 1024, total: 100 })).toBe(Math.min(8 * 1024 * 1024, 100));
    expect(reconcileResumeOffset({ accepted: 50, sent: 40, total: 100 })).toBe(50);
    // No provider answer: fall back to what the network was told.
    expect(reconcileResumeOffset({ accepted: null, sent: 40, total: 100 })).toBe(40);
    // Never beyond the file.
    expect(reconcileResumeOffset({ accepted: 500, sent: 0, total: 100 })).toBe(100);
    expect(reconcileResumeOffset({ accepted: -5, sent: -5, total: 100 })).toBe(0);
  });

  it("reads the node's accepted offset", () => {
    expect(parseAcceptedOffset({ offset: 4096 })).toBe(4096);
    expect(parseAcceptedOffset({ offset: "512" })).toBe(512);
    expect(parseAcceptedOffset({})).toBeNull();
    expect(parseAcceptedOffset({ offset: -1 })).toBeNull();
  });
});
