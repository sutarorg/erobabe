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

function setup(
  overrides: Partial<FakeDb> = {},
  options: Parameters<typeof createHarness>[1] = {},
) {
  const harness = createHarness({ videos: [videoRow()], ...overrides }, options);
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

describe("PATCH /api/admin/videos — homepage carousel slots", () => {
  const OTHER_ID = "33333333-3333-4333-8333-333333333333";

  it("places a video in slot 2 and moves the previous holder out", async () => {
    const harness = setup({
      videos: [
        videoRow({
          carousel_position: 2,
          carousel_title: "Old Hook",
          carousel_description: "Old teaser",
        }),
        videoRow({ id: OTHER_ID, slug: "solo-night", title: "Solo Night", carousel_position: null }),
      ],
    });
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: OTHER_ID, carousel_position: 2 }, "PATCH"));
    expect(res.status).toBe(200);
    expect((await res.json()).video.carousel_position).toBe(2);
    const byId = Object.fromEntries(harness.db.videos.map((row: any) => [row.id, row.carousel_position]));
    expect(byId[OTHER_ID]).toBe(2);
    expect(byId[VIDEO_ID]).toBeNull();
    // The video that lost the slot keeps neither the slot nor its card copy.
    const previousHolder = harness.db.videos.find((row: any) => row.id === VIDEO_ID)!;
    expect(previousHolder.carousel_title).toBeNull();
    expect(previousHolder.carousel_description).toBeNull();
    expect(harness.db.audit_logs.at(-1)?.action).toBe("video_carousel_assigned");
  });

  it("clears a video's slot with null", async () => {
    const harness = setup({ videos: [videoRow({ carousel_position: 1 })] });
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, carousel_position: null }, "PATCH"));
    expect(res.status).toBe(200);
    expect(harness.db.videos[0].carousel_position).toBeNull();
    expect(harness.db.audit_logs.at(-1)?.action).toBe("video_carousel_cleared");
  });

  it("rejects slots outside 1–3", async () => {
    setup();
    for (const bad of [4, 0.5, "two", -1]) {
      const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, carousel_position: bad }, "PATCH"));
      expect(res.status).toBe(400);
    }
  });

  it("writes the short carousel copy with the slot, inside the card word budget", async () => {
    // No OPENROUTER_API_KEY in the test environment, so the copy is derived from
    // the listing itself — still capped at 5 and 10 words.
    const harness = setup({
      videos: [
        videoRow({
          title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
          description:
            "A slow late-night scene with a lot of explicit detail and camera work for the viewer at home",
        }),
      ],
    });
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, carousel_position: 1 }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video.carousel_position).toBe(1);
    expect(body.video.carousel_title.split(" ").length).toBeLessThanOrEqual(5);
    expect(body.video.carousel_description.split(" ").length).toBeLessThanOrEqual(10);
    expect(body.carouselCopy).toMatchObject({ source: "fallback", stored: true });

    const row = harness.db.videos[0];
    expect(row.carousel_title).toBe(body.video.carousel_title);
    expect(row.carousel_description).toBe(body.video.carousel_description);
    expect(harness.db.audit_logs.at(-1)?.metadata).toMatchObject({
      carousel_title: body.video.carousel_title,
      carousel_copy_source: "fallback",
    });
  });

  it("clears the carousel copy when the slot is cleared", async () => {
    const harness = setup({
      videos: [
        videoRow({
          carousel_position: 1,
          carousel_title: "Velvet Nights",
          carousel_description: "The two of us after hours",
        }),
      ],
    });
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, carousel_position: null }, "PATCH"));
    expect(res.status).toBe(200);
    expect((await res.json()).video.carousel_title).toBeNull();
    expect(harness.db.videos[0].carousel_position).toBeNull();
    expect(harness.db.videos[0].carousel_title).toBeNull();
    expect(harness.db.videos[0].carousel_description).toBeNull();
  });

  it("keeps the slot when the copy columns are not migrated yet", async () => {
    const harness = setup(
      { videos: [videoRow()] },
      { missingColumns: { videos: ["carousel_title", "carousel_description"] } },
    );
    const res = await PATCH(jsonRequest("/api/admin/videos", { id: VIDEO_ID, carousel_position: 3 }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(harness.db.videos[0].carousel_position).toBe(3);
    expect(body.carouselCopy).toMatchObject({ stored: false });
    expect(body.carouselCopy.warning).toMatch(/migration 00000000000020/);
  });

  it("regenerates the copy for a video that is already in a slot", async () => {
    const harness = setup({
      videos: [videoRow({ carousel_position: 2, carousel_title: "Old Hook", carousel_description: "Old teaser" })],
    });
    const res = await PATCH(
      jsonRequest("/api/admin/videos", { id: VIDEO_ID, action: "regenerate_carousel_copy" }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video.carousel_position).toBe(2);
    expect(harness.db.videos[0].carousel_title).toBe(body.video.carousel_title);
    expect(harness.db.videos[0].carousel_title).not.toBe("Old Hook");
    expect(harness.db.audit_logs.at(-1)?.action).toBe("video_carousel_copy_regenerated");
  });

  it("refuses to regenerate copy for a video outside the carousel", async () => {
    setup({ videos: [videoRow({ carousel_position: null })] });
    const res = await PATCH(
      jsonRequest("/api/admin/videos", { id: VIDEO_ID, action: "regenerate_carousel_copy" }, "PATCH"),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/videos — bulk delete", () => {
  it("deletes the selected videos, their thumbnails, and reports missing ids", async () => {
    const otherId = "44444444-4444-4444-8444-444444444444";
    const harness = setup({
      videos: [
        videoRow(),
        videoRow({ id: otherId, slug: "b", title: "B", thumbnail_url: `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/b.jpg` }),
      ],
    });
    const missingId = "55555555-5555-4555-8555-555555555555";
    const res = await DELETE(jsonRequest("/api/admin/videos", { ids: [VIDEO_ID, otherId, missingId] }, "DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted.sort()).toEqual([VIDEO_ID, otherId].sort());
    expect(body.missing).toEqual([missingId]);
    expect(harness.db.videos).toHaveLength(0);
    expect(harnessState.removed).toContain(`video-thumbnails/${THUMB_PATH}`);
    expect(harness.db.audit_logs.filter((row: any) => row.action === "video_deleted")).toHaveLength(2);
  });

  it("refuses an empty or oversized bulk request", async () => {
    setup();
    expect((await DELETE(jsonRequest("/api/admin/videos", { ids: [] }, "DELETE"))).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    expect((await DELETE(jsonRequest("/api/admin/videos", { ids: many }, "DELETE"))).status).toBe(400);
  });
});
