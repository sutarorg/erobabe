import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";
import { ADMIN_ID, createHarness, getRequest, onProvider, providerCalls, resetStreamtapeMock, streamtapeMock } from "./helpers/video-route-harness";

/**
 * Tests for `GET /api/videos/status` — what the admin page polls.
 *
 * A Streamtape video becomes public only here, and only when the provider says
 * `converted`. Legacy UFOLOAD/Uqload rows are returned as stored and the
 * retired providers are never contacted.
 */

const dbState = vi.hoisted(() => ({ auth: null as unknown, service: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.auth,
  createServiceClient: () => dbState.service,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/video/streamtape", async () => {
  const { buildStreamtapeMockModule } = await import("./helpers/mock-streamtape");
  return buildStreamtapeMockModule();
});

import { GET as readStatus } from "@/app/api/videos/status/route";

const FILE_ID = "wg8ad12d3QiJRXG";
const IMPORT_ID = "rbAarvRPXdYbaxY";
const previousEnv = { ...process.env };

let harness = createHarness();

function info(overrides: Record<string, unknown> = {}) {
  return { id: FILE_ID, name: "clip.mp4", sizeBytes: 1000, mimeType: "video/mp4", converted: false, entryStatus: 200, ...overrides };
}

function seedVideo(videoOverrides: Record<string, unknown> = {}, jobOverrides: Record<string, unknown> = {}) {
  harness.db.videos.push({
    id: "video-1",
    slug: "clip-abc12345",
    title: "Evening",
    provider: "streamtape",
    provider_file_id: FILE_ID,
    status: "processing",
    visibility: "private",
    rights_status: "cleared",
    moderation_status: "approved",
    thumbnail_url: null,
    ...videoOverrides,
  });
  harness.db.upload_jobs.push({
    id: "job-1",
    video_id: "video-1",
    provider: "streamtape",
    provider_file_id: videoOverrides.provider_file_id === null ? null : FILE_ID,
    provider_import_id: null,
    file_name: "clip.mp4",
    file_size: 1000,
    storage_path: null,
    status: "processing",
    created_at: new Date().toISOString(),
    ...jobOverrides,
  });
}

const poll = (query = "jobId=job-1") => readStatus(getRequest(`/api/videos/status?${query}`));

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetStreamtapeMock();
  process.env.STREAMTAPE_API_KEY = "key-secret-0123456789";
  process.env.STREAMTAPE_LOGIN = "login-secret-abcdef";
});

afterEach(() => {
  process.env = { ...previousEnv };
});

describe("access control", () => {
  it("requires an authenticated active admin and a target", async () => {
    seedVideo();
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.fake.client.from };
    expect((await poll()).status).toBe(401);
    const nonAdmin = createHarness({ profiles: [{ id: ADMIN_ID, role: "advertiser", status: "active" }] });
    dbState.auth = nonAdmin.auth;
    expect((await poll()).status).toBe(403);
    dbState.auth = harness.auth;
    expect((await poll("")).status).toBe(400);
    expect((await poll("jobId=missing")).status).toBe(404);
    expect(providerCalls("fetchFileInfo")).toHaveLength(0);
  });
});

describe("direct uploads", () => {
  it("promotes to public only when Streamtape reports the file converted", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => info({ converted: true }));
    onProvider("getSplashUrl", async () => "https://thumb.tapecontent.net/thumb/x/thumb.jpg");

    const body = await (await poll()).json();
    expect(body.providerState).toBe("ready");
    expect(body.note).toMatch(/confirmed this video is ready/);
    expect(harness.db.videos[0]).toMatchObject({
      status: "published",
      visibility: "public",
      embed_url: `https://streamtape.com/e/${FILE_ID}`,
      thumbnail_url: "https://thumb.tapecontent.net/thumb/x/thumb.jpg",
    });
    expect(harness.db.upload_jobs[0]).toMatchObject({ status: "completed", provider_status: "converted" });
  });

  it("keeps a converting file private and reports live conversion progress", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => info());
    onProvider("listRunningConverts", async () => [{ name: "clip.mp4", folderId: "0", status: "pending", progress: 0.4, retries: 0, linkId: FILE_ID }]);
    const body = await (await poll()).json();
    expect(body.providerState).toBe("processing");
    expect(body.note).toMatch(/40%/);
    expect(harness.db.videos[0]).toMatchObject({ status: "processing", visibility: "private", provider_progress: 40 });
  });

  it("fails and keeps private a conversion listed in /file/failedconverts", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => info());
    onProvider("listFailedConverts", async () => [{ name: "clip.mp4", folderId: "0", status: "error", progress: 0, retries: 2, linkId: FILE_ID }]);
    const body = await (await poll()).json();
    expect(body.providerState).toBe("failed");
    expect(body.note).toMatch(/could not convert/);
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(harness.db.videos[0].provider_error).toMatch(/could not convert/);
  });

  it("fails a 451 restriction and keeps it private", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => info({ entryStatus: 451 }));
    const body = await (await poll()).json();
    expect(body.providerState).toBe("failed");
    expect(harness.db.videos[0].visibility).toBe("private");
  });

  it("treats a file Streamtape has not listed yet as processing (never ready)", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => null);
    const body = await (await poll()).json();
    expect(body.providerState).toBe("processing");
    expect(harness.db.videos[0].visibility).toBe("private");
  });

  it("resolves a still-unregistered upload through the folder listing and then checks conversion", async () => {
    seedVideo({ provider_file_id: null });
    onProvider("listFolder", async () => [{ name: "clip.mp4", sizeBytes: 1000, link: null, linkId: FILE_ID, convert: "converted", createdAtMs: Date.now(), downloads: 0 }]);
    onProvider("fetchFileInfo", async () => info({ converted: true }));
    const body = await (await poll()).json();
    expect(body.providerState).toBe("ready");
    expect(harness.db.videos[0]).toMatchObject({ provider_file_id: FILE_ID, status: "published" });
  });

  it("fails an upload Streamtape never registered after the grace window", async () => {
    seedVideo({ provider_file_id: null }, { created_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() });
    const body = await (await poll()).json();
    expect(body.providerState).toBe("failed");
    expect(body.note).toMatch(/never registered/);
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
  });

  it("answers a provider outage as a note and leaves the row untouched", async () => {
    seedVideo();
    onProvider("fetchFileInfo", async () => {
      throw new StreamtapeError("Streamtape is having server trouble (503). key=key-secret-0123456789", { status: 503 });
    });
    const res = await poll();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.providerState).toBeNull();
    expect(JSON.stringify(body.note)).not.toContain("key-secret-0123456789");
    expect(harness.db.videos[0]).toMatchObject({ status: "processing", visibility: "private" });
  });

  it("explains when the provider is disabled and does not call it", async () => {
    seedVideo();
    streamtapeMock.enabled = false;
    streamtapeMock.disabledReason = "Set STREAMTAPE_LOGIN";
    const body = await (await poll()).json();
    expect(body.note).toMatch(/STREAMTAPE_LOGIN/);
    expect(providerCalls("fetchFileInfo")).toHaveLength(0);
  });
});

describe("remote imports", () => {
  function seedImport(jobOverrides: Record<string, unknown> = {}) {
    seedVideo({ provider_file_id: null }, { provider_file_id: null, provider_import_id: IMPORT_ID, file_name: "remote.mp4", ...jobOverrides });
  }
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: IMPORT_ID, remoteUrl: "https://cdn.example/a.mp4", status: "new", bytesLoaded: null, bytesTotal: null, folderId: "0", added: null, lastUpdate: null, extid: false, url: false, ...overrides,
  });

  it("a queued task is processing, not published", async () => {
    seedImport();
    onProvider("getRemoteStatus", async () => task());
    const body = await (await poll()).json();
    expect(body.providerState).toBe("processing");
    expect(harness.db.videos[0]).toMatchObject({ status: "processing", visibility: "private" });
    expect(providerCalls("fetchFileInfo")).toHaveLength(0);
  });

  it("a finished task resolves the file id from the watch URL, then waits for conversion", async () => {
    seedImport();
    onProvider("getRemoteStatus", async () => task({ status: "finished", url: `https://streamtape.com/v/${FILE_ID}/remote.mp4` }));
    onProvider("fetchFileInfo", async () => info({ name: "remote.mp4" }));
    const body = await (await poll()).json();
    expect(body.providerState).toBe("processing"); // downloaded ≠ converted
    expect(harness.db.videos[0]).toMatchObject({ provider_file_id: FILE_ID, visibility: "private", embed_url: `https://streamtape.com/e/${FILE_ID}` });

    onProvider("fetchFileInfo", async () => info({ name: "remote.mp4", converted: true }));
    const second = await (await poll()).json();
    expect(second.providerState).toBe("ready");
    expect(harness.db.videos[0]).toMatchObject({ status: "published", visibility: "public" });
  });

  it("a failed task fails the row", async () => {
    seedImport();
    onProvider("getRemoteStatus", async () => task({ status: "error" }));
    const body = await (await poll()).json();
    expect(body.providerState).toBe("failed");
    expect(harness.db.videos[0].visibility).toBe("private");
  });

  it("a task that vanished fails only after the grace window", async () => {
    seedImport();
    onProvider("getRemoteStatus", async () => null);
    expect((await (await poll()).json()).providerState).toBe("processing");
    harness.db.upload_jobs[0].created_at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    expect((await (await poll()).json()).providerState).toBe("failed");
  });
});

describe("legacy rows (retired providers)", () => {
  it.each(["ufoload", "uqload"])("returns a %s row as stored and never contacts any provider", async (provider) => {
    seedVideo({ provider, provider_file_id: "01J6FSPD0S1N7M4HP2Y7Z1B5GE", embed_url: "https://ufoload.com/e/aBcD1234xyz", status: "published", visibility: "public" });
    const res = await poll();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.note).toMatch(/retired/);
    expect(body.providerState).toBeNull();
    expect(body.video).toMatchObject({ embed_url: "https://ufoload.com/e/aBcD1234xyz", status: "published", visibility: "public" });
    expect(streamtapeMock.calls).toHaveLength(0);
  });
});
