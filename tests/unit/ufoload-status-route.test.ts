import { describe, it, expect, vi, beforeEach } from "vitest";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import {
  createHarness,
  getRequest,
  onProvider,
  providerCalls,
  resetUfoloadMock,
  ufoloadMock,
} from "./helpers/video-route-harness";

/**
 * Tests for `GET /api/videos/status` — the endpoint the admin page polls.
 *
 * Its job is to reconcile a stored row with the provider without ever breaking
 * the admin UI: a provider outage is reported as a note, a legacy Uqload row is
 * returned exactly as stored, and a UFOLOAD video only becomes playable here
 * once the provider says `ready`.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.auth,
  createServiceClient: () => dbState.service,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/video/ufoload", async () => {
  const { buildUfoloadMockModule } = await import("./helpers/mock-ufoload");
  return buildUfoloadMockModule();
});

const dbState = vi.hoisted(() => ({ auth: null as unknown, service: null as unknown }));

import { GET as readStatus } from "@/app/api/videos/status/route";

const FILE_ULID = "01J6FSPD0S1N7M4HP2Y7Z1B5GE";
const PUBLIC_ID = "aBcD1234xyz";

function fileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ULID,
    publicId: PUBLIC_ID,
    name: "clip.mp4",
    sizeBytes: 1048576,
    mimeType: "video/mp4",
    status: "processing",
    progress: 55,
    durationSeconds: null,
    width: null,
    height: null,
    maxQuality: null,
    views: 0,
    error: null,
    posterUrl: null,
    createdAt: "2026-10-12T12:00:00Z",
    duplicate: false,
    ...overrides,
  };
}

let harness = createHarness();

function seedUploadingVideo(overrides: Record<string, unknown> = {}) {
  harness.db.videos.push({
    id: "video-1",
    slug: "clip-abc12345",
    title: "Evening in Velvet",
    provider: "ufoload",
    provider_file_id: FILE_ULID,
    provider_public_id: null,
    status: "processing",
    visibility: "private",
    rights_status: "cleared",
    moderation_status: "approved",
    thumbnail_url: null,
    ...overrides,
  });
  harness.db.upload_jobs.push({
    id: "job-1",
    video_id: "video-1",
    provider: "ufoload",
    provider_file_id: FILE_ULID,
    provider_import_id: null,
    provider_status: "processing",
    storage_path: null,
    status: "processing",
    created_at: new Date().toISOString(),
  });
  return harness.db.videos[0];
}

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetUfoloadMock();
});

describe("GET /api/videos/status", () => {
  it("requires an active admin and an identifier", async () => {
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.auth.from };
    expect((await readStatus(getRequest("/api/videos/status?videoId=video-1"))).status).toBe(401);

    dbState.auth = harness.auth;
    harness.db.profiles[0].role = "viewer";
    expect((await readStatus(getRequest("/api/videos/status?videoId=video-1"))).status).toBe(403);

    dbState.auth = harness.auth;
    harness.db.profiles[0].role = "admin";
    const missing = await readStatus(getRequest("/api/videos/status"));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/videoId or jobId/);

    expect((await readStatus(getRequest("/api/videos/status?videoId=nope"))).status).toBe(404);
  });

  it("reports an upload that is still encoding, with the provider's progress", async () => {
    seedUploadingVideo();
    onProvider("getFile", async () => fileFixture({ status: "processing", progress: 55 }));

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providerState).toBe("processing");
    expect(body.note).toMatch(/still processing/i);
    expect(body.providerInfo).toMatchObject({ fileId: FILE_ULID, providerStatus: "processing", progress: 55, canPlay: false });
    expect(body.video).toMatchObject({ status: "processing", visibility: "private", provider_progress: 55 });
    expect(providerCalls("getFile")).toEqual([[FILE_ULID]]);
  });

  it("publishes exactly once the provider reports the file as ready", async () => {
    seedUploadingVideo();
    onProvider("getFile", async () => fileFixture({ status: "ready", progress: 100, durationSeconds: 61 }));

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    const body = await res.json();

    expect(body.providerState).toBe("ready");
    expect(body.note).toMatch(/confirmed this video is ready/i);
    expect(body.video).toMatchObject({
      status: "published",
      visibility: "public",
      provider_progress: 100,
      embed_url: `https://ufoload.com/e/${PUBLIC_ID}`,
      playable_url: `https://ufoload.com/v/${PUBLIC_ID}`,
      duration_seconds: 61,
    });
    expect(harness.db.upload_jobs[0]).toMatchObject({ status: "completed", provider_status: "ready" });
  });

  it("keeps a failed encode private and explains why", async () => {
    seedUploadingVideo();
    onProvider("getFile", async () => fileFixture({ status: "failed", error: "unsupported codec" }));

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providerState).toBe("failed");
    expect(body.note).toBe("unsupported codec");
    expect(body.video).toMatchObject({ status: "draft", visibility: "private", provider_error: "unsupported codec" });
    expect(harness.db.upload_jobs[0].status).toBe("failed");
  });

  it("resolves the video through a job id and cleans up the transit copy once ready", async () => {
    seedUploadingVideo({ provider_file_id: null });
    harness.db.upload_jobs[0].storage_path = "transit/admin-1/clip.mp4";
    onProvider("getFile", async () => fileFixture({ status: "ready" }));

    const res = await readStatus(getRequest("/api/videos/status?jobId=job-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.video.id).toBe("video-1");
    expect(body.video.status).toBe("published");
    // The provider has the file; the transit object is no longer needed.
    expect(body.job.storage_path).toBeNull();
  });

  it("follows an import task until the created file is playable", async () => {
    harness.db.videos.push({
      id: "video-2",
      provider: "ufoload",
      provider_file_id: null,
      status: "processing",
      visibility: "private",
      thumbnail_url: null,
    });
    harness.db.upload_jobs.push({
      id: "job-2",
      video_id: "video-2",
      provider: "ufoload",
      provider_file_id: null,
      provider_import_id: "imp_1",
      provider_status: "running",
      status: "processing",
      created_at: new Date().toISOString(),
    });
    onProvider("findImport", async () => ({
      id: "imp_1",
      url: "https://example.com/a.mp4",
      name: "a.mp4",
      status: "running",
      progress: 30,
      error: null,
      fileId: null,
      createdAt: "2026-10-12T12:00:00Z",
    }));

    const running = await readStatus(getRequest("/api/videos/status?jobId=job-2"));
    const runningBody = await running.json();
    expect(runningBody.providerState).toBe("processing");
    expect(runningBody.note).toMatch(/downloading/i);
    expect(runningBody.video.status).toBe("processing");

    onProvider("findImport", async () => ({
      id: "imp_1",
      url: "https://example.com/a.mp4",
      name: "a.mp4",
      status: "done",
      progress: 100,
      error: null,
      fileId: FILE_ULID,
      createdAt: "2026-10-12T12:00:00Z",
    }));
    onProvider("getFile", async () => fileFixture({ status: "ready", progress: 100 }));

    const done = await readStatus(getRequest("/api/videos/status?jobId=job-2"));
    const doneBody = await done.json();
    expect(doneBody.providerState).toBe("ready");
    expect(doneBody.video).toMatchObject({
      status: "published",
      provider_file_id: FILE_ULID,
      provider_public_id: PUBLIC_ID,
    });
    expect(harness.db.upload_jobs[0]).toMatchObject({ status: "completed", provider_file_id: FILE_ULID });
  });

  it("returns a legacy Uqload row untouched and says so", async () => {
    harness.db.videos.push({
      id: "video-legacy",
      provider: "uqload",
      provider_file_id: "filecode123",
      playable_url: "https://uqload.to/embed-legacy.html",
      embed_url: "https://uqload.to/embed-legacy.html",
      status: "published",
      visibility: "public",
    });

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-legacy"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.video).toMatchObject({
      provider: "uqload",
      provider_file_id: "filecode123",
      embed_url: "https://uqload.to/embed-legacy.html",
      status: "published",
    });
    expect(body.providerState).toBeNull();
    expect(body.note).toMatch(/retired Uqload/i);
    // The retired provider is never contacted again.
    expect(providerCalls("getFile")).toHaveLength(0);
    expect(ufoloadMock.calls.filter((call) => call.method !== "getEmbedUrl")).toHaveLength(0);
  });

  it("answers with a note, not a 500, when the provider is unreachable", async () => {
    seedUploadingVideo();
    onProvider("getFile", async () => {
      throw new UfoloadError("Network error while talking to UFOLOAD.", { status: 0, code: "network_error" });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.note).toMatch(/network error/i);
    expect(body.providerState).toBeNull();
    // The stored row is left exactly as it was.
    expect(body.video).toMatchObject({ status: "processing", visibility: "private" });
    expect(warn).toHaveBeenCalled();
  });

  it("explains a missing configuration instead of failing the poll", async () => {
    seedUploadingVideo();
    ufoloadMock.enabled = false;
    ufoloadMock.disabledReason = "Set UFOLOAD_API_KEY (server-only) to the API key from the UFOLOAD dashboard.";

    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.note).toMatch(/UFOLOAD_API_KEY/);
    expect(body.providerState).toBeNull();
    expect(providerCalls("getFile")).toHaveLength(0);
    expect(body.video.status).toBe("processing");
  });

  it("never leaks the API key through the status payload", async () => {
    seedUploadingVideo();
    onProvider("getFile", async () => fileFixture({ status: "ready" }));
    const res = await readStatus(getRequest("/api/videos/status?videoId=video-1"));
    expect(JSON.stringify(await res.json())).not.toContain("ufo_test_key");
  });
});
