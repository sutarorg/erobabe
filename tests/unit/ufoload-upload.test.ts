import { describe, it, expect, vi } from "vitest";
import {
  UfoloadUploadError,
  chunkUrl,
  uploadFileInChunks,
  type ChunkProgress,
  type UfoloadUploadSession,
  type UploadInChunksOptions,
} from "@/src/utils/ufoloadUpload";
import { UploadAbortedError } from "@/src/utils/uploadFile";
import { UFOLOAD_MAX_CHUNK_BYTES } from "@/lib/video/limits";
import { createFakeNode, virtualFile, type FakeNode } from "./helpers/fake-node";

/**
 * The browser half of UFOLOAD's direct upload (chunked PUT with offsets, GET
 * to resume). The node is a scripted mock built from the OpenAPI description —
 * see helpers/fake-node.ts. These tests prove protocol conformance; real
 * CORS/grant behaviour is covered by the live smoke test in DEPLOYMENT.md.
 */

const MiB = 1024 * 1024;
const UPLOAD_URL = "https://upload.ufoload.com/07/_node/v1/ingest/upl_1";
const GRANT = "UfoGrant test-grant";

function session(overrides: Partial<UfoloadUploadSession> = {}): UfoloadUploadSession {
  return {
    jobId: "job-1",
    uploadId: "upl_1",
    uploadUrl: UPLOAD_URL,
    authorization: GRANT,
    chunkSize: 4 * MiB,
    maxBytes: 5 * 1024 * MiB,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

function run(fake: FakeNode, size: number, extra: Partial<UploadInChunksOptions> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const progress: ChunkProgress[] = [];
  const promise = uploadFileInChunks({
    file: virtualFile(size),
    session: session(),
    createXhr: fake.createXhr,
    fetchImpl: fake.fetch,
    sleep,
    onProgress: (event) => progress.push(event),
    ...extra,
  });
  return { promise, sleep, progress };
}

async function errorOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the upload to fail");
}

const FORBIDDEN_HEADERS = [
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
];

describe("chunking, offsets and limits", () => {
  it("sends the file in order, each chunk at the offset the node has accepted", async () => {
    const fake = createFakeNode();
    const { promise } = run(fake, 10 * MiB);
    await expect(promise).resolves.toEqual({ bytes: 10 * MiB, chunks: 3 });

    expect(fake.puts().map((request) => [request.offsetParam, request.size])).toEqual([
      [0, 4 * MiB],
      [4 * MiB, 4 * MiB],
      [8 * MiB, 2 * MiB],
    ]);
    expect(fake.node.applied).toEqual([
      { offset: 0, length: 4 * MiB },
      { offset: 4 * MiB, length: 4 * MiB },
      { offset: 8 * MiB, length: 2 * MiB },
    ]);
    expect(fake.node.accepted).toBe(10 * MiB);
  });

  it("uses exactly the URL UFOLOAD returned, adding only the documented offset parameter", async () => {
    const fake = createFakeNode();
    await run(fake, 9 * MiB).promise;
    for (const request of fake.puts()) {
      expect(request.url).toBe(`${UPLOAD_URL}?offset=${request.offsetParam}`);
    }
    expect(chunkUrl(UPLOAD_URL, 42)).toBe(`${UPLOAD_URL}?offset=42`);
    // A query string already on the node URL is preserved, not replaced.
    expect(chunkUrl(`${UPLOAD_URL}?region=eu`, 7)).toBe(`${UPLOAD_URL}?region=eu&offset=7`);
  });

  it("respects a smaller chunk_size from the grant", async () => {
    const fake = createFakeNode();
    await run(fake, 5 * MiB, { session: session({ chunkSize: MiB }) }).promise;
    expect(fake.puts()).toHaveLength(5);
    expect(Math.max(...fake.puts().map((request) => request.size ?? 0))).toBe(MiB);
  });

  it("never sends more than the node's 256 MiB per request, whatever chunk_size says", async () => {
    const fake = createFakeNode({ progressSteps: 1 });
    await run(fake, 600 * MiB, { session: session({ chunkSize: 1024 * MiB }) }).promise;
    expect(fake.puts().map((request) => request.size)).toEqual([UFOLOAD_MAX_CHUNK_BYTES, UFOLOAD_MAX_CHUNK_BYTES, 88 * MiB]);
  });

  it("refuses a file larger than max_bytes before a single byte is sent", async () => {
    const fake = createFakeNode();
    const error = await errorOf(run(fake, 3 * MiB, { session: session({ maxBytes: 2 * MiB }) }).promise);
    expect(error).toBeInstanceOf(UfoloadUploadError);
    expect(error).toMatchObject({ code: "file_too_large", resumable: false });
    expect(fake.node.requests).toHaveLength(0);
  });

  it("accepts a file of exactly max_bytes", async () => {
    const fake = createFakeNode();
    await expect(run(fake, 2 * MiB, { session: session({ maxBytes: 2 * MiB }) }).promise).resolves.toMatchObject({ bytes: 2 * MiB });
  });

  it.each([
    ["an empty file", { file: virtualFile(0) }],
    ["a non-https node URL", { session: session({ uploadUrl: "http://upload.ufoload.com/07/_node/v1/ingest/upl_1" }) }],
    ["an unparseable node URL", { session: session({ uploadUrl: "not a url" }) }],
    ["a grant with a line break", { session: session({ authorization: "UfoGrant x\r\nX-Evil: 1" }) }],
    ["an empty grant", { session: session({ authorization: "" }) }],
    ["a zero chunk size", { session: session({ chunkSize: 0 }) }],
  ])("rejects %s without contacting the node", async (_label, override) => {
    const fake = createFakeNode();
    const error = await errorOf(run(fake, 3 * MiB, override as Partial<UploadInChunksOptions>).promise);
    expect(error).toBeInstanceOf(UfoloadUploadError);
    expect(error.code).toBe("invalid_session");
    expect(error.resumable).toBe(false);
    expect(fake.node.requests).toHaveLength(0);
  });
});

describe("request headers", () => {
  it("sets only Authorization and Content-Type — no forbidden browser headers", async () => {
    const fake = createFakeNode();
    await run(fake, 9 * MiB).promise;

    expect(fake.node.xhrInstances.length).toBe(3);
    for (const xhr of fake.node.xhrInstances) {
      const names = xhr.headersSet.map(([name]: [string, string]) => name.toLowerCase());
      expect(names.sort()).toEqual(["authorization", "content-type"]);
      for (const name of names) {
        expect(FORBIDDEN_HEADERS).not.toContain(name);
        expect(name.startsWith("proxy-") || name.startsWith("sec-")).toBe(false);
      }
      expect(xhr.headers.authorization).toBe(GRANT);
      expect(xhr.headers["content-type"]).toBe("application/octet-stream");
      expect(xhr.withCredentials).toBe(false);
    }
  });

  it("never sends anything but the grant as a credential (the API key is not in the browser)", async () => {
    const fake = createFakeNode();
    await run(fake, 5 * MiB).promise;
    // A resumed upload only asks the node where it stands.
    const resumed = createFakeNode({ accepted: 5 * MiB });
    await run(resumed, 5 * MiB, { resume: true }).promise;

    const requests = [...fake.node.requests, ...resumed.node.requests];
    expect(requests.some((request) => request.method === "PUT")).toBe(true);
    expect(requests.some((request) => request.method === "GET")).toBe(true);
    for (const request of requests) {
      expect(Object.keys(request.headers).sort()).toEqual(request.method === "PUT" ? ["authorization", "content-type"] : ["authorization"]);
      expect(request.headers.authorization).toBe(GRANT);
      expect(request.headers.authorization).not.toMatch(/Bearer/);
    }
  });
});

describe("progress", () => {
  it("reports real, monotonic bytes and never 100% before the node has accepted the last byte", async () => {
    const fake = createFakeNode({ progressSteps: 3 });
    const { promise, progress } = run(fake, 9 * MiB);
    await promise;

    const percents = progress.map((event) => event.percent);
    expect(percents[0]).toBe(0);
    for (let index = 1; index < percents.length; index++) expect(percents[index]).toBeGreaterThanOrEqual(percents[index - 1]);

    const last = progress.at(-1)!;
    expect(last).toMatchObject({ loaded: 9 * MiB, total: 9 * MiB, percent: 100 });
    // Everything before the final acknowledgement stays strictly below 100.
    expect(progress.slice(0, -1).every((event) => event.percent < 100)).toBe(true);
    expect(progress.slice(0, -1).every((event) => event.loaded < 9 * MiB)).toBe(true);
  });

  it("reports acknowledged chunk boundaries exactly", async () => {
    const fake = createFakeNode({ progressSteps: 1 });
    const { promise, progress } = run(fake, 8 * MiB);
    await promise;
    expect(progress.map((event) => event.loaded)).toContain(4 * MiB);
    expect(progress.map((event) => event.loaded).at(-1)).toBe(8 * MiB);
  });

  it("does not claim 100% when the last chunk never gets through", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok" }, { type: "status", status: 503 }, { type: "status", status: 503 });
    const { promise, progress } = run(fake, 8 * MiB, { maxAttempts: 2 });
    const error = await errorOf(promise);
    expect(error).toMatchObject({ code: "node_unavailable", resumable: true, offset: 4 * MiB });
    expect(progress.some((event) => event.percent >= 100)).toBe(false);
    expect(fake.node.accepted).toBe(4 * MiB);
  });

  it("omits the speed until a real window of bytes has been observed", async () => {
    const fake = createFakeNode({ progressSteps: 2 });
    let clock = 0;
    const { promise, progress } = run(fake, 8 * MiB, { now: () => (clock += 400) });
    await promise;
    expect(progress[0].bytesPerSecond).toBeNull();
    const speeds = progress.map((event) => event.bytesPerSecond).filter((value): value is number => value !== null);
    expect(speeds.every((value) => value >= 0 && Number.isFinite(value))).toBe(true);
  });
});

describe("completion only after every chunk", () => {
  it("resolves only once the node holds every byte, so a caller can safely complete", async () => {
    const fake = createFakeNode();
    const order: string[] = [];
    const total = 12 * MiB;
    const completed = run(fake, total).promise.then(() => {
      order.push(`complete@${fake.node.accepted}`);
    });
    await completed;
    expect(order).toEqual([`complete@${total}`]);
  });

  it("rejects — so the caller never completes — when the grant is refused part-way", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok" }, { type: "status", status: 401 });
    const order: string[] = [];
    await run(fake, 10 * MiB).promise.then(() => order.push("complete"), () => order.push("failed"));
    expect(order).toEqual(["failed"]);
    expect(fake.node.accepted).toBe(4 * MiB);
  });
});

describe("retry and resume", () => {
  it("after a dropped connection asks the node where it is and continues from that offset", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok" }, { type: "network" });
    const { promise, sleep } = run(fake, 12 * MiB);
    await promise;

    expect(fake.puts().map((request) => request.offsetParam)).toEqual([0, 4 * MiB, 4 * MiB, 8 * MiB]);
    expect(fake.gets()).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.node.applied.map((chunk) => chunk.offset)).toEqual([0, 4 * MiB, 8 * MiB]);
  });

  it("does not re-send a chunk the node stored but whose response was lost", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok" }, { type: "applied-then-network" });
    await run(fake, 12 * MiB).promise;

    // Chunk 2 was applied, the browser never heard back, the node's own offset (8 MiB) wins.
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([0, 4 * MiB, 8 * MiB]);
    expect(fake.node.applied.map((chunk) => chunk.offset)).toEqual([0, 4 * MiB, 8 * MiB]);
    expect(fake.node.accepted).toBe(12 * MiB);
  });

  it("resyncs after a 409 offset mismatch instead of guessing", async () => {
    const fake = createFakeNode({ accepted: 4 * MiB }); // the node is already ahead of the browser
    await run(fake, 12 * MiB).promise;
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([0, 4 * MiB, 8 * MiB]);
    expect(fake.gets()).toHaveLength(1);
    expect(fake.node.applied.map((chunk) => chunk.offset)).toEqual([4 * MiB, 8 * MiB]);
  });

  it("continues from the offset a node reports when it accepts only part of a chunk", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok-offset", offset: MiB });
    await run(fake, 6 * MiB, { session: session({ chunkSize: 2 * MiB }) }).promise;
    expect(fake.puts().map((request) => request.offsetParam).slice(0, 2)).toEqual([0, MiB]);
    expect(fake.node.accepted).toBe(6 * MiB);
  });

  it("does not trust a PUT response that disagrees with what was sent — it asks the node and carries on", async () => {
    // A node whose PUT answer echoes where the chunk STARTED. The body is undocumented, so the
    // upload must neither fail nor loop: GET {url} is the source of truth.
    const fake = createFakeNode();
    fake.script({ type: "ok-start-offset" }, { type: "ok-start-offset" }, { type: "ok-start-offset" });
    const { promise, sleep } = run(fake, 9 * MiB);
    await expect(promise).resolves.toEqual({ bytes: 9 * MiB, chunks: 3 });
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([0, 4 * MiB, 8 * MiB]);
    expect(fake.gets().length).toBe(3);
    // Not treated as a failure: no backoff was needed.
    expect(sleep).not.toHaveBeenCalled();
  });

  it("trusts an echoed offset when the node sends one", async () => {
    const fake = createFakeNode({ echoOffset: true });
    await expect(run(fake, 9 * MiB).promise).resolves.toMatchObject({ chunks: 3 });
    expect(fake.gets()).toHaveLength(0);
  });

  it("resumes a half-sent upload from the node's offset when asked to", async () => {
    const fake = createFakeNode({ accepted: 8 * MiB });
    const { promise, progress } = run(fake, 12 * MiB, { resume: true });
    await promise;

    expect(fake.node.requests[0]).toMatchObject({ method: "GET", url: UPLOAD_URL });
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([8 * MiB]);
    expect(progress[0]).toMatchObject({ loaded: 8 * MiB });
    expect(Math.round(progress[0].percent)).toBe(67);
  });

  it("sends nothing when a resumed upload already has every byte", async () => {
    const fake = createFakeNode({ accepted: 6 * MiB });
    const result = await run(fake, 6 * MiB, { resume: true }).promise;
    expect(result).toEqual({ bytes: 6 * MiB, chunks: 0 });
    expect(fake.puts()).toHaveLength(0);
  });

  it("retries the resume query itself with backoff", async () => {
    const fake = createFakeNode({ accepted: 4 * MiB });
    fake.scriptGet({ network: true }, { status: 503 });
    const { promise, sleep } = run(fake, 8 * MiB, { resume: true });
    await promise;
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([4 * MiB]);
  });

  it("gives up after maxAttempts consecutive failures and says the upload is resumable", async () => {
    const fake = createFakeNode();
    fake.script({ type: "status", status: 503 }, { type: "status", status: 503 }, { type: "status", status: 503 });
    const { promise, sleep } = run(fake, 8 * MiB, { maxAttempts: 3, retryDelaysMs: [10, 20, 30] });
    const error = await errorOf(promise);

    expect(error).toBeInstanceOf(UfoloadUploadError);
    expect(error).toMatchObject({ code: "node_unavailable", resumable: true, status: 503, offset: 0 });
    expect(fake.puts()).toHaveLength(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([10, 20]);
  });

  it("resets the failure count whenever a chunk is accepted", async () => {
    const fake = createFakeNode();
    fake.script({ type: "status", status: 503 }, { type: "ok" }, { type: "status", status: 503 }, { type: "ok" }, { type: "status", status: 503 }, { type: "ok" });
    await expect(run(fake, 12 * MiB, { maxAttempts: 2 }).promise).resolves.toMatchObject({ bytes: 12 * MiB });
  });

  it("treats a connection that drops and never recovers as a resumable network error with a helpful message", async () => {
    const fake = createFakeNode();
    fake.script({ type: "network" }, { type: "network" });
    fake.scriptGet({ network: true }, { network: true });
    const error = await errorOf(run(fake, 8 * MiB, { maxAttempts: 2 }).promise);
    expect(error).toMatchObject({ code: "network", resumable: true });
    expect(error.message).toMatch(/Retry to resume/);
    expect(error.message).toMatch(/CORS and network check/);
  });

  it("does not loop forever on a 2xx that accepted nothing", async () => {
    const fake = createFakeNode();
    fake.script({ type: "ok-offset", offset: 0 }, { type: "ok-offset", offset: 0 }, { type: "ok-offset", offset: 0 });
    const error = await errorOf(run(fake, 8 * MiB, { maxAttempts: 3 }).promise);
    expect(error).toMatchObject({ code: "node_unavailable", resumable: true });
    expect(fake.puts()).toHaveLength(3);
  });
});

describe("expired grants and lost sessions", () => {
  it.each([401, 403])("a %s on a chunk means the grant expired — no retry, new session needed", async (status) => {
    const fake = createFakeNode();
    fake.script({ type: "status", status });
    const { promise, sleep } = run(fake, 8 * MiB);
    const error = await errorOf(promise);
    expect(error).toMatchObject({ code: "grant_expired", resumable: false, status });
    expect(error.message).toMatch(/expired/);
    expect(fake.puts()).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a 401 when asking where to resume is also an expired grant", async () => {
    const fake = createFakeNode({ authorization: "UfoGrant someone-else" });
    const error = await errorOf(run(fake, 8 * MiB, { resume: true }).promise);
    expect(error).toMatchObject({ code: "grant_expired", resumable: false });
    expect(fake.puts()).toHaveLength(0);
  });

  it.each([404, 410])("a %s means UFOLOAD no longer has the session", async (status) => {
    const fake = createFakeNode();
    fake.script({ type: "status", status });
    const error = await errorOf(run(fake, 8 * MiB).promise);
    expect(error).toMatchObject({ code: "session_lost", resumable: false });
    expect(error.message).toMatch(/Start the upload again/);
  });

  it("does not retry a 4xx the protocol does not explain", async () => {
    const fake = createFakeNode();
    fake.script({ type: "status", status: 400 });
    const error = await errorOf(run(fake, 8 * MiB).promise);
    expect(error).toMatchObject({ code: "chunk_rejected", resumable: false, status: 400 });
    expect(fake.puts()).toHaveLength(1);
  });

  it("a 413 from the node is final", async () => {
    const fake = createFakeNode();
    fake.script({ type: "status", status: 413 });
    const error = await errorOf(run(fake, 8 * MiB).promise);
    expect(error).toMatchObject({ code: "file_too_large", resumable: false });
  });
});

describe("cancellation and stalls", () => {
  it("aborting stops the in-flight request and sends nothing more", async () => {
    const fake = createFakeNode({ progressSteps: 4 });
    const controller = new AbortController();
    const { promise } = run(fake, 12 * MiB, {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.loaded > 0 && event.loaded < 4 * MiB) controller.abort();
      },
    });
    const error = await errorOf(promise);
    expect(error).toBeInstanceOf(UploadAbortedError);
    expect(fake.puts()).toHaveLength(1);
    expect(fake.node.xhrInstances[0].aborted).toBe(true);
    expect(fake.node.accepted).toBe(0);
  });

  it("an already-aborted signal sends nothing at all", async () => {
    const fake = createFakeNode();
    const controller = new AbortController();
    controller.abort();
    const error = await errorOf(run(fake, 8 * MiB, { signal: controller.signal }).promise);
    expect(error).toBeInstanceOf(UploadAbortedError);
    expect(fake.node.requests).toHaveLength(0);
  });

  it("aborting during the retry backoff ends the upload promptly", async () => {
    const fake = createFakeNode();
    fake.script({ type: "network" });
    const controller = new AbortController();
    const promise = uploadFileInChunks({
      file: virtualFile(8 * MiB),
      session: session(),
      createXhr: fake.createXhr,
      fetchImpl: fake.fetch,
      signal: controller.signal,
      retryDelaysMs: [60_000],
    });
    setTimeout(() => controller.abort(), 30);
    const started = Date.now();
    const error = await errorOf(promise);
    expect(error).toBeInstanceOf(UploadAbortedError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("aborts a chunk that moves no bytes and retries from the node's offset", async () => {
    const fake = createFakeNode();
    fake.script({ type: "hang" }, { type: "ok" });
    const { promise } = run(fake, 4 * MiB, { stallTimeoutMs: 25, maxAttempts: 3 });
    await promise;
    expect(fake.node.xhrInstances[0].aborted).toBe(true);
    expect(fake.puts().map((request) => request.offsetParam)).toEqual([0, 0]);
    expect(fake.node.accepted).toBe(4 * MiB);
  });

  it("reports a persistent stall as resumable", async () => {
    const fake = createFakeNode();
    fake.script({ type: "hang" }, { type: "hang" });
    const error = await errorOf(run(fake, 4 * MiB, { stallTimeoutMs: 15, maxAttempts: 2 }).promise);
    expect(error).toMatchObject({ code: "stalled", resumable: true });
    expect(error.message).toMatch(/stalled/);
  });
});

describe("keep-alive (through our server, never with the API key)", () => {
  it("calls the keep-alive callback about once per interval while bytes move — not on every event", async () => {
    const fake = createFakeNode({ progressSteps: 5 });
    let clock = 0;
    const keepAlive = vi.fn(async () => "ok" as const);
    await run(fake, 12 * MiB, {
      keepAlive,
      keepAliveIntervalMs: 10_000,
      now: () => (clock += 1000),
    }).promise;
    expect(keepAlive.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(keepAlive.mock.calls.length).toBeLessThan(fake.node.xhrInstances.length * 5);
    // Keep-alive goes to the app server via the callback; the node only ever sees chunk traffic.
    expect(fake.node.requests.every((request) => request.url.startsWith(UPLOAD_URL))).toBe(true);
  });

  it("stops the upload when the keep-alive learns UFOLOAD closed the session", async () => {
    const fake = createFakeNode({ progressSteps: 6 });
    let clock = 0;
    const error = await errorOf(
      run(fake, 12 * MiB, {
        keepAlive: async () => "gone",
        keepAliveIntervalMs: 1,
        now: () => (clock += 1000),
      }).promise
    );
    expect(error).toMatchObject({ code: "session_lost", resumable: false });
  });

  it("a failing keep-alive does not abort a healthy upload", async () => {
    const fake = createFakeNode({ progressSteps: 3 });
    let clock = 0;
    const keepAlive = vi.fn(async () => {
      throw new Error("server hiccup");
    });
    await expect(
      run(fake, 8 * MiB, { keepAlive, keepAliveIntervalMs: 1, now: () => (clock += 1000) }).promise
    ).resolves.toMatchObject({ bytes: 8 * MiB });
    expect(keepAlive).toHaveBeenCalled();
  });
});
