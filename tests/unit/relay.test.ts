// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { signRelayToken } from "@/lib/video/relay-token";
import { createRelay, isAllowedUploadHost, isValidRelaySecret, makeUsedTracker } from "../../relay/streamtape-relay.mjs";

/**
 * Exercises the real relay HTTP server. Only the *upstream* Streamtape node is
 * stubbed (global fetch); the relay's own HTTP handling, token verification,
 * SSRF guard, CORS and streaming run for real.
 */

const SECRET = "relay-secret-0123456789abcdef";
const ORIGIN = "https://erobabe.example";
const NODE = "https://tapecontent.net/xfsupload/abc";
const realFetch = globalThis.fetch;

let server: ReturnType<typeof createRelay>;
let base = "";
let upstream: Array<{ url: string; method: string; contentType: string | null; body: string }> = [];
let upstreamBehaviour: () => Promise<Response> = async () => new Response(JSON.stringify({ status: 200, result: { id: "wg8ad12d3QiJRXG" } }), { status: 200, headers: { "content-type": "application/json" } });

function token(over: Partial<{ u: string; s: string; exp: number }> = {}, secret = SECRET) {
  return signRelayToken({ u: NODE, s: `s-${Math.random().toString(36).slice(2)}`, exp: Date.now() + 60_000, ...over }, secret);
}

beforeEach(async () => {
  upstream = [];
  upstreamBehaviour = async () => new Response(JSON.stringify({ status: 200, result: { id: "wg8ad12d3QiJRXG" } }), { status: 200, headers: { "content-type": "application/json" } });
  server = createRelay({ secret: SECRET, allowedOrigins: [ORIGIN] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: any) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      // Upstream: drain the streamed body like a real node would.
      const chunks: Buffer[] = [];
      const reader = (init.body as ReadableStream).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      upstream.push({ url, method: init.method, contentType: init.headers["Content-Type"], body: Buffer.concat(chunks).toString("latin1") });
      return upstreamBehaviour();
    })
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: BodyInit | null = "payload", headers: Record<string, string> = {}) {
  return realFetch(`${base}${path}`, { method: "POST", body, headers: { Origin: ORIGIN, ...headers } });
}

describe("relay upload", () => {
  it("streams a multipart body to the node and passes the node response through verbatim", async () => {
    const form = new FormData();
    form.append("file1", new Blob(["VIDEOBYTES"], { type: "video/mp4" }), "clip.mp4");
    const response = await post(`/upload/${token()}`, form);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, result: { id: "wg8ad12d3QiJRXG" } });
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe(NODE);
    expect(upstream[0].method).toBe("POST");
    expect(upstream[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(upstream[0].body).toContain('name="file1"');
    expect(upstream[0].body).toContain("VIDEOBYTES");
  });

  it("passes upstream error statuses through instead of masking them", async () => {
    upstreamBehaviour = async () => new Response(JSON.stringify({ status: 509, msg: "Bandwidth" }), { status: 509, headers: { "content-type": "application/json" } });
    const response = await post(`/upload/${token()}`);
    expect(response.status).toBe(509);
  });

  it("answers 502 when the node is unreachable", async () => {
    upstreamBehaviour = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    const response = await post(`/upload/${token()}`);
    expect(response.status).toBe(502);
    expect((await response.json()).msg).toMatch(/could not reach/i);
  });

  it("makes each session single-use", async () => {
    const t = token({ s: "once-only" });
    expect((await post(`/upload/${t}`)).status).toBe(200);
    const second = await post(`/upload/${t}`);
    expect(second.status).toBe(409);
    expect(upstream).toHaveLength(1);
  });

  it("rejects bad signatures (403) and expired tokens (410) without contacting the node", async () => {
    expect((await post(`/upload/${token({}, "a-different-secret-0123456789")}`)).status).toBe(403);
    expect((await post(`/upload/${token({ exp: Date.now() - 1000 })}`)).status).toBe(410);
    expect((await post(`/upload/garbage`)).status).toBe(403);
    expect(upstream).toHaveLength(0);
  });

  it("refuses to relay to a host outside the provider allowlist, even with a valid signature", async () => {
    const response = await post(`/upload/${token({ u: "https://evil.example.com/steal" })}`);
    expect(response.status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("enforces origin allowlisting for POST and preflight", async () => {
    const blocked = await realFetch(`${base}/upload/${token()}`, { method: "POST", body: "x", headers: { Origin: "https://evil.example" } });
    expect(blocked.status).toBe(403);
    const preflightBad = await realFetch(`${base}/upload/x`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(preflightBad.status).toBe(403);
    const preflightOk = await realFetch(`${base}/upload/x`, { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(preflightOk.status).toBe(204);
    expect(preflightOk.headers.get("access-control-allow-methods")).toContain("POST");
    expect(upstream).toHaveLength(0);
  });

  it("applies the size cap and 404s unknown routes; /health works", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createRelay({ secret: SECRET, allowedOrigins: [ORIGIN], maxUploadBytes: 4 });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await post(`/upload/${token()}`, "way more than four bytes")).status).toBe(413);
    expect((await realFetch(`${base}/nope`)).status).toBe(404);
    expect((await realFetch(`${base}/health`)).status).toBe(200);
  });
});

describe("helpers", () => {
  it("requires a long, non-placeholder relay secret", () => {
    expect(isValidRelaySecret("short")).toBe(false);
    expect(isValidRelaySecret("generate_a_long_random_string")).toBe(false);
    expect(isValidRelaySecret("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isValidRelaySecret(SECRET)).toBe(true);
  });

  it("isAllowedUploadHost mirrors the app-side guard", () => {
    expect(isAllowedUploadHost("https://a.tapecontent.net/x")).toBe(true);
    expect(isAllowedUploadHost("http://tapecontent.net/x")).toBe(false);
    expect(isAllowedUploadHost("https://tapecontent.net.evil.com/x")).toBe(false);
    expect(isAllowedUploadHost("https://x.example/", ["example"])).toBe(true);
  });

  it("makeUsedTracker is single-use and bounded", () => {
    const tracker = makeUsedTracker(2);
    expect(tracker.claim("a")).toBe(true);
    expect(tracker.claim("a")).toBe(false);
    tracker.claim("b");
    tracker.claim("c");
    expect(tracker.size()).toBe(2);
  });
});
