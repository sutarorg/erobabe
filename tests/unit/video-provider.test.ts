import { describe, it, expect, vi, beforeEach } from "vitest";
import { getVideoProvider, UqloadProvider, InternalProvider } from "@/lib/video/provider";

describe("video provider", () => {
  it("uqload provider is disabled without approval", () => {
    process.env.UQLOAD_API_KEY = "";
    process.env.UQLOAD_ADULT_CONTENT_APPROVED = "false";
    const provider = new UqloadProvider();
    expect(provider.isEnabled()).toBe(false);
  });

  it("internal provider is always enabled", () => {
    const provider = new InternalProvider();
    expect(provider.isEnabled()).toBe(true);
  });

  it("getVideoProvider returns correct provider", () => {
    const provider = getVideoProvider("internal");
    expect(provider.name).toBe("internal");
  });
});

describe("UqloadProvider.findRecentUpload", () => {
  beforeEach(() => {
    process.env.UQLOAD_API_KEY = "test-key";
    process.env.UQLOAD_ADULT_CONTENT_APPROVED = "true";
  });

  function stubFileList(files: any[]) {
    const fetchMock = vi.fn(async (url: any) => {
      const requestUrl = String(url);
      // Confirms against the documented file/list endpoint, windowed to recent uploads.
      expect(requestUrl).toContain("file/list");
      expect(requestUrl).toContain("created=5");
      expect(requestUrl).toContain("key=test-key");
      return new Response(
        JSON.stringify({ status: 200, msg: "OK", server_time: "2026-10-11 09:59:00", result: { files, results_total: files.length, pages: 1, results: files.length } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("matches a just-uploaded file by the title sent with the upload (case-insensitive)", async () => {
    stubFileList([
      { file_code: "aaa111", title: "Old video", uploaded: "2026-10-11 09:00:00" },
      { file_code: "bbb222", title: "My Trip", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload({ title: "my trip", fileName: "my trip.mp4" });

    expect(found).toEqual({ fileCode: "bbb222", uploaded: "2026-10-11 09:58:00", matchedBy: "title" });
    vi.unstubAllGlobals();
  });

  it("matches by the file name when the provider rewrote the title", async () => {
    stubFileList([{ file_code: "ccc333", title: "my trip.mp4", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload({ title: "my trip", fileName: "my trip.mp4" });

    // Title lookup missed (provider kept the extension), file name matched.
    expect(found).toEqual({ fileCode: "ccc333", uploaded: "2026-10-11 09:58:00", matchedBy: "title" });
    vi.unstubAllGlobals();
  });

  it("matches Uqload's duplicate-title suffix (e.g. 'My Trip_1_')", async () => {
    // Uploading the same title twice, Uqload stores the second as 'Title_1_'.
    stubFileList([
      { file_code: "first111", title: "My Trip", uploaded: "2026-10-09 18:57:04" },
      { file_code: "second22", title: "My Trip_1_", uploaded: "2026-10-09 19:05:10" },
    ]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload({ title: "My Trip", fileName: "my trip.mp4" });

    // Both match; the most recent upload is the one we just sent.
    expect(found).toEqual({ fileCode: "second22", uploaded: "2026-10-09 19:05:10", matchedBy: "title" });
    vi.unstubAllGlobals();
  });

  it("does not match a longer title that merely shares the expected prefix", async () => {
    stubFileList([{ file_code: "zzz999", title: "444", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    // '444' must not match expected '44' (no separator after the prefix).
    expect(await provider.findRecentUpload({ title: "44", fileName: "44.mp4" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("falls back to the only recent file when nothing matches the title", async () => {
    stubFileList([{ file_code: "ddd444", title: "renamed by someone", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload({ title: "", fileName: "" });

    expect(found).toEqual({ fileCode: "ddd444", uploaded: "2026-10-11 09:58:00", matchedBy: "recent" });
    vi.unstubAllGlobals();
  });

  it("returns null when the recent window is empty", async () => {
    stubFileList([]);

    const provider = new UqloadProvider();
    expect(await provider.findRecentUpload({ title: "my trip", fileName: "my trip.mp4" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns null when several recent files make the match ambiguous", async () => {
    stubFileList([
      { file_code: "eee555", title: "Video one", uploaded: "2026-10-11 09:57:00" },
      { file_code: "fff666", title: "Video two", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    // Never guess: better for the client to retry/fail than to attribute the wrong file.
    expect(await provider.findRecentUpload({ title: "video three", fileName: "video three.mp4" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("ignores entries without a usable file code", async () => {
    stubFileList([{ title: "No code" }]);

    const provider = new UqloadProvider();
    expect(await provider.findRecentUpload({ title: "no code", fileName: "" })).toBeNull();
    vi.unstubAllGlobals();
  });
});
