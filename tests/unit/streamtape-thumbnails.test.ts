import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thumbnail matching against the Streamtape file manager.
 *
 * The matching rules are pure and are tested directly; the network layer is
 * stubbed so the import path can be exercised without Streamtape credentials.
 */

const streamtapeState = vi.hoisted(() => ({
  configured: true,
  folders: {} as Record<string, { folders: any[]; files: any[] }>,
  download: null as null | { bytes: Uint8Array; contentType: string; fileName: string },
  downloadError: null as Error | null,
}));

vi.mock("@/lib/video/streamtape", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { StreamtapeError } = actual as any;

  return {
    ...actual,
    streamtapeConfigured: () => streamtapeState.configured,
    listFolder: async (folderId?: string | null) =>
      streamtapeState.folders[folderId || ""] ?? { folders: [], files: [] },
    findFolder: async (name: string) => {
      const root = streamtapeState.folders[""] ?? { folders: [], files: [] };
      const hit = root.folders.find((folder) => folder.name.toLowerCase() === String(name).toLowerCase());
      return hit ? { id: hit.id, name: hit.name, path: hit.name, depth: 1 } : null;
    },
    downloadImage: async () => {
      if (streamtapeState.downloadError) throw streamtapeState.downloadError;
      if (!streamtapeState.download) throw new Error("no download configured");
      return streamtapeState.download;
    },
    StreamtapeError,
  };
});

import {
  importStreamtapeThumbnails,
  matchThumbnailFile,
  normalizeMatchKey,
  scanStreamtapeThumbnails,
  scoreNameMatch,
  tryStreamtapeThumbnailFor,
  videoMatchKeys,
  type ThumbnailTarget,
} from "@/lib/video/streamtape-thumbnails";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function file(name: string, linkid = `id-${name}`) {
  return { linkid, name, size: 1024 };
}

function target(overrides: Partial<ThumbnailTarget> = {}): ThumbnailTarget {
  return {
    id: "video-1",
    slug: "petite-desi-amateur",
    title: "Petite Desi Amateur Enjoys Intense Head",
    thumbnail_url: null,
    playable_url: null,
    ...overrides,
  };
}

/** Minimal stand-in for the service client the importer uses. */
function fakeService(videos: Record<string, any>[]) {
  const audit: any[] = [];
  const uploads: Array<{ path: string; contentType: string }> = [];
  const client: any = {
    storage: {
      listBuckets: async () => ({ data: [{ id: "video-thumbnails" }], error: null }),
      createBucket: async () => ({ data: null, error: null }),
      from: () => ({
        upload: async (path: string, _bytes: unknown, options: any) => {
          uploads.push({ path, contentType: options?.contentType });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/video-thumbnails/${path}` } }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
    from: (table: string) => {
      if (table !== "videos") return { insert: async () => ({ error: null }) };
      const filters: Record<string, unknown> = {};
      const builder: any = {
        update: (patch: Record<string, unknown>) => {
          builder.__patch = patch;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters[`is:${column}`] = value;
          return builder;
        },
        select: () => builder,
        maybeSingle: async () => {
          const row = videos.find((candidate) => candidate.id === filters.id);
          const guardedNoThumbnail = "is:thumbnail_url" in filters;
          if (!row || (guardedNoThumbnail && row.thumbnail_url)) return { data: null, error: null };
          Object.assign(row, builder.__patch);
          return { data: { id: row.id }, error: null };
        },
        insert: async () => ({ error: null }),
      };
      return builder;
    },
  };
  return { client, uploads, audit };
}

beforeEach(() => {
  streamtapeState.configured = true;
  streamtapeState.folders = {};
  streamtapeState.downloadError = null;
  streamtapeState.download = {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    fileName: "thumb.jpg",
  };
  process.env.STREAMTAPE_LOGIN = "login";
  process.env.STREAMTAPE_API_KEY = "key";
  delete process.env.STREAMTAPE_THUMBNAIL_FOLDER_ID;
  delete process.env.STREAMTAPE_THUMBNAIL_FOLDER_NAME;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STREAMTAPE_LOGIN;
  delete process.env.STREAMTAPE_API_KEY;
});

describe("normalizeMatchKey", () => {
  it.each([
    ["Petite_Desi.Amateur-1080p.jpg", "petite desi amateur 1080p"],
    ["01 - Evening In Velvet.mp4", "evening in velvet"],
    ["EVENING IN VELVET (1080p).mkv", "evening in velvet"],
    ["evening%20in%20velvet.webp", "evening in velvet"],
    ["", ""],
  ])("reduces %j to %j", (input, expected) => {
    expect(normalizeMatchKey(input)).toBe(expected);
  });
});

describe("scoreNameMatch", () => {
  it("matches identical names outright", () => {
    expect(scoreNameMatch("evening in velvet", "Evening In Velvet.mp4")).toBe(1);
  });

  it("matches a name that carries a suffix on top of the other", () => {
    expect(scoreNameMatch("evening in velvet", "evening in velvet part 2")).toBeGreaterThan(0.8);
  });

  it("matches despite separators, case, and a resolution suffix", () => {
    expect(scoreNameMatch("petite desi amateur", "Petite_Desi_Amateur_1080p.jpg")).toBeGreaterThanOrEqual(0.68);
  });

  it("does not match unrelated names", () => {
    expect(scoreNameMatch("evening in velvet", "office roleplay with the boss")).toBe(0);
    expect(scoreNameMatch("clip", "something else entirely")).toBe(0);
  });
});

describe("videoMatchKeys", () => {
  it("considers the title, the slug, and the source file name", () => {
    const keys = videoMatchKeys({
      ...target(),
      playable_url: "https://cdn.example.com/Evening_In_Velvet_4K.mp4",
    });
    expect(keys).toContain("evening in velvet 4k");
    expect(keys).toContain("petite desi amateur enjoys intense head");
    expect(keys).toContain("petite desi amateur");
  });

  it("ignores empty values and de-duplicates", () => {
    const keys = videoMatchKeys({ ...target(), playable_url: null, extraNames: [undefined as any, ""] });
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("matchThumbnailFile", () => {
  const files = [
    file("Evening In Velvet.jpg"),
    file("Petite_Desi_Amateur_1080p.png"),
    file("Office Roleplay.webp"),
  ];

  it("picks the image whose name matches the video title", () => {
    const match = matchThumbnailFile(files, target({ title: "Evening In Velvet", slug: "evening-in-velvet" }));
    expect(match?.file.name).toBe("Evening In Velvet.jpg");
    expect(match?.score).toBe(1);
  });

  it("picks the image whose name matches the source file", () => {
    const match = matchThumbnailFile(files, target({ playable_url: "https://cdn.example.com/petite-desi-amateur.mp4" }));
    expect(match?.file.name).toBe("Petite_Desi_Amateur_1080p.png");
  });

  it("returns null when nothing is convincing", () => {
    expect(matchThumbnailFile(files, target({ title: "Beach Volleyball Compilation", slug: "beach-volleyball" }))).toBeNull();
    expect(matchThumbnailFile([], target())).toBeNull();
  });
});

describe("importStreamtapeThumbnails", () => {
  function withFolder(files: any[]) {
    streamtapeState.folders = {
      "": { folders: [{ id: "f1", name: "thumbnails" }], files: [] },
      f1: { folders: [], files },
    };
  }

  it("copies the matched image into storage and writes the public URL", async () => {
    withFolder([file("Petite Desi Amateur.jpg", "link-1")]);
    const videos = [{ id: "video-1", thumbnail_url: null }];
    const { client, uploads } = fakeService(videos);

    const summary = await importStreamtapeThumbnails(client, USER_ID, [target()]);

    expect(summary.imported).toBe(1);
    expect(summary.folder?.path).toBe("thumbnails");
    expect(summary.results[0]).toMatchObject({ id: "video-1", status: "imported", matchedFile: "Petite Desi Amateur.jpg" });
    expect(videos[0].thumbnail_url).toBe(
      `https://cdn.example.com/video-thumbnails/${uploads[0].path}`
    );
    expect(uploads[0].contentType).toBe("image/jpeg");
  });

  it("leaves a video that already has a thumbnail alone", async () => {
    withFolder([file("Petite Desi Amateur.jpg", "link-1")]);
    const videos = [{ id: "video-1", thumbnail_url: "https://cdn.example.com/existing.jpg" }];
    const { client } = fakeService(videos);

    const summary = await importStreamtapeThumbnails(client, USER_ID, [target({ thumbnail_url: "https://cdn.example.com/existing.jpg" })]);

    expect(summary.imported).toBe(0);
    expect(summary.results[0]).toMatchObject({ status: "skipped" });
    expect(videos[0].thumbnail_url).toBe("https://cdn.example.com/existing.jpg");
  });

  it("reports a video it cannot match without failing the batch", async () => {
    withFolder([file("Something Else.jpg", "link-9")]);
    const { client } = fakeService([{ id: "video-1", thumbnail_url: null }]);

    const summary = await importStreamtapeThumbnails(client, USER_ID, [target()]);

    expect(summary.imported).toBe(0);
    expect(summary.results[0]).toMatchObject({ status: "unmatched" });
    expect(summary.results[0].error).toMatch(/No image/i);
  });

  it("reports a download failure per row and keeps going", async () => {
    withFolder([file("Petite Desi Amateur.jpg", "link-1")]);
    streamtapeState.downloadError = new Error("Streamtape did not return a download link for that file.");
    const { client } = fakeService([{ id: "video-1", thumbnail_url: null }]);

    const summary = await importStreamtapeThumbnails(client, USER_ID, [target()]);

    expect(summary.imported).toBe(0);
    expect(summary.results[0]).toMatchObject({ status: "failed" });
    expect(summary.results[0].error).toMatch(/download link/i);
  });

  it("never overwrites a thumbnail that arrived mid-import", async () => {
    withFolder([file("Petite Desi Amateur.jpg", "link-1")]);
    const existing = "https://cdn.example.com/existing.jpg";
    const videos = [{ id: "video-1", thumbnail_url: existing }];
    const { client } = fakeService(videos);

    const summary = await importStreamtapeThumbnails(client, USER_ID, [target()]);

    expect(summary.imported).toBe(0);
    expect(summary.results[0]).toMatchObject({ status: "skipped" });
    expect(videos[0].thumbnail_url).toBe(existing);
  });

  it("does nothing when there are no targets", async () => {
    const { client } = fakeService([]);
    const summary = await importStreamtapeThumbnails(client, USER_ID, []);
    expect(summary).toEqual({ folder: null, fileCount: 0, results: [], imported: 0 });
  });
});

describe("tryStreamtapeThumbnailFor", () => {
  beforeEach(() => {
    streamtapeState.folders = {
      "": { folders: [{ id: "f1", name: "thumbnails" }], files: [] },
      f1: { folders: [], files: [file("Petite Desi Amateur.jpg", "link-1")] },
    };
  });

  it("mirrors the matching image for a freshly published video", async () => {
    const { client, uploads } = fakeService([{ id: "video-1", thumbnail_url: null }]);
    const result = await tryStreamtapeThumbnailFor(client, USER_ID, target());

    expect(result?.matchedFile).toBe("Petite Desi Amateur.jpg");
    expect(result?.thumbnailUrl).toContain(uploads[0].path);
  });

  it("returns null and never throws when nothing matches", async () => {
    const { client } = fakeService([{ id: "video-1", thumbnail_url: null }]);
    expect(await tryStreamtapeThumbnailFor(client, USER_ID, target({ title: "Beach Volleyball", slug: "beach-volleyball" }))).toBeNull();
  });

  it("stays quiet when Streamtape is not configured", async () => {
    streamtapeState.configured = false;
    const { client, uploads } = fakeService([{ id: "video-1", thumbnail_url: null }]);
    expect(await tryStreamtapeThumbnailFor(client, USER_ID, target())).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("swallows a download failure so publishing still succeeds", async () => {
    streamtapeState.downloadError = new Error("Streamtape answered the thumbnail download with HTTP 502.");
    const { client } = fakeService([{ id: "video-1", thumbnail_url: null }]);
    expect(await tryStreamtapeThumbnailFor(client, USER_ID, target())).toBeNull();
  });
});

describe("scanStreamtapeThumbnails", () => {
  it("reports the folder, the image count, and the matches without writing", async () => {
    streamtapeState.folders = {
      "": { folders: [{ id: "f1", name: "thumbnails" }], files: [] },
      f1: { folders: [], files: [file("Petite Desi Amateur.jpg", "link-1")] },
    };
    const videos = [{ id: "video-1", thumbnail_url: null }];

    const summary = await scanStreamtapeThumbnails([target()]);

    expect(summary.configured).toBe(true);
    expect(summary.folder?.name).toBe("thumbnails");
    expect(summary.fileCount).toBe(1);
    expect(summary.matches[0]).toMatchObject({ id: "video-1", matchedFile: "Petite Desi Amateur.jpg" });
    expect(videos[0].thumbnail_url).toBeNull();
  });

  it("says so when the credentials are missing instead of throwing", async () => {
    streamtapeState.configured = false;
    const summary = await scanStreamtapeThumbnails([target()]);
    expect(summary.configured).toBe(false);
    expect(summary.error).toMatch(/STREAMTAPE_LOGIN/);
  });
});
