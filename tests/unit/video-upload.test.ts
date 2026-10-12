import { describe, it, expect } from "vitest";
import {
  assertOwnTransitPath,
  thumbnailExtension,
  transitPrefix,
  videoExtension,
} from "@/lib/video/storage";
import {
  MAX_ENTRIES_PER_REQUEST,
  normalizeEmbedEntries,
  normalizeRemoteEntries,
  splitEmbedEntries,
  splitUrlEntries,
} from "@/lib/video/entries";
import { ApiError, deleteJson, describeNonJsonResponse, getJson, postJson, readApiResponse } from "@/src/utils/api";
import { vi, afterEach } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function response(status: number, body: string, contentType = "text/plain"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("api response parsing", () => {
  it("turns Vercel's plain-text 413 into a human message instead of a JSON parse error", async () => {
    // This is the exact body that used to surface in the admin UI as
    // `Unexpected token 'R', "Request En"... is not valid JSON`.
    await expect(readApiResponse(response(413, "Request Entity Too Large"))).rejects.toThrow(/4\.5 MB/);

    let caught: ApiError | null = null;
    await readApiResponse(response(413, "Request Entity Too Large")).catch((error) => (caught = error));
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as unknown as ApiError).status).toBe(413);
  });

  it("keeps the server's own error message when the body is JSON", async () => {
    const res = response(400, JSON.stringify({ error: "Choose a category" }), "application/json");
    await expect(readApiResponse(res)).rejects.toThrow("Choose a category");
  });

  it("falls back to a status + snippet for other non-JSON bodies", async () => {
    const res = response(404, "<html>not found</html>", "text/html");
    await expect(readApiResponse(res)).rejects.toThrow("404: <html>not found</html>");
  });

  it("resolves with the decoded body on success", async () => {
    const res = response(200, JSON.stringify({ ok: true, storagePath: "a/b.mp4" }), "application/json");
    await expect(readApiResponse(res)).resolves.toEqual({ ok: true, storagePath: "a/b.mp4" });
  });

  it("describes gateway failures without leaking raw markup", () => {
    expect(describeNonJsonResponse(response(504, "gateway"), "")).toMatch(/timed out/i);
    expect(describeNonJsonResponse(response(500, ""), "")).toMatch(/500/);
  });
});

describe("api helpers for the UFOLOAD flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the machine-readable code, retry hint and Retry-After of a server error", async () => {
    const body = JSON.stringify({ error: "UFOLOAD runs at most 10 URL imports at a time.", code: "import_slots_full", retryable: true, retryAfterSeconds: 30, details: "x" });
    const error = (await readApiResponse(response(429, body, "application/json")).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "import_slots_full", retryable: true, retryAfterSeconds: 30, details: "x" });
    expect(error.message).toBe("UFOLOAD runs at most 10 URL imports at a time.");
  });

  it("leaves the extras undefined when the server sends none", async () => {
    const error = (await readApiResponse(response(400, JSON.stringify({ error: "Choose a category" }), "application/json")).catch((e) => e)) as ApiError;
    expect(error.code).toBeUndefined();
    expect(error.retryable).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("marks a request that never reached the server as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    for (const call of [() => postJson("/x", {}), () => getJson("/x"), () => deleteJson("/x")]) {
      const error = (await call().catch((e) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 0, retryable: true });
    }
  });

  it("GETs and DELETEs with the right method, uncached", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        return response(200, JSON.stringify({ ok: true }), "application/json");
      })
    );
    expect(await getJson("/a?b=1")).toEqual({ ok: true });
    expect(await deleteJson("/c")).toEqual({ ok: true });
    expect(calls.map((call) => [call.init.method, call.url, call.init.cache])).toEqual([
      ["GET", "/a?b=1", "no-store"],
      ["DELETE", "/c", "no-store"],
    ]);
  });
});

describe("transit object paths", () => {
  it("accepts an object inside the admin's own prefix", () => {
    const path = `${transitPrefix(USER_ID)}/abc-123.mp4`;
    expect(assertOwnTransitPath(USER_ID, path)).toBe(path);
  });

  it("rejects another admin's prefix", () => {
    expect(() => assertOwnTransitPath(USER_ID, `${transitPrefix("someone-else")}/abc.mp4`)).toThrow();
  });

  it("rejects traversal and nested paths", () => {
    expect(() => assertOwnTransitPath(USER_ID, `${transitPrefix(USER_ID)}/../other/x.mp4`)).toThrow();
    expect(() => assertOwnTransitPath(USER_ID, `${transitPrefix(USER_ID)}/nested/deep.mp4`)).toThrow();
    expect(() => assertOwnTransitPath(USER_ID, "")).toThrow();
    expect(() => assertOwnTransitPath(USER_ID, "video-thumbnails/other/x.jpg")).toThrow();
  });

  it("keeps a provider-recognisable video extension", () => {
    expect(videoExtension("clip.MOV", "video/quicktime")).toBe("mov");
    expect(videoExtension("no-extension", "video/webm")).toBe("webm");
    expect(videoExtension("weird.exotic", "nonsense")).toBe("mp4");
  });

  it("normalises thumbnail extensions", () => {
    expect(thumbnailExtension("cover.jpeg", "image/jpeg")).toBe("jpg");
    expect(thumbnailExtension("cover.WEBP", "image/webp")).toBe("webp");
    expect(thumbnailExtension("cover", "image/png")).toBe("png");
  });
});

describe("publish entry parsing", () => {
  it("splits pasted iframe markup into one entry per iframe", () => {
    const pasted =
      '<iframe src="https://a.example/1" allowfullscreen></iframe>\n<iframe src="https://a.example/2"></iframe>';
    expect(splitEmbedEntries(pasted)).toHaveLength(2);
    expect(splitEmbedEntries(pasted)[0]).toContain("https://a.example/1");
  });

  it("splits plain iframe URLs by line", () => {
    expect(splitEmbedEntries("https://a.example/1\n\nhttps://a.example/2\n")).toEqual([
      "https://a.example/1",
      "https://a.example/2",
    ]);
  });

  it("splits remote URLs by line or comma and de-duplicates", () => {
    expect(splitUrlEntries("https://a/1.mp4, https://a/2.mp4\nhttps://a/1.mp4")).toEqual([
      "https://a/1.mp4",
      "https://a/2.mp4",
    ]);
  });

  it("carries a thumbnail per embed entry", () => {
    const entries = normalizeEmbedEntries({
      categoryId: "cat",
      entries: [
        { source: "https://a.example/1", thumbnailPath: `${USER_ID}/one.jpg` },
        { source: "https://a.example/2" },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].thumbnailPath).toBe(`${USER_ID}/one.jpg`);
    expect(entries[1].thumbnailPath).toBeNull();
  });

  it("still accepts the legacy single embed field", () => {
    expect(normalizeEmbedEntries({ embed: "https://a.example/1" })).toEqual([
      { source: "https://a.example/1", thumbnailPath: null },
    ]);
  });

  it("carries a thumbnail per remote URL entry", () => {
    const entries = normalizeRemoteEntries({
      entries: [
        { url: "https://cdn/1.mp4", thumbnailPath: `${USER_ID}/one.jpg` },
        { url: "https://cdn/2.mp4", thumbnailPath: `${USER_ID}/two.jpg` },
      ],
    });
    expect(entries.map((entry) => entry.thumbnailPath)).toEqual([`${USER_ID}/one.jpg`, `${USER_ID}/two.jpg`]);
  });

  it("caps the number of entries per request", () => {
    const entries = normalizeRemoteEntries({ entries: Array.from({ length: 40 }, (_, i) => ({ url: `https://cdn/${i}.mp4` })) });
    expect(entries).toHaveLength(MAX_ENTRIES_PER_REQUEST);
  });
});
