import { describe, it, expect } from "vitest";
import {
  StreamtapeError,
  assertAllowedUploadHost,
  assertEnvelopeOk,
  assertStreamtapeIdentifier,
  convertProgressPercent,
  describeStreamtapeError,
  fileIdFromWatchUrl,
  mapFileInfoReadiness,
  mapRemoteTaskState,
  parseEnvelope,
  parseFailedConverts,
  parseFileInfoResult,
  parseFolderListing,
  parseNodeUploadResponse,
  parseRemoteAddResult,
  parseRemoteStatusResult,
  parseRunningConverts,
  parseSplashUrl,
  parseUploadUrlResult,
  redactSecrets,
  retryAfterSeconds,
  selectUnclaimedFile,
  streamtapeEmbedUrl,
} from "@/lib/video/streamtape-protocol";

/**
 * Fixtures are copied from the official reference (https://streamtape.com/api,
 * fetched 2026-10-12). They prove the parsers match the *documented* shapes;
 * undocumented behaviour (upload-node body) is covered by the live suite.
 */

const ok = (result: unknown) => ({ status: 200, msg: "OK", result });
const ID = "wg8ad12d3QiJRXG";

describe("envelope", () => {
  it("parses the documented {status,msg,result} envelope", () => {
    expect(parseEnvelope(ok({ a: 1 }))).toEqual({ status: 200, msg: "OK", result: { a: 1 } });
  });

  it("rejects non-objects and envelopes without a numeric status as malformed", () => {
    for (const bad of [null, "x", [], {}, { status: "ok" }]) {
      expect(() => parseEnvelope(bad)).toThrow(StreamtapeError);
    }
    try {
      parseEnvelope("nope");
    } catch (error) {
      expect((error as StreamtapeError).status).toBe(502);
      expect((error as StreamtapeError).code).toBe("malformed_response");
    }
  });

  it("treats HTTP-200 bodies with a failing envelope status as errors", () => {
    expect(() => assertEnvelopeOk(parseEnvelope({ status: 403, msg: "denied", result: null }))).toThrow(/403/);
  });
});

describe("error mapping (documented status table)", () => {
  it.each([
    [400, /rejected the request/],
    [403, /STREAMTAPE_LOGIN/],
    [404, /could not find/],
    [451, /legal reasons/],
    [509, /bandwidth/i],
  ])("maps %i to an actionable message", (status, pattern) => {
    const error = describeStreamtapeError(status, "detail from provider");
    expect(error.status).toBe(status);
    expect(error.message).toMatch(pattern);
  });

  it("maps 50x to a retryable server error", () => {
    const error = describeStreamtapeError(503, "Too high server load");
    expect(error.message).toMatch(/server trouble \(503\)/);
    expect(error.code).toBe("http_503");
  });

  it("reads Retry-After in seconds and as a date", () => {
    expect(retryAfterSeconds(new Headers({ "retry-after": "30" }))).toBe(30);
    const future = new Date(Date.now() + 60_000).toUTCString();
    const seconds = retryAfterSeconds(new Headers({ "retry-after": future }));
    expect(seconds).toBeGreaterThan(50);
    expect(retryAfterSeconds(new Headers())).toBeNull();
  });
});

describe("redaction", () => {
  it("removes configured secrets and credential-looking query parameters", () => {
    const text = "GET https://api.streamtape.com/file/info?login=LOGINVALUE&key=KEYVALUE12 failed; ticket=abc123 Bearer abcdefghijklmnop";
    const output = redactSecrets(text, ["KEYVALUE12", "LOGINVALUE"]);
    expect(output).not.toContain("KEYVALUE12");
    expect(output).not.toContain("LOGINVALUE");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).toContain("[redacted]");
  });
});

describe("identifiers and embed URL", () => {
  it("builds https://streamtape.com/e/{id}", () => {
    expect(streamtapeEmbedUrl(ID)).toBe(`https://streamtape.com/e/${ID}`);
  });

  it.each(["", "a", "has space", "../etc", "x".repeat(80), "id/../../x"])("refuses to build an address from %j", (bad) => {
    expect(() => streamtapeEmbedUrl(bad)).toThrow(StreamtapeError);
    expect(() => assertStreamtapeIdentifier(bad)).toThrow(/malformed|missing/);
  });

  it("extracts the id from a documented watch URL only", () => {
    expect(fileIdFromWatchUrl(`https://streamtape.com/v/${ID}/clip.mp4`)).toBe(ID);
    expect(fileIdFromWatchUrl("https://streamtape.com/e/" + ID)).toBeNull();
    expect(fileIdFromWatchUrl(false)).toBeNull();
    expect(fileIdFromWatchUrl("not a url")).toBeNull();
    expect(fileIdFromWatchUrl("ftp://streamtape.com/v/" + ID)).toBeNull();
  });
});

describe("upload URL (GET /file/ul)", () => {
  it("parses the documented response", () => {
    const parsed = parseUploadUrlResult(ok({ url: "https://tapecontent.net/xfsupload/wg8ad12d3QiJRXG", valid_until: "2019-12-31 23:59:59" }));
    expect(parsed.url).toBe("https://tapecontent.net/xfsupload/wg8ad12d3QiJRXG");
    expect(parsed.validUntil).toBe("2019-12-31 23:59:59");
  });

  it("requires a url", () => {
    expect(() => parseUploadUrlResult(ok({}))).toThrow(/did not return an upload URL/);
  });

  it("surfaces envelope failures", () => {
    expect(() => parseUploadUrlResult({ status: 403, msg: "nope", result: null })).toThrow(/403/);
  });

  it.each([
    "http://tapecontent.net/x",
    "https://evil.example.com/x",
    "https://user:pw@tapecontent.net/x",
    "https://tapecontent.net.evil.com/x",
    "not a url",
  ])("rejects an unsafe upload host: %s", (url) => {
    expect(() => assertAllowedUploadHost(url)).toThrow(StreamtapeError);
  });

  it("accepts subdomains and operator-extended suffixes", () => {
    expect(assertAllowedUploadHost("https://up1.tapecontent.net/a")).toContain("up1.tapecontent.net");
    expect(assertAllowedUploadHost("https://nodes.newhost.test/a", ["newhost.test"])).toContain("newhost.test");
  });
});

describe("node upload response (tolerant, never trusted alone)", () => {
  it("extracts a candidate id from common JSON shapes", () => {
    expect(parseNodeUploadResponse(JSON.stringify({ status: 200, result: { id: ID } })).fileId).toBe(ID);
    expect(parseNodeUploadResponse(JSON.stringify({ file_id: ID })).fileId).toBe(ID);
    expect(parseNodeUploadResponse(JSON.stringify({ result: { file: { linkid: ID } } })).fileId).toBe(ID);
  });

  it("returns no id for HTML/plain/empty bodies and keeps a safe message", () => {
    expect(parseNodeUploadResponse("").fileId).toBeNull();
    const html = parseNodeUploadResponse("<html>Upload OK</html>");
    expect(html.fileId).toBeNull();
    expect(html.message).toContain("Upload OK");
  });

  it("ignores identifiers that are not plausible ids", () => {
    expect(parseNodeUploadResponse(JSON.stringify({ id: "x y" })).fileId).toBeNull();
  });
});

describe("file info (GET /file/info)", () => {
  const converted = ok({ [ID]: { id: ID, name: "a.mp4", size: 1234, type: "video/mp4", converted: true, status: 200 } });

  it("parses the id-keyed map", () => {
    expect(parseFileInfoResult(converted, ID)).toMatchObject({ id: ID, name: "a.mp4", sizeBytes: 1234, converted: true, entryStatus: 200 });
  });

  it("returns null when the map has no entry for the id", () => {
    expect(parseFileInfoResult(ok({}), ID)).toBeNull();
    expect(parseFileInfoResult(ok(null), ID)).toBeNull();
  });

  it("maps readiness: only converted+200 is ready", () => {
    const info = parseFileInfoResult(converted, ID)!;
    expect(mapFileInfoReadiness(info)).toBe("ready");
    expect(mapFileInfoReadiness({ ...info, converted: false })).toBe("processing");
    expect(mapFileInfoReadiness({ ...info, converted: false, entryStatus: 451 })).toBe("failed");
    expect(mapFileInfoReadiness({ ...info, converted: true, entryStatus: 404 })).toBe("failed");
    expect(mapFileInfoReadiness({ ...info, converted: true, entryStatus: 202 })).toBe("processing");
  });
});

describe("conversion queues", () => {
  it("parses running and failed converts", () => {
    const running = parseRunningConverts(
      ok([
        { name: "a.mp4", folderid: "0", status: "new", progress: 0, retries: 0, link: "x", linkid: "XklyYLYAZZZDZW" },
        { name: "b.mp4", folderid: "", status: "pending", progress: 0.75, retries: 0, link: "y", linkid: "B4GaCbJAAAyBxb" },
      ])
    );
    expect(running).toHaveLength(2);
    expect(running[1]).toMatchObject({ status: "pending", progress: 0.75, linkId: "B4GaCbJAAAyBxb" });
    const failed = parseFailedConverts(ok([{ name: "a.mp4", status: "error", progress: 0, retries: 2, linkid: "XklyYLYAZZZDZW" }]));
    expect(failed[0]).toMatchObject({ status: "error", retries: 2 });
    expect(parseRunningConverts(ok(null))).toEqual([]);
  });

  it("normalizes 0–1 progress to a capped percent", () => {
    expect(convertProgressPercent(0.75)).toBe(75);
    expect(convertProgressPercent(1)).toBe(99);
    expect(convertProgressPercent(42)).toBe(42);
    expect(convertProgressPercent(null)).toBeNull();
  });
});

describe("splash and folder listing", () => {
  it("parses a https splash and rejects anything else", () => {
    expect(parseSplashUrl(ok("https://thumb.tapecontent.net/thumb/x/thumb.jpg"))).toBe("https://thumb.tapecontent.net/thumb/x/thumb.jpg");
    expect(parseSplashUrl(ok("http://insecure/x.jpg"))).toBeNull();
    expect(parseSplashUrl(ok(null))).toBeNull();
  });

  const listing = ok({
    folders: [{ id: "B-qlJkdHFeo", name: "Sub" }],
    files: [{ name: "a.mp4", size: 100, link: "https://streamtape.com/v/rbAarvRPXdYbaxY/a.mp4", created_at: 1585532987430, downloads: 0, linkid: "rbAarvRPXdYbaxY", convert: "converted" }],
  });

  it("parses folders and files", () => {
    const parsed = parseFolderListing(listing);
    expect(parsed.folders).toEqual([{ id: "B-qlJkdHFeo", name: "Sub" }]);
    expect(parsed.files[0]).toMatchObject({ name: "a.mp4", sizeBytes: 100, linkId: "rbAarvRPXdYbaxY", convert: "converted" });
  });

  it("selects only a single, unclaimed, exact name+size match inside the window", () => {
    const now = 1585532987430 + 1000;
    const files = parseFolderListing(listing).files;
    const base = { name: "A.mp4", sizeBytes: 100, notClaimed: () => true, now };
    expect(selectUnclaimedFile(files, base)?.linkId).toBe("rbAarvRPXdYbaxY");
    expect(selectUnclaimedFile(files, { ...base, sizeBytes: 101 })).toBeNull();
    expect(selectUnclaimedFile(files, { ...base, notClaimed: () => false })).toBeNull();
    expect(selectUnclaimedFile(files, { ...base, now: now + 24 * 3600 * 1000 })).toBeNull();
    // Ambiguity → refuse to guess.
    const twin = { ...files[0], linkId: "zzzzzzzzzzzz" };
    expect(selectUnclaimedFile([files[0], twin], base)).toBeNull();
  });
});

describe("remote uploads", () => {
  it("parses add and the id-keyed status map", () => {
    expect(parseRemoteAddResult(ok({ id: "rbAarvRPXdYbaxY", folderid: "LnvnE51P5gc" }))).toEqual({ id: "rbAarvRPXdYbaxY", folderId: "LnvnE51P5gc" });
    expect(() => parseRemoteAddResult(ok({}))).toThrow(/task id/);

    const task = parseRemoteStatusResult(
      ok({ LnvnE51P5gc: { id: "LnvnE51P5gc", remoteurl: "https://vid.me/x", status: "new", bytes_loaded: null, bytes_total: null, folderid: "0", added: "a", last_update: "b", extid: false, url: false } }),
      "LnvnE51P5gc"
    );
    expect(task).toMatchObject({ id: "LnvnE51P5gc", status: "new", extid: false, url: false });
    expect(parseRemoteStatusResult(ok({}), "nope")).toBeNull();
  });

  it("a queued/new/unknown task is never 'done'", () => {
    const base = { id: "t", remoteUrl: null, bytesLoaded: null, bytesTotal: null, folderId: null, added: null, lastUpdate: null, extid: false as const, url: false as const };
    expect(mapRemoteTaskState({ ...base, status: "new" })).toBe("processing");
    expect(mapRemoteTaskState({ ...base, status: "something-undocumented" })).toBe("processing");
    expect(mapRemoteTaskState({ ...base, status: "error" })).toBe("failed");
    expect(mapRemoteTaskState({ ...base, status: "finished" })).toBe("done");
    expect(mapRemoteTaskState({ ...base, status: "downloading", url: "https://streamtape.com/v/wg8ad12d3QiJRXG/a.mp4" })).toBe("done");
  });
});
