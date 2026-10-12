import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";
import {
  ADMIN_ID,
  CATEGORY_ID,
  createHarness,
  jsonRequest,
  multipartRequest,
  onProvider,
  providerCalls,
  resetStreamtapeMock,
  streamtapeMock,
} from "./helpers/video-route-harness";

/**
 * Tests for `POST /api/videos/upload` — completion of a relay upload.
 *
 * The guarantees under test: the provider file id is never taken from the
 * browser on trust (confirmed via /file/info or an unambiguous folder match),
 * and nothing becomes public until Streamtape reports the file converted.
 */

const dbState = vi.hoisted(() => ({ auth: null as unknown, service: null as unknown, gemini: null as null | (() => Promise<unknown>) }));

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

vi.mock("@/lib/gemini/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gemini/client")>("@/lib/gemini/client");
  return {
    ...actual,
    suggestVideoMetadata: async (...args: unknown[]) => {
      if (!dbState.gemini) throw new Error("Gemini is not configured — set the GEMINI_API_KEY server variable");
      return dbState.gemini();
    },
  };
});

import { POST as completeUpload } from "@/app/api/videos/upload/route";

const SESSION = "11111111-aaaa-4aaa-8aaa-000000000001";
const FILE_ID = "wg8ad12d3QiJRXG";
const NODE_BODY = JSON.stringify({ status: 200, msg: "OK", result: { id: FILE_ID } });
const previousEnv = { ...process.env };
const PREPARED = { title: "Evening in Velvet", description: "A tasteful, slow portrait in soft light.", tags: ["boudoir", "hd"], source: "ai" };

let harness = createHarness();

function info(overrides: Record<string, unknown> = {}) {
  return { id: FILE_ID, name: "clip.mp4", sizeBytes: 1000, mimeType: "video/mp4", converted: true, entryStatus: 200, ...overrides };
}

function seedSession(overrides: Record<string, unknown> = {}) {
  harness.db.upload_jobs.push({
    id: "job-1",
    video_id: null,
    created_by: ADMIN_ID,
    provider: "streamtape",
    provider_upload_id: SESSION,
    file_name: "clip.mp4",
    file_size: 1000,
    status: "uploading",
    ...overrides,
  });
}

function complete(body: Record<string, unknown> = {}) {
  return completeUpload(
    jsonRequest("/api/videos/upload", {
      uploadId: SESSION,
      jobId: "job-1",
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      fileSize: 1000,
      nodeResponse: NODE_BODY,
      metadata: PREPARED,
      ...body,
    })
  );
}

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  dbState.gemini = null;
  resetStreamtapeMock();
  process.env.STREAMTAPE_API_KEY = "key-secret-0123456789";
  process.env.STREAMTAPE_LOGIN = "login-secret-abcdef";
  seedSession();
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...previousEnv };
});

describe("POST /api/videos/upload — success paths", () => {
  it("confirms the id with /file/info and publishes only a converted file", async () => {
    onProvider("fetchFileInfo", async () => info());
    onProvider("getSplashUrl", async () => "https://thumb.tapecontent.net/thumb/wg8ad12d3QiJRXG/thumb.jpg");

    const res = await complete();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      providerFileId: FILE_ID,
      embedUrl: `https://streamtape.com/e/${FILE_ID}`,
      metadataSource: "ai",
      processing: false,
    });
    expect(providerCalls("fetchFileInfo")[0]).toEqual([FILE_ID]);

    const video = harness.db.videos[0];
    expect(video).toMatchObject({
      provider: "streamtape",
      provider_file_id: FILE_ID,
      embed_url: `https://streamtape.com/e/${FILE_ID}`,
      playable_url: null,
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      title: "Evening in Velvet",
      description: PREPARED.description,
      thumbnail_url: "https://thumb.tapecontent.net/thumb/wg8ad12d3QiJRXG/thumb.jpg",
      created_by: ADMIN_ID,
    });
    expect(harness.db.upload_jobs[0]).toMatchObject({ video_id: video.id, provider_file_id: FILE_ID, status: "completed", provider_status: "converted", progress: 100 });
    expect(harness.db.tags.map((tag: any) => tag.slug).sort()).toEqual(["boudoir", "hd"]);
    expect(harness.db.video_tags).toHaveLength(2);
    expect(harness.db.audit_logs[0]).toMatchObject({
      action: "video_published_from_upload",
      metadata: { provider: "streamtape", provider_file_id: FILE_ID, metadata_source: "ai" },
    });
    expect(providerCalls("renameFile")).toEqual([[FILE_ID, "clip.mp4"]]);
  });

  it("keeps the row private while Streamtape is still converting", async () => {
    onProvider("fetchFileInfo", async () => info({ converted: false }));
    const res = await complete();
    const body = await res.json();
    expect(body).toMatchObject({ status: "processing", processing: true, providerFileId: FILE_ID });
    expect(harness.db.videos[0]).toMatchObject({ status: "processing", visibility: "private", provider_file_id: FILE_ID });
    expect(harness.db.upload_jobs[0].status).toBe("processing");
    expect(providerCalls("renameFile")).toHaveLength(0);
  });

  it("marks a legally restricted file (451) failed and private", async () => {
    onProvider("fetchFileInfo", async () => info({ converted: false, entryStatus: 451 }));
    const body = await (await complete()).json();
    expect(body.status).toBe("failed");
    expect(body.providerError).toMatch(/legal reasons/);
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(harness.db.videos[0].provider_error).toMatch(/451/);
    expect(harness.db.upload_jobs[0].status).toBe("failed");
  });

  it("labels metadata from a Gemini failure as fallback, with a warning — never as AI", async () => {
    onProvider("fetchFileInfo", async () => info());
    const res = await complete({ metadata: undefined });
    const body = await res.json();
    expect(body.metadataSource).toBe("fallback");
    expect(body.metadataWarning).toMatch(/AI metadata unavailable/);
    expect(harness.db.audit_logs[0].metadata.metadata_source).toBe("fallback");
  });

  it("uses real Gemini output (source ai) when no prepared metadata is sent", async () => {
    onProvider("fetchFileInfo", async () => info());
    dbState.gemini = async () => ({ title: "Gemini Title", description: "Gemini description.", tags: ["romantic", "hd"], category: "Romantic" });
    const body = await (await complete({ metadata: undefined })).json();
    expect(body.metadataSource).toBe("ai");
    expect(harness.db.videos[0].title).toBe("Gemini Title");
  });
});

describe("file-id provenance", () => {
  it("never accepts a provider id from the browser", async () => {
    for (const field of ["providerFileId", "fileId", "filecode", "file_code"]) {
      const res = await complete({ [field]: "FAKEFAKEFAKE1" });
      expect(res.status).toBe(400);
    }
    expect(harness.db.videos).toHaveLength(0);
    expect(providerCalls("fetchFileInfo")).toHaveLength(0);
  });

  it("falls back to an unambiguous folder match when the node's candidate id is wrong", async () => {
    // The node reply claims an id that Streamtape does not know about.
    onProvider("fetchFileInfo", async (id: string) => (id === FILE_ID ? info() : null));
    onProvider("listFolder", async () => [
      { name: "clip.mp4", sizeBytes: 1000, link: null, linkId: FILE_ID, convert: "converted", createdAtMs: Date.now(), downloads: 0 },
    ]);
    const body = await (await complete({ nodeResponse: JSON.stringify({ result: { id: "FAKEFAKEFAKE1" } }) })).json();
    expect(body.providerFileId).toBe(FILE_ID);
    expect(body.status).toBe("ready");
  });

  it("rejects a candidate whose name/size do not match, instead of publishing someone else's file", async () => {
    vi.useFakeTimers();
    onProvider("fetchFileInfo", async () => info({ name: "other-file.mp4", sizeBytes: 5 }));
    const pending = complete();
    await vi.advanceTimersByTimeAsync(10_000);
    const body = await (await pending).json();
    expect(body.providerFileId).toBeNull();
    expect(body.status).toBe("processing");
    expect(harness.db.videos[0]).toMatchObject({ status: "processing", visibility: "private" });
    expect(harness.db.videos[0].provider_file_id ?? null).toBeNull();
    expect(harness.db.videos[0].embed_url ?? null).toBeNull();
    expect(harness.db.upload_jobs[0].provider_status).toBe("awaiting_registration");
  });

  it("does not re-claim a file id that already belongs to another video", async () => {
    vi.useFakeTimers();
    harness.db.videos.push({ id: "older", provider_file_id: FILE_ID, status: "published" });
    onProvider("fetchFileInfo", async () => null);
    onProvider("listFolder", async () => [
      { name: "clip.mp4", sizeBytes: 1000, link: null, linkId: FILE_ID, convert: "converted", createdAtMs: Date.now(), downloads: 0 },
    ]);
    const pending = complete({ nodeResponse: "" });
    await vi.advanceTimersByTimeAsync(10_000);
    const body = await (await pending).json();
    expect(body.providerFileId).toBeNull();
    expect(body.status).toBe("processing");
  });

  it("leaves an unresolved upload private when the provider is registering slowly", async () => {
    vi.useFakeTimers();
    onProvider("fetchFileInfo", async () => null);
    const pending = complete({ nodeResponse: "<html>ok</html>" });
    await vi.advanceTimersByTimeAsync(10_000);
    const body = await (await pending).json();
    expect(body).toMatchObject({ status: "processing", providerFileId: null, embedUrl: null });
    expect(body.note).toMatch(/has not listed the file yet/);
  });
});

describe("validation, ownership and failure states", () => {
  it("rejects multipart bodies", async () => {
    expect((await completeUpload(multipartRequest("/api/videos/upload"))).status).toBe(415);
  });

  it("requires uploadId and categoryId", async () => {
    expect((await complete({ uploadId: "" })).status).toBe(400);
    expect((await complete({ categoryId: "" })).status).toBe(400);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("rejects an unknown session and another admin's session", async () => {
    expect((await complete({ uploadId: "nope" })).status).toBe(404);
    harness.db.upload_jobs[0].created_by = "someone-else";
    expect((await complete()).status).toBe(404);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("refuses a session that belongs to another provider's job", async () => {
    harness.db.upload_jobs[0].provider = "ufoload";
    expect((await complete()).status).toBe(404);
  });

  it("rejects duplicate completion of the same session", async () => {
    onProvider("fetchFileInfo", async () => info());
    expect((await complete()).status).toBe(200);
    const second = await complete();
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("duplicate_completion");
    expect(harness.db.videos).toHaveLength(1);
  });

  it("rejects an invalid category", async () => {
    onProvider("fetchFileInfo", async () => info());
    const res = await complete({ categoryId: "does-not-exist" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("rejects a thumbnail path that is not this admin's upload", async () => {
    const res = await complete({ thumbnailPath: "someone-else/abc.jpg" });
    expect(res.status).toBe(400);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("ignores an oversized nodeResponse instead of parsing it", async () => {
    vi.useFakeTimers();
    onProvider("fetchFileInfo", async () => null);
    const pending = complete({ nodeResponse: "x".repeat(20_000) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await (await pending).json()).providerFileId).toBeNull();
  });

  it("requires an authenticated admin", async () => {
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.fake.client.from };
    expect((await complete()).status).toBe(401);
    const nonAdmin = createHarness({ profiles: [{ id: ADMIN_ID, role: "advertiser", status: "active" }] });
    dbState.auth = nonAdmin.auth;
    expect((await complete()).status).toBe(403);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("fails closed when the provider is not enabled", async () => {
    streamtapeMock.enabled = false;
    streamtapeMock.disabledReason = "Streamtape uploads are not configured: STREAMTAPE_LOGIN missing";
    const res = await complete();
    expect(res.status).toBe(503);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("a provider error during confirmation surfaces safely and redacts secrets", async () => {
    onProvider("fetchFileInfo", async () => {
      throw new StreamtapeError("Denied key=key-secret-0123456789", { status: 403 });
    });
    const res = await complete();
    const text = JSON.stringify(await res.json());
    expect(res.status).toBe(502);
    expect(text).not.toContain("key-secret-0123456789");
  });
});
