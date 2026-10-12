// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";
import { rejected } from "./helpers/provider-errors";

/**
 * The real `StreamtapeProvider` against a stubbed `fetch`: request building,
 * envelope validation, error semantics, timeouts and credential safety.
 * (Real-network behaviour is covered only by tests/live/streamtape.live.test.ts.)
 */

const LOGIN = "login-secret-abcdef";
const KEY = "key-secret-0123456789";
const ID = "wg8ad12d3QiJRXG";
const previousEnv = { ...process.env };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
const ok = (result: unknown) => ({ status: 200, msg: "OK", result });

let calls: URL[] = [];
function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = new URL(String(input));
      calls.push(url);
      return handler(url);
    })
  );
}

beforeEach(() => {
  calls = [];
  process.env.STREAMTAPE_LOGIN = LOGIN;
  process.env.STREAMTAPE_API_KEY = KEY;
  process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED = "true";
  delete process.env.STREAMTAPE_FOLDER_ID;
  delete process.env.STREAMTAPE_UPLOAD_HOST_SUFFIXES;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env = { ...previousEnv };
});

describe("configuration gate", () => {
  it("refuses to run without credentials", async () => {
    delete process.env.STREAMTAPE_API_KEY;
    const provider = new StreamtapeProvider();
    expect(() => provider.assertEnabled()).toThrow(/STREAMTAPE_API_KEY/);
    const error = await rejected(provider.getUploadUrl());
    expect(error.code).toBe("missing_credentials");
    expect(error.status).toBe(503);
  });

  it("refuses to upload until the content-policy gate is set", () => {
    process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED = "false";
    const provider = new StreamtapeProvider();
    expect(provider.isEnabled()).toBe(false);
    try {
      provider.assertEnabled();
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as StreamtapeError).code).toBe("provider_not_approved");
      expect((error as Error).message).toMatch(/STREAMTAPE_ADULT_CONTENT_ALLOWED=true/);
    }
  });

  it("requires a real HTTPS relay URL and a strong non-placeholder relay secret", () => {
    const provider = new StreamtapeProvider();
    delete process.env.STREAMTAPE_RELAY_URL;
    expect(() => provider.assertRelayConfigured()).toThrow(/STREAMTAPE_RELAY_URL is not set/);

    process.env.STREAMTAPE_RELAY_URL = "[https://relay.example.com](https://relay.example.com)";
    expect(() => provider.assertRelayConfigured()).toThrow(/STREAMTAPE_RELAY_URL is invalid/);

    process.env.STREAMTAPE_RELAY_URL = "https://relay.example.com";
    expect(() => provider.assertRelayConfigured()).toThrow(/example.com placeholder/);

    process.env.STREAMTAPE_RELAY_URL = "https://relay.erobabe.com/";
    process.env.STREAMTAPE_RELAY_SECRET = "short";
    expect(() => provider.assertRelayConfigured()).toThrow(/STREAMTAPE_RELAY_SECRET/);

    process.env.STREAMTAPE_RELAY_SECRET = "generate_a_long_random_string";
    expect(() => provider.assertRelayConfigured()).toThrow(/placeholder values/);

    process.env.STREAMTAPE_RELAY_SECRET = "a-long-enough-relay-secret";
    expect(provider.assertRelayConfigured()).toBe("https://relay.erobabe.com");
  });
});

describe("request building", () => {
  it("sends login/key as query parameters to the documented base and skips the folder when unset", async () => {
    stubFetch(() => json(ok({ url: "https://tapecontent.net/xfsupload/abc", valid_until: "2030-01-01 00:00:00" })));
    const result = await new StreamtapeProvider().getUploadUrl();
    expect(result.url).toBe("https://tapecontent.net/xfsupload/abc");
    expect(calls).toHaveLength(1);
    expect(calls[0].origin + calls[0].pathname).toBe("https://api.streamtape.com/file/ul");
    expect(calls[0].searchParams.get("login")).toBe(LOGIN);
    expect(calls[0].searchParams.get("key")).toBe(KEY);
    expect(calls[0].searchParams.has("folder")).toBe(false);
    expect(calls[0].searchParams.has("httponly")).toBe(false);
  });

  it("passes the optional folder id when configured", async () => {
    process.env.STREAMTAPE_FOLDER_ID = "LnvnE51P5gc";
    stubFetch(() => json(ok({ url: "https://tapecontent.net/xfsupload/abc", valid_until: "2030-01-01 00:00:00" })));
    await new StreamtapeProvider().getUploadUrl();
    expect(calls[0].searchParams.get("folder")).toBe("LnvnE51P5gc");
  });

  it("url-encodes file ids and names", async () => {
    stubFetch(() => json(ok(true)));
    await new StreamtapeProvider().renameFile(ID, "Evening & Velvet=1");
    expect(calls[0].searchParams.get("name")).toBe("Evening & Velvet=1");
    expect(calls[0].href).not.toContain("Velvet=1&");
  });

  it("rejects malformed file ids before any request is made", async () => {
    stubFetch(() => json(ok({})));
    await expect(new StreamtapeProvider().fetchFileInfo("../x")).rejects.toThrow(/malformed/);
    expect(calls).toHaveLength(0);
  });
});

describe("response handling", () => {
  it("parses file info and reports readiness", async () => {
    stubFetch(() => json(ok({ [ID]: { id: ID, name: "a.mp4", size: 5, type: "video/mp4", converted: true, status: 200 } })));
    const provider = new StreamtapeProvider();
    expect((await provider.fetchFileInfo(ID))?.converted).toBe(true);
    await expect(provider.getFileInfo(ID)).resolves.toMatchObject({ fileId: ID, canPlay: true, status: 200, providerStatus: "converted" });
  });

  it("reports a not-yet-converted file as processing (202), never playable", async () => {
    stubFetch(() => json(ok({ [ID]: { id: ID, name: "a.mp4", size: 5, type: "video/mp4", converted: false, status: 200 } })));
    await expect(new StreamtapeProvider().getFileInfo(ID)).resolves.toMatchObject({ canPlay: false, status: 202 });
  });

  it("treats an absent file as a 404 for getFileInfo", async () => {
    stubFetch(() => json(ok({})));
    const error = await rejected(new StreamtapeProvider().getFileInfo(ID));
    expect(error.status).toBe(404);
  });

  it("treats an HTTP-200 body with envelope status 403 as an error", async () => {
    stubFetch(() => json({ status: 403, msg: "Permission denied", result: null }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/STREAMTAPE_LOGIN/);
  });

  it.each([
    [451, /legal reasons/],
    [509, /bandwidth/i],
    [404, /could not find/],
  ])("maps envelope status %i", async (status, pattern) => {
    stubFetch(() => json({ status, msg: "x", result: null }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.status).toBe(status);
    expect(error.message).toMatch(pattern);
  });

  it("maps transient HTTP 5xx and keeps Retry-After", async () => {
    stubFetch(() => json({ status: 500, msg: "Too high server load", result: null }, 503, { "retry-after": "12" }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.status).toBe(500);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it("flags malformed JSON and empty bodies as upstream failures", async () => {
    stubFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const malformed = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(malformed.code).toBe("invalid_json");
    expect(malformed.status).toBe(502);

    stubFetch(() => new Response("", { status: 200 }));
    expect((await rejected(new StreamtapeProvider().fetchFileInfo(ID))).code).toBe("invalid_json");
  });

  it("flags a non-envelope JSON body as malformed", async () => {
    stubFetch(() => json({ hello: "world" }));
    expect((await rejected(new StreamtapeProvider().fetchFileInfo(ID))).code).toBe("malformed_response");
  });

  it("rejects an upload URL on an unexpected host", async () => {
    stubFetch(() => json(ok({ url: "https://evil.example.com/x", valid_until: "2030-01-01 00:00:00" })));
    expect((await rejected(new StreamtapeProvider().getUploadUrl())).code).toBe("bad_upload_url");
  });

  it("deleteFile returns false for 404 and true on success", async () => {
    stubFetch(() => json({ status: 404, msg: "File not found", result: null }));
    await expect(new StreamtapeProvider().deleteFile(ID)).resolves.toBe(false);
    stubFetch(() => json(ok(true)));
    await expect(new StreamtapeProvider().deleteFile(ID)).resolves.toBe(true);
  });

  it("never sends remotedl/remove with id=all", async () => {
    stubFetch(() => json(ok(true)));
    await expect(new StreamtapeProvider().removeRemoteUpload("all")).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    await new StreamtapeProvider().removeRemoteUpload("rbAarvRPXdYbaxY");
    expect(calls[0].searchParams.get("id")).toBe("rbAarvRPXdYbaxY");
  });

  it("splash lookups are best-effort", async () => {
    stubFetch(() => json({ status: 500, msg: "boom", result: null }));
    await expect(new StreamtapeProvider().getSplashUrl(ID)).resolves.toBeNull();
  });
});

describe("timeouts and network errors", () => {
  it("reports a timeout with an actionable message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: any, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }))
    );
    const pending = rejected(new StreamtapeProvider().fetchFileInfo(ID));
    await vi.advanceTimersByTimeAsync(16_000);
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.status).toBe(0);
  });

  it("reports a network error without echoing the request URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError(`fetch failed: https://api.streamtape.com/file/info?login=${LOGIN}&key=${KEY}`);
    }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.code).toBe("network_error");
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain(LOGIN);
  });
});

describe("credential safety", () => {
  it("redacts credentials echoed back by the provider in error messages", async () => {
    stubFetch(() => json({ status: 403, msg: `bad login=${LOGIN} key=${KEY} (${KEY})`, result: null }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain(LOGIN);
  });

  it("redacts credentials on non-JSON error bodies", async () => {
    stubFetch(() => new Response(`gateway error for key=${KEY}`, { status: 502 }));
    const error = await rejected(new StreamtapeProvider().fetchFileInfo(ID));
    expect(error.message).not.toContain(KEY);
  });

  it("checkAccount returns only success/latency or a redacted error", async () => {
    stubFetch(() => json(ok({ apiid: "x", email: "owner@example.com", signup_at: "2019-12-31" })));
    const good = await new StreamtapeProvider().checkAccount();
    expect(good.ok).toBe(true);
    expect(JSON.stringify(good)).not.toContain("owner@example.com");

    stubFetch(() => json({ status: 403, msg: `denied key=${KEY}`, result: null }));
    const bad = await new StreamtapeProvider().checkAccount();
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(KEY);
  });
});
