import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID } from "./helpers/video-route-harness";

const state = vi.hoisted(() => ({ service: null as any, auth: null as any }));
const generate = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
}));
vi.mock("@/lib/video/frame-thumbnail", () => ({ generateFrameThumbnail: generate }));

import { POST } from "@/app/api/admin/videos/thumbnails/route";

const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const AUTO_URL = `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/auto.jpg`;
const UPLOADED_URL = `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/custom.jpg`;

function setup(videos: Record<string, unknown>[] = [video()]) {
  const harness = createHarness({ videos });
  state.service = harness.service;
  state.auth = harness.auth;
  state.service.storage.from = () => ({ remove });
  return harness;
}

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, slug: "clip", title: "Clip", thumbnail_url: null,
    playable_url: "https://cdn.example.com/clip.mp4", provider: "direct_url",
    ...overrides,
  };
}

beforeEach(() => {
  generate.mockReset().mockResolvedValue(AUTO_URL);
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  setup();
});

afterEach(() => { vi.restoreAllMocks(); });

function request(ids: unknown = [VIDEO_ID]) {
  return jsonRequest("/api/admin/videos/thumbnails", { ids });
}

describe("automatic thumbnails for existing videos", () => {
  it("requires an authenticated admin", async () => {
    state.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await POST(request())).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("forbids non-admin users", async () => {
    const harness = setup();
    harness.db.profiles[0].role = "advertiser";
    expect((await POST(request())).status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([[], ["not-a-uuid"], Array(11).fill(VIDEO_ID)].map((ids) => [ids]))("rejects invalid selections: %j", async (ids) => {
    expect((await POST(request(ids))).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates, persists, and audits a frame thumbnail when none is set", async () => {
    const harness = setup();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      generated: 1, results: [{ id: VIDEO_ID, status: "generated", thumbnailUrl: AUTO_URL }],
    });
    expect(generate).toHaveBeenCalledWith(state.service, ADMIN_ID, "https://cdn.example.com/clip.mp4");
    expect(harness.db.videos[0].thumbnail_url).toBe(AUTO_URL);
    expect(harness.db.audit_logs[0].action).toBe("video_thumbnail_generated");
    expect(remove).not.toHaveBeenCalled();
  });

  it("never overwrites an existing admin-uploaded thumbnail", async () => {
    const harness = setup([video({ thumbnail_url: UPLOADED_URL })]);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ generated: 0, results: [{ status: "skipped" }] });
    expect(harness.db.videos[0].thumbnail_url).toBe(UPLOADED_URL);
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves a manual upload made while capture was running and cleans up the unused frame", async () => {
    const harness = setup();
    generate.mockImplementation(async () => {
      harness.db.videos[0].thumbnail_url = UPLOADED_URL;
      return AUTO_URL;
    });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ generated: 0, results: [{ status: "skipped" }] });
    expect(harness.db.videos[0].thumbnail_url).toBe(UPLOADED_URL);
    expect(remove).toHaveBeenCalledWith([`${ADMIN_ID}/auto.jpg`]);
    expect(harness.db.audit_logs).toHaveLength(0);
  });

  it("does not attempt to capture frames from an iframe-only player", async () => {
    setup([video({ playable_url: null, provider: "embed" })]);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ generated: 0, results: [{ status: "skipped", error: expect.stringContaining("direct-link") }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("deduplicates IDs so the same thumbnail is not captured twice", async () => {
    const response = await POST(request([VIDEO_ID, VIDEO_ID]));
    const body = await response.json();
    expect(body.generated).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("reports per-video failures without blocking the rest of the batch", async () => {
    const harness = setup([video(), video({ id: OTHER_ID, slug: "other", playable_url: "https://cdn.example.com/other.mp4" })]);
    generate.mockRejectedValueOnce(new Error("No usable frame was found in the video")).mockResolvedValueOnce(AUTO_URL);
    const response = await POST(request([VIDEO_ID, OTHER_ID]));
    expect(await response.json()).toMatchObject({
      generated: 1, results: [{ id: VIDEO_ID, status: "failed" }, { id: OTHER_ID, status: "generated" }],
    });
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
    expect(harness.db.videos[1].thumbnail_url).toBe(AUTO_URL);
  });

  it("keeps a saved thumbnail if audit logging is unavailable", async () => {
    const harness = setup();
    const from = state.service.from;
    state.service.from = (table: string) => table === "audit_logs"
      ? { insert: async () => { throw new Error("Audit unavailable"); } }
      : from(table);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ generated: 1, results: [{ status: "generated" }] });
    expect(harness.db.videos[0].thumbnail_url).toBe(AUTO_URL);
    expect(remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("removes the generated object if its database update fails", async () => {
    const harness = setup();
    const from = state.service.from;
    state.service.from = (table: string) => {
      const query = from(table);
      if (table === "videos") query.maybeSingle = async () => ({ data: null, error: new Error("Database write failed") });
      return query;
    };
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ generated: 0, results: [{ status: "failed", error: "Database write failed" }] });
    expect(remove).toHaveBeenCalledWith([`${ADMIN_ID}/auto.jpg`]);
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
  });
});
