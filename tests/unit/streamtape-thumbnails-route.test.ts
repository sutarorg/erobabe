import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonRequest } from "./helpers/video-route-harness";

/**
 * `/api/admin/videos/streamtape-thumbnails` — the admin-only bridge.
 *
 * The Streamtape client is stubbed, so the tests assert the route's own
 * contract: admin-only, request validation, and the per-row outcome mapping.
 */

const state = vi.hoisted(() => ({ service: null as any, auth: null as any }));
const streamtape = vi.hoisted(() => ({
  configured: true,
  folder: { id: "f1", name: "thumbnails", path: "home/thumbnails", depth: 2 } as any,
  files: [] as Array<{ linkid: string; name: string }>,
  downloadError: null as Error | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
}));

vi.mock("@/lib/video/streamtape", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    streamtapeConfigured: () => streamtape.configured,
    listFolder: async (folderId?: string | null) =>
      folderId ? { folders: [], files: streamtape.files } : { folders: [], files: [] },
    findFolder: async () => streamtape.folder,
    downloadImage: async () => {
      if (streamtape.downloadError) throw streamtape.downloadError;
      return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", fileName: "thumb.jpg" };
    },
  };
});

import { GET, POST } from "@/app/api/admin/videos/streamtape-thumbnails/route";

const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ID = "33333333-3333-4333-8333-333333333333";

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    slug: "petite-desi-amateur",
    title: "Petite Desi Amateur Enjoys Intense Head",
    thumbnail_url: null,
    playable_url: null,
    source_key: null,
    ...overrides,
  };
}

function setup(videos: Record<string, unknown>[] = [video()]) {
  const harness = createHarness({ videos });
  state.service = harness.service as any;
  state.auth = harness.auth as any;
  state.service.storage.listBuckets = async () => ({ data: [{ id: "video-thumbnails" }], error: null });
  state.service.storage.createBucket = async () => ({ data: null, error: null });
  state.service.storage.from = () => ({
    upload: async () => ({ data: { path: "x" }, error: null }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/video-thumbnails/${path}` } }),
    remove: async () => ({ data: [], error: null }),
  });
  return harness;
}

beforeEach(() => {
  streamtape.configured = true;
  streamtape.folder = { id: "f1", name: "thumbnails", path: "home/thumbnails", depth: 2 };
  streamtape.files = [{ linkid: "link-1", name: "Petite Desi Amateur Enjoys Intense Head.jpg" }];
  streamtape.downloadError = null;
  process.env.STREAMTAPE_LOGIN = "login";
  process.env.STREAMTAPE_API_KEY = "key";
  setup();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STREAMTAPE_LOGIN;
  delete process.env.STREAMTAPE_API_KEY;
});

describe("POST /api/admin/videos/streamtape-thumbnails", () => {
  it("requires an authenticated admin", async () => {
    state.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids: [VIDEO_ID] }))).status).toBe(401);
  });

  it("forbids non-admin users", async () => {
    const harness = setup();
    harness.db.profiles[0].role = "advertiser";
    expect((await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids: [VIDEO_ID] }))).status).toBe(403);
  });

  it.each([[], ["not-a-uuid"]].map((ids) => [ids]))("rejects an invalid selection: %j", async (ids) => {
    expect((await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids }))).status).toBe(400);
  });

  it("attaches the matching image and reports it", async () => {
    const harness = setup();
    const response = await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids: [VIDEO_ID] }));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.imported).toBe(1);
    expect(payload.results[0]).toMatchObject({ id: VIDEO_ID, status: "imported" });
    expect(payload.folderName).toBeTruthy();
    expect(harness.db.videos[0].thumbnail_url).toMatch(/^https:\/\/cdn\.example\.com\/video-thumbnails\//);
    expect(harness.db.audit_logs[0].action).toBe("video_thumbnail_imported");
  });

  it("reports an unmatched video without failing the request", async () => {
    streamtape.files = [{ linkid: "link-9", name: "Totally Unrelated Scene.jpg" }];
    const harness = setup();
    const response = await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids: [VIDEO_ID] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.imported).toBe(0);
    expect(payload.unmatched).toBe(1);
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
  });

  it("imports for every video missing a thumbnail when no ids are sent", async () => {
    const harness = setup([
      video(),
      video({ id: SECOND_ID, slug: "petite-desi-amateur-2", title: "Petite Desi Amateur Enjoys Intense Head 2", thumbnail_url: "https://cdn.example.com/has.jpg" }),
    ]);
    const response = await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", {}));
    const payload = await response.json();

    expect(payload.results).toHaveLength(1);
    expect(payload.imported).toBe(1);
    expect(harness.db.videos[1].thumbnail_url).toBe("https://cdn.example.com/has.jpg");
  });

  it("answers with an actionable message when Streamtape is not configured", async () => {
    streamtape.configured = false;
    const response = await POST(jsonRequest("/api/admin/videos/streamtape-thumbnails", { ids: [VIDEO_ID] }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/STREAMTAPE_LOGIN/);
  });
});

describe("GET /api/admin/videos/streamtape-thumbnails (dry run)", () => {
  it("reports the folder and the matches without writing anything", async () => {
    const harness = setup();
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.folder.path).toBe("home/thumbnails");
    expect(payload.fileCount).toBe(1);
    expect(payload.matches[0]).toMatchObject({
      id: VIDEO_ID,
      matchedFile: "Petite Desi Amateur Enjoys Intense Head.jpg",
    });
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
    expect(harness.db.audit_logs).toHaveLength(0);
  });

  it("requires an authenticated admin", async () => {
    state.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await GET()).status).toBe(401);
  });
});
