import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFileList(files: any[]) {
    const fetchMock = vi.fn(async (url: any) => {
      const requestUrl = String(url);
      // One stable listing query per poll: the upload is identified by the
      // *diff* against the pre-upload snapshot, so neither a time window nor
      // the (literal, stored-title) `title` filter may narrow the listing.
      expect(requestUrl).toContain("file/list");
      expect(requestUrl).toContain("key=test-key");
      expect(requestUrl).toContain("per_page=50");
      expect(requestUrl).not.toContain("created=");
      expect(requestUrl).not.toContain("title=");
      return new Response(
        JSON.stringify({
          status: 200,
          msg: "OK",
          server_time: "2026-10-11 09:59:00",
          result: { files, results_total: files.length, pages: 1, results: files.length },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("matches a just-uploaded file by the title sent with the upload (folding case and underscores)", async () => {
    stubFileList([
      { file_code: "old000", title: "Old video", uploaded: "2026-10-11 09:00:00" },
      // Uqload derives the stored title from the file name: spaces → underscores.
      { file_code: "bbb222", title: "My_Trip", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload(
      { title: "my trip", fileName: "my trip.mp4" },
      { knownFileCodes: ["old000"] }
    );

    expect(found).toEqual({ fileCode: "bbb222", uploaded: "2026-10-11 09:58:00", matchedBy: "title" });
  });

  it("matches by the file name when Uqload kept the extension in the stored title", async () => {
    stubFileList([{ file_code: "ccc333", title: "my trip.mp4", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload(
      { title: "my trip", fileName: "my trip.mp4" },
      { knownFileCodes: [] }
    );

    // Title lookup missed (provider kept the extension), the file name matched.
    expect(found).toEqual({ fileCode: "ccc333", uploaded: "2026-10-11 09:58:00", matchedBy: "title" });
  });

  it("prefers the newest file when Uqload stored a duplicate-title suffix (Title_1_)", async () => {
    // Uploading the same title twice: Uqload stores the second as 'Title_1_'.
    stubFileList([
      { file_code: "first111", title: "My Trip", uploaded: "2026-10-09 18:57:04" },
      { file_code: "second22", title: "My Trip_1_", uploaded: "2026-10-09 19:05:10" },
    ]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload(
      { title: "My Trip", fileName: "my trip.mp4" },
      { knownFileCodes: [] }
    );

    // Both fold to 'my trip'; the most recent upload is the one we just sent.
    expect(found).toEqual({ fileCode: "second22", uploaded: "2026-10-09 19:05:10", matchedBy: "title" });
  });

  it("accepts the only new file even when its stored title does not match", async () => {
    stubFileList([
      { file_code: "old000", title: "Older file", uploaded: "2026-10-11 09:00:00" },
      { file_code: "ddd444", title: "444", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    // '444' does not fold to expected '44', but it is the only code that
    // appeared after the snapshot — that is the upload.
    const found = await provider.findRecentUpload(
      { title: "44", fileName: "44.mp4" },
      { knownFileCodes: ["old000"] }
    );

    expect(found).toEqual({ fileCode: "ddd444", uploaded: "2026-10-11 09:58:00", matchedBy: "only-new" });
  });

  it("returns null when the listing is empty", async () => {
    stubFileList([]);

    const provider = new UqloadProvider();
    expect(await provider.findRecentUpload({ title: "my trip", fileName: "my trip.mp4" })).toBeNull();
  });

  it("never guesses between several new files before the deadline", async () => {
    stubFileList([
      { file_code: "eee555", title: "Video one", uploaded: "2026-10-11 09:57:00" },
      { file_code: "fff666", title: "Video two", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    // Better for the client to keep polling than to attribute the wrong file.
    expect(
      await provider.findRecentUpload({ title: "video three", fileName: "video three.mp4" }, { knownFileCodes: [] })
    ).toBeNull();
  });

  it("falls back to the newest new file on the final attempt when the snapshot was readable", async () => {
    stubFileList([
      { file_code: "eee555", title: "Video one", uploaded: "2026-10-11 09:57:00" },
      { file_code: "fff666", title: "Video two", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload(
      { title: "video three", fileName: "video three.mp4" },
      { knownFileCodes: [], finalAttempt: true }
    );

    expect(found).toEqual({ fileCode: "fff666", uploaded: "2026-10-11 09:58:00", matchedBy: "newest-new" });
  });

  it("never guesses on the final attempt when the snapshot was unreadable", async () => {
    stubFileList([
      { file_code: "eee555", title: "Video one", uploaded: "2026-10-11 09:57:00" },
      { file_code: "fff666", title: "Video two", uploaded: "2026-10-11 09:58:00" },
    ]);

    const provider = new UqloadProvider();
    // `null` = the snapshot request failed — without a baseline, "newest" is
    // not necessarily ours.
    expect(
      await provider.findRecentUpload(
        { title: "video three", fileName: "video three.mp4" },
        { knownFileCodes: null, finalAttempt: true }
      )
    ).toBeNull();
  });

  it("ignores entries without a usable file code", async () => {
    stubFileList([{ title: "No code" }, { file_code: "good111", title: "anything", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    const found = await provider.findRecentUpload({ title: "no code", fileName: "" }, { knownFileCodes: [] });

    expect(found).toEqual({ fileCode: "good111", uploaded: "2026-10-11 09:58:00", matchedBy: "only-new" });
  });

  it("ignores files that were already in the pre-upload snapshot", async () => {
    stubFileList([{ file_code: "aaa111", title: "My Trip", uploaded: "2026-10-11 09:58:00" }]);

    const provider = new UqloadProvider();
    expect(
      await provider.findRecentUpload({ title: "my trip", fileName: "my trip.mp4" }, { knownFileCodes: ["aaa111"] })
    ).toBeNull();
  });
});

describe("UqloadProvider.getUploadServer", () => {
  beforeEach(() => {
    process.env.UQLOAD_API_KEY = "test-key";
    process.env.UQLOAD_ADULT_CONTENT_APPROVED = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubUploadServer(result: unknown, status: unknown = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status, msg: "OK", result }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );
  }

  it("takes the first URL when Uqload answers with a comma-separated mirror list", async () => {
    stubUploadServer("https://e1.uqload.example/upload/01, https://e2.uqload.example/upload/02");

    const provider = new UqloadProvider();
    expect(await provider.getUploadServer()).toBe("https://e1.uqload.example/upload/01");
  });

  it("takes the first URL when Uqload answers with a JSON array", async () => {
    stubUploadServer(["https://e3.uqload.example/upload/03", "https://e4.uqload.example/upload/04"]);

    const provider = new UqloadProvider();
    expect(await provider.getUploadServer()).toBe("https://e3.uqload.example/upload/03");
  });

  it("throws when no usable server URL is present", async () => {
    stubUploadServer("");

    const provider = new UqloadProvider();
    await expect(provider.getUploadServer()).rejects.toThrow(/upload server/i);
  });
});

describe("UqloadProvider.uploadFile", () => {
  beforeEach(() => {
    process.env.UQLOAD_API_KEY = "test-key";
    process.env.UQLOAD_ADULT_CONTENT_APPROVED = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends every scalar before the file part, with the snapshot last", async () => {
    let captured: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init: any) => {
        captured = init.body as FormData;
        return new Response(
          JSON.stringify({ status: 200, msg: "OK", files: [{ filecode: "abc123", filename: "my trip.mp4" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const provider = new UqloadProvider();
    const result = await provider.uploadFile(
      "https://e1.uqload.example/upload/01",
      new Blob([new Uint8Array(4)], { type: "video/mp4" }),
      {
        fileName: "my trip.mp4",
        fileSize: 4,
        title: "My Trip",
        tags: "tag-a",
        snapshot: new Blob([new Uint8Array(2)], { type: "image/jpeg" }),
        snapshotFileName: "thumb.jpg",
      }
    );

    expect(result.providerFileId).toBe("abc123");
    const names = [...(captured as unknown as FormData).keys()];
    // ⚠️ Regression guard: Uqload ignores multipart fields that arrive after
    // the `file` part, so every scalar must come first.
    expect(names.indexOf("file_title")).toBeLessThan(names.indexOf("file"));
    expect(names.indexOf("key")).toBeLessThan(names.indexOf("file"));
    expect(names[names.length - 1]).toBe("snapshot");
  });
});
