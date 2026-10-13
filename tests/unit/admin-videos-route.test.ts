import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID, CATEGORY_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for /api/admin/videos — thumbnail changes and deletion from the admin
 * videos page. The Supabase client is an in-memory fake, so assertions cover
 * the rows that actually change and the storage cleanup that follows.
 */

const harnessState = vi.hoisted(() => ({ service: null as any, auth: null as any, removed: [] as string[] }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => harnessState.auth,
    createServiceClient: () => harnessState.service,
    isValidSupabaseUrl: () => true,
    isValidSupabaseKey: () => true,
    isSupabaseConfigured: () => true,
  };
});

import { DELETE, PATCH } from "@/app/api/admin/videos/route";

const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const THUMB_PATH = `${ADMIN_ID}/thumb-1.jpg`;
const THUMB_URL = `https://cdn.example.com/video-thumbnails/${THUMB_PATH}`;

function videoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    slug: "evening-in-velvet",
    title: "Evening in Velvet",
    status: "published",
    provider: "direct_url",
    thumbnail_url: THUMB_URL,
    category_id: CATEGORY_ID,
    view_count: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function setup(overrides: Partial<FakeDb> = {}) {
  const harness = createHarness({ videos: [videoRow()], ...overrides });
  harnessState.removed = [];
  const storage = harness.service.storage;
  harnessState.service = {
    ...harness.service,
    storage: {
      from: (bucket: string) => ({
        ...storage.from(bucket),
        remove: async (paths: string[]) => {
          harnessState.removed.push(...paths.map((path) => `${bucket}/${path}`));
          return { data: [], error: null };
        },
      }),
    },
  };
  harnessState.auth = harness.auth;
  return harness;
}

beforeEach(() => {
  setup();
});

describe("PATCH /api/admin/videos — thumbnail change/removal", () => {
  it("rejects unauthenticated requests", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: harnessState.service.from,
    };
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: null }, "PATCH"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: { id: "not-an-admin" } } }) },
      from: harnessState.service.from,
    };
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: null }, "PATCH"));
    expect(res.status).toBe(403);
  });

  it("stores the public URL for a freshly uploaded storage path", async () => {
    const res = await PATCH(
      jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: `${ADMIN_ID}/new-thumb.png` }, "PATCH")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video.thumbnail_url).toBe(`https://cdn.example.com/video-thumbnails/${ADMIN_ID}/new-thumb.png`);
  });

  it("replaces an existing thumbnail and deletes the old object", async () => {
    const harness = setup();
    const res = await PATCH(
      jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: `${ADMIN_ID}/new-thumb.png` }, "PATCH")
    );
    expect(res.status).toBe(200);
    expect(harness.db.videos[0].thumbnail_url).toBe(
      `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/new-thumb.png`
    );
    // The replaced object is cleaned up; the new one stays.
    expect(harnessState.removed).toEqual([`video-thumbnails/${THUMB_PATH}`]);
    expect(harness.db.audit_logs.at(-1)?.action).toBe("video_thumbnail_updated");
  });

  it("removes the thumbnail, deletes the object, and keeps a null in the row", async () => {
    const harness = setup();
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: null }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video.thumbnail_url).toBeNull();
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
    expect(harnessState.removed).toEqual([`video-thumbnails/${THUMB_PATH}`]);
    expect(harness.db.audit_logs.at(-1)?.action).toBe("video_thumbnail_removed");
  });

  it("rejects a body without a thumbnail field, an invalid id, and a traversal path", async () => {
    const missingField = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID }, "PATCH"));
    expect(missingField.status).toBe(400);

    const badId = await PATCH(jsonRequest("/api/admin/videos", { id: "nope", thumbnail_url: null }, "PATCH"));
    expect(badId.status).toBe(400);

    const traversal = await PATCH(
      jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: "../evil.png" }, "PATCH")
    );
    expect(traversal.status).toBe(400);
  });

  it("answers 404 for an unknown video", async () => {
    setup({ videos: [] });
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, thumbnail_url: null }, "PATCH"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/videos — delete a video", () => {
  it("deletes the row, its thumbnail object, and records an audit entry", async () => {
    const harness = setup();
    const res = await DELETE(jsonRequest("/api/admin/videos", { id: VIDEO_ID }, "DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ deleted: true, id: VIDEO_ID });

    expect(harness.db.videos).toHaveLength(0);
    expect(harnessState.removed).toEqual([`video-thumbnails/${THUMB_PATH}`]);
    expect(harness.db.audit_logs.at(-1)).toMatchObject({ action: "video_deleted", target_id: VIDEO_ID });
  });

  it("accepts the id as a query parameter", async () => {
    const harness = setup();
    const res = await DELETE(jsonRequest(`/api/admin/videos?id=${VIDEO_ID}`, {}, "DELETE"));
    expect(res.status).toBe(200);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("leaves the library untouched for an unknown id", async () => {
    const harness = setup();
    const res = await DELETE(jsonRequest("/api/admin/videos", { id: "33333333-3333-4333-8333-333333333333" }, "DELETE"));
    expect(res.status).toBe(404);
    expect(harness.db.videos).toHaveLength(1);
  });

  it("refuses unauthenticated deletes", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: harnessState.service.from,
    };
    const res = await DELETE(jsonRequest("/api/admin/videos", { id: VIDEO_ID }, "DELETE"));
    expect(res.status).toBe(401);
  });
});
