import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UfoloadProvider, requireUfoloadProvider, ufoloadApprovalFlag } from "@/lib/video/ufoload";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import { rejected } from "./helpers/provider-errors";

/**
 * Contract tests for the server-side UFOLOAD transport.
 *
 * These assert the exact request shape the provider documents (paths, JSON
 * fields, Bearer key) and the safety rules this codebase promised: the API key
 * never leaves the server, uploads fail closed until the approval flag is set,
 * and a signed/expiring playback address is never used as a permanent one.
 *
 * `fetch` is stubbed, so nothing here touches the real service — that is what
 * `tests/live/ufoload.live.test.ts` is for.
 */

const API_KEY = "ufo_test_0123456789abcdef";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function stubFetch(response: Response | (() => Response | Promise<Response>)) {
  const spy = vi.fn(async (..._args: unknown[]) =>
    typeof response === "function" ? await response() : response.clone()
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function calls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.map((call) => {
    const [url, init] = call as unknown as [URL, RequestInit];
    return { url: String(url), init };
  });
}

const previousEnv = { ...process.env };

beforeEach(() => {
  process.env.UFOLOAD_API_KEY = API_KEY;
  process.env.UFOLOAD_ADULT_CONTENT_APPROVED = "true";
});

afterEach(() => {
  process.env = { ...previousEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FILE = {
  id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE",
  name: "clip.mp4",
  size: 1048576,
  mime_type: "video/mp4",
  status: "ready",
  progress: 100,
  duration_ms: 60000,
  poster: "https://ufoload.com/i/pp/abc.jpg",
  views: 12,
};

describe("configuration gate", () => {
  it("is disabled without the API key and explains what to set", () => {
    delete process.env.UFOLOAD_API_KEY;
    const provider = new UfoloadProvider();
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/UFOLOAD_API_KEY/);

    const error = (() => {
      try {
        provider.assertEnabled();
        return null;
      } catch (thrown) {
        return thrown as UfoloadError;
      }
    })();
    expect(error?.code).toBe("missing_api_key");
    expect(() => requireUfoloadProvider()).toThrow(/UFOLOAD_API_KEY/);
  });

  it("stays disabled until the written approval is recorded", () => {
    process.env.UFOLOAD_ADULT_CONTENT_APPROVED = "false";
    expect(ufoloadApprovalFlag()).toBe(false);

    const provider = new UfoloadProvider();
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/UFOLOAD_ADULT_CONTENT_APPROVED/);

    const error = (() => {
      try {
        provider.assertEnabled();
        return null;
      } catch (thrown) {
        return thrown as UfoloadError;
      }
    })();
    expect(error?.code).toBe("provider_not_approved");
    // Fail closed: no request may be attempted while unapproved.
    const spy = stubFetch(jsonResponse({}, 200));
    expect(provider.isEnabled()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is enabled only when both the key and the approval flag are present", () => {
    expect(new UfoloadProvider().isEnabled()).toBe(true);
    expect(new UfoloadProvider().disabledReason()).toBeNull();
  });
});

describe("authenticated requests", () => {
  it("sends the key as a Bearer token and never as a query parameter", async () => {
    const spy = stubFetch(jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }));
    await new UfoloadProvider().listFiles({ status: "processing", limit: 5, offset: 10 });

    const [call] = calls(spy);
    expect(call.url).toContain("/api/v1/files?");
    expect(call.url).toContain("status=processing");
    expect(call.url).toContain("limit=5");
    expect(call.url).toContain("offset=10");
    expect(call.url).not.toContain(API_KEY);
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("redacts the key even when the provider echoes it back in an error", async () => {
    stubFetch(
      jsonResponse({ error: { code: "server_error", message: `internal failure for Bearer ${API_KEY}` } }, 500)
    );

    const error = await rejected(new UfoloadProvider().listFiles());

    expect(error).toBeInstanceOf(UfoloadError);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain("[redacted]");
    expect(error.message).toContain("internal failure");
  });

  it("turns a stalled request into an actionable timeout instead of hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      })
    );

    const error = await rejected(new UfoloadProvider().listFiles());
    expect(error.code).toBe("timeout");
    expect(error.message).toMatch(/did not answer within/i);
  });

  it("explains a missing configuration before any network call", async () => {
    delete process.env.UFOLOAD_API_KEY;
    const spy = stubFetch(jsonResponse({}));
    await expect(new UfoloadProvider().initDirectUpload({ fileName: "a.mp4", fileSize: 10 })).rejects.toThrow(
      /UFOLOAD_API_KEY/
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("direct upload handshake", () => {
  const grant = {
    upload_id: "upl_1",
    url: "https://upload.ufoload.com/17/_node/v1/ingest/upl_1",
    grant: "abc12345",
    authorization: "UfoGrant abc12345",
    chunk_size: 8388608,
    max_bytes: 2147483648,
    expires_at: "2026-10-12T14:00:00Z",
  };

  it("initializes with the documented body and returns an upload-scoped grant", async () => {
    const spy = stubFetch(jsonResponse(grant, 201));
    const result = await new UfoloadProvider().initDirectUpload({
      fileName: "my clip.mp4",
      fileSize: 12345,
      mimeType: "video/mp4",
    });

    const [call] = calls(spy);
    expect(call.url).toBe("https://ufoload.com/api/v1/files/uploads");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({
      filename: "my clip.mp4",
      size: 12345,
      mime_type: "video/mp4",
    });
    expect(result.uploadId).toBe("upl_1");
    expect(result.authorization).toBe("UfoGrant abc12345");
    // The response the browser will receive carries no API key.
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("omits the mime type instead of sending an empty one", async () => {
    const spy = stubFetch(jsonResponse(grant, 201));
    await new UfoloadProvider().initDirectUpload({ fileName: "a.mp4", fileSize: 1 });
    expect(JSON.parse(String(calls(spy)[0].init.body))).toEqual({ filename: "a.mp4", size: 1 });
  });

  it("retries a 409 upload_busy, then succeeds", async () => {
    let attempt = 0;
    const spy = stubFetch(() => {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: { code: "upload_busy", message: "finalizing" } }, 409);
      return jsonResponse({ file: FILE, duplicate: false }, 200);
    });

    const file = await new UfoloadProvider().completeDirectUpload("upl_1", { size: 1048576, delayMs: 1 });
    expect(file.status).toBe("ready");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(calls(spy)[1].url).toBe("https://ufoload.com/api/v1/files/uploads/upl_1/complete");
  });

  it("gives up on a persistent upload_busy instead of retrying forever", async () => {
    const spy = stubFetch(jsonResponse({ error: { code: "upload_busy", message: "finalizing" } }, 409));
    const error = await rejected(new UfoloadProvider().completeDirectUpload("upl_1", { attempts: 2, delayMs: 1 }));
    expect(error.code).toBe("upload_busy");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reads the upload state used for the keep-alive ping", async () => {
    const spy = stubFetch(jsonResponse({ state: "completed", file_id: FILE.id }));
    const state = await new UfoloadProvider().getUploadState("upl_1");
    expect(state.state).toBe("completed");
    expect(state.fileId).toBe(FILE.id);
    expect(calls(spy)[0].url).toBe("https://ufoload.com/api/v1/files/uploads/upl_1");
  });

  it("treats an already-gone upload as cancelled, not as a failure", async () => {
    const spy = stubFetch(() => jsonResponse({ error: { code: "not_found" } }, 404));
    expect(await new UfoloadProvider().cancelDirectUpload("upl_1")).toBe(false);
    expect(spy.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });
});

describe("file state mapping", () => {
  it("only reports canPlay once the provider says ready", async () => {
    stubFetch(jsonResponse({ file: { ...FILE, status: "processing", progress: 41 } }));
    const info = await new UfoloadProvider().getFileInfo(FILE.id);
    expect(info.canPlay).toBe(false);
    expect(info.status).toBe(202);
    expect(info.progress).toBe(41);
  });

  it("maps a ready file to a playable 200", async () => {
    stubFetch(jsonResponse({ file: FILE }));
    const info = await new UfoloadProvider().getFileInfo(FILE.id);
    expect(info.canPlay).toBe(true);
    expect(info.status).toBe(200);
    expect(info.durationSeconds).toBe(60);
    expect(info.thumbnailUrl).toBe(FILE.poster);
  });

  it("maps a failed file to an error the admin can act on", async () => {
    stubFetch(jsonResponse({ file: { ...FILE, status: "failed", error: "unsupported codec" } }));
    const info = await new UfoloadProvider().getFileInfo("x");
    expect(info.status).toBe(500);
    expect(info.canPlay).toBe(false);
    expect(info.errorMessage).toBe("unsupported codec");
  });

  it("builds stable addresses and never returns a signed link as permanent", () => {
    const provider = new UfoloadProvider();
    expect(provider.getEmbedUrl("aBcD1234xyz")).toBe("https://ufoload.com/e/aBcD1234xyz");
    expect(provider.getPlayableUrl("aBcD1234xyz")).toBe("https://ufoload.com/v/aBcD1234xyz");
    expect(provider.getEmbedUrl("aBcD1234xyz")).not.toContain("sig=");
  });
});

describe("URL imports", () => {
  const task = {
    id: "imp_1",
    url: "https://example.com/a.mp4",
    name: "a.mp4",
    status: "queued",
    progress: 0,
    created_at: "2026-10-12T12:00:00Z",
  };

  it("posts the documented import body and returns the task, not a file id", async () => {
    const spy = stubFetch(jsonResponse({ import: task }, 202));
    const result = await new UfoloadProvider().createImport({ url: task.url });
    expect(result.id).toBe("imp_1");
    expect(result.fileId).toBeNull();
    expect(calls(spy)[0].url).toBe("https://ufoload.com/api/v1/files/import");
    expect(JSON.parse(String(calls(spy)[0].init.body))).toEqual({ url: task.url });
  });

  it("matches a task by its real id, not by list position", async () => {
    stubFetch(
      jsonResponse({
        items: [
          { ...task, id: "imp_other" },
          { ...task, id: "imp_1", status: "done", file_id: FILE.id },
        ],
      })
    );
    const found = await new UfoloadProvider().findImport("imp_1");
    expect(found?.status).toBe("done");
    expect(found?.fileId).toBe(FILE.id);

    stubFetch(jsonResponse({ items: [{ ...task, id: "imp_other" }] }));
    expect(await new UfoloadProvider().findImport("imp_missing")).toBeNull();
  });

  it("surfaces the documented concurrency refusal with the limit in the message", async () => {
    stubFetch(jsonResponse({ error: { code: "too_many_active", message: "limit reached" } }, 429));
    const error = await rejected(new UfoloadProvider().createImport({ url: task.url }));
    expect(error.message).toMatch(/maximum number of active imports/i);
  });

  it("treats a missing import as already gone when cancelling", async () => {
    stubFetch(jsonResponse({ error: { code: "not_found" } }, 404));
    expect(await new UfoloadProvider().cancelImport("imp_1")).toBe(false);
  });
});

describe("cosmetic provider operations never break a publish", () => {
  it("returns false instead of throwing when a rename is rejected", async () => {
    stubFetch(jsonResponse({ error: { code: "server_error", message: "boom" } }, 500));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await new UfoloadProvider().renameFile("x", "New title")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("does not call the provider for an empty rename", async () => {
    const spy = stubFetch(jsonResponse({ file: FILE }));
    expect(await new UfoloadProvider().renameFile("x", "   ")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the trimmed title when renaming", async () => {
    const spy = stubFetch(jsonResponse({ file: { ...FILE, name: "New title" } }));
    expect(await new UfoloadProvider().renameFile("x", "  New   title  ")).toBe(true);
    expect(JSON.parse(String(calls(spy)[0].init.body))).toEqual({ name: "New title" });
  });
});
