import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for the category card thumbnail on /api/admin/categories.
 *
 * The admin uploads an image to Supabase Storage from the browser and sends
 * either the resulting public URL or the storage path; the route stores the
 * public URL, and deleting/replacing a thumbnail removes the old object.
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

import { PATCH, POST } from "@/app/api/admin/categories/route";

const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const IMAGE_PATH = `${ADMIN_ID}/card-1.webp`;
const IMAGE_URL = `https://cdn.example.com/video-thumbnails/${IMAGE_PATH}`;

function setup(overrides: Partial<FakeDb> = {}) {
  const harness = createHarness({
    categories: [{ id: CATEGORY_ID, label: "Boudoir", slug: "boudoir", icon: null, image_url: null }],
    ...overrides,
  });
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

describe("POST /api/admin/categories — thumbnail on create", () => {
  it("resolves an uploaded storage path to the stored public URL", async () => {
    const harness = setup();
    const res = await POST(
      jsonRequest("/api/admin/categories", { label: "Latex", slug: "latex", image_url: IMAGE_PATH })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.category.image_url).toBe(IMAGE_URL);
    expect(harness.db.categories.at(-1)?.image_url).toBe(IMAGE_URL);
    expect(harness.db.audit_logs.at(-1)?.metadata).toMatchObject({ has_image: true });
  });

  it("accepts a ready-made public URL and an omitted thumbnail", async () => {
    const harness = setup();
    await POST(jsonRequest("/api/admin/categories", { label: "Latex", image_url: "https://i.postimg.cc/a/b.png" }));
    expect(harness.db.categories.at(-1)?.image_url).toBe("https://i.postimg.cc/a/b.png");

    await POST(jsonRequest("/api/admin/categories", { label: "Rain", slug: "rain" }));
    expect(harness.db.categories.at(-1)?.image_url).toBeNull();
  });

  it("refuses a thumbnails-only body without a name", async () => {
    const res = await POST(jsonRequest("/api/admin/categories", { image_url: IMAGE_PATH }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/categories — thumbnail change/removal", () => {
  it("sets a thumbnail path and deletes the object it replaced", async () => {
    const harness = setup({
      categories: [{ id: CATEGORY_ID, label: "Boudoir", slug: "boudoir", icon: null, image_url: "https://cdn.example.com/video-thumbnails/old/card.png" }],
    });
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID, image_url: IMAGE_PATH }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.image_url).toBe(IMAGE_URL);
    expect(harnessState.removed).toEqual(["video-thumbnails/old/card.png"]);
    expect(harness.db.audit_logs.at(-1)?.action).toBe("category_updated");
  });

  it("removes the thumbnail and its stored object", async () => {
    const harness = setup({
      categories: [{ id: CATEGORY_ID, label: "Boudoir", slug: "boudoir", icon: null, image_url: IMAGE_URL }],
    });
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID, image_url: null }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.image_url).toBeNull();
    expect(harnessState.removed).toEqual([`video-thumbnails/${IMAGE_PATH}`]);
    expect(harness.db.audit_logs.at(-1)?.metadata).toMatchObject({ has_image: false });
  });

  it("keeps the existing image when the field is not part of the change", async () => {
    const harness = setup({
      categories: [{ id: CATEGORY_ID, label: "Boudoir", slug: "boudoir", icon: null, image_url: IMAGE_URL }],
    });
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID, icon: "camera" }, "PATCH"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.image_url).toBe(IMAGE_URL);
    expect(harnessState.removed).toEqual([]);
  });

  it("rejects a thumbnail path that is not an uploaded object", async () => {
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID, image_url: "../../secret" }, "PATCH"));
    expect(res.status).toBe(500);
  });

  it("rejects an empty change set", async () => {
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID }, "PATCH"));
    expect(res.status).toBe(400);
  });

  it("refuses non-admins", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: { id: "someone" } } }) },
      from: harnessState.service.from,
    };
    const res = await PATCH(jsonRequest("/api/admin/categories", { id: CATEGORY_ID, image_url: IMAGE_PATH }, "PATCH"));
    expect(res.status).toBe(403);
  });
});
