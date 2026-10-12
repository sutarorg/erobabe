import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { rejected } from "./helpers/provider-errors";
import { UfoloadError, ufoloadEmbedUrl, ufoloadWatchUrl } from "@/lib/video/ufoload-protocol";
import type { UfoloadFile, UfoloadImportTask } from "@/lib/video/ufoload-protocol";
import type { UfoloadProvider } from "@/lib/video/ufoload";

/**
 * Lifecycle tests for the server-side UFOLOAD orchestration.
 *
 * The provider is a stub and Supabase is the in-memory client, so these assert
 * the rules that keep the catalogue honest:
 *   - a provider identifier is only ever taken from the provider's answer;
 *   - a video stays private until the provider reports the file as `ready`;
 *   - an import task id is never stored as a file id;
 *   - signed/expiring links never end up in the database.
 */

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  return {
    ...actual,
    suggestVideoMetadata: async () => {
      throw new Error("Gemini is not available in unit tests");
    },
  };
});

import {
  IMPORT_TRACKING_GRACE_MS,
  completeUfoloadUpload,
  reconcileUfoloadRecord,
  startUfoloadImport,
  startUfoloadUpload,
} from "@/lib/video/ufoload-flow";

const CATEGORY_ID = "cat-boudoir";
const ADMIN_ID = "admin-1";
const FILE_ULID = "01J6FSPD0S1N7M4HP2Y7Z1B5GE";
const PUBLIC_ID = "aBcD1234xyz";

const PREPARED = {
  title: "Evening in Velvet",
  description: "An elegant, slow-paced portrait captured in soft cinematic light.",
  tags: ["boudoir", "cinematic"],
  source: "ai" as const,
};

function fileFixture(overrides: Partial<UfoloadFile> = {}): UfoloadFile {
  return {
    id: FILE_ULID,
    publicId: PUBLIC_ID,
    name: "clip.mp4",
    sizeBytes: 1048576,
    mimeType: "video/mp4",
    status: "ready",
    progress: 100,
    durationSeconds: 61,
    width: 1920,
    height: 1080,
    maxQuality: 720,
    views: 0,
    error: null,
    posterUrl: "https://ufoload.com/i/pp/poster.jpg",
    createdAt: "2026-10-12T12:00:00Z",
    duplicate: false,
    ...overrides,
  };
}

function importFixture(overrides: Partial<UfoloadImportTask> = {}): UfoloadImportTask {
  return {
    id: "imp_1",
    url: "https://example.com/a.mp4",
    name: "a.mp4",
    status: "running",
    progress: 20,
    error: null,
    fileId: null,
    createdAt: "2026-10-12T12:00:00Z",
    ...overrides,
  };
}

interface ProviderStub {
  provider: UfoloadProvider;
  initDirectUpload: ReturnType<typeof vi.fn>;
  completeDirectUpload: ReturnType<typeof vi.fn>;
  cancelDirectUpload: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
  getFileWithLinks: ReturnType<typeof vi.fn>;
  createImport: ReturnType<typeof vi.fn>;
  findImport: ReturnType<typeof vi.fn>;
  renameFile: ReturnType<typeof vi.fn>;
}

function stubProvider(): ProviderStub {
  const stub = {
    initDirectUpload: vi.fn(),
    completeDirectUpload: vi.fn(),
    cancelDirectUpload: vi.fn(async () => true),
    getFile: vi.fn(),
    getFileWithLinks: vi.fn(),
    createImport: vi.fn(),
    findImport: vi.fn(async () => null),
    renameFile: vi.fn(async () => true),
  };
  const provider = {
    name: "ufoload",
    isEnabled: () => true,
    disabledReason: () => null,
    assertEnabled: () => {},
    ...stub,
    getEmbedUrl: (identifier: string) => ufoloadEmbedUrl(identifier),
    getPlayableUrl: (identifier: string) => ufoloadWatchUrl(identifier),
  } as unknown as UfoloadProvider & typeof stub;
  return { provider, ...stub };
}

function seedDb() {
  const fake = createFakeSupabase({
    categories: [{ id: CATEGORY_ID, label: "Boudoir" }],
    videos: [],
    tags: [],
    video_tags: [],
    upload_jobs: [],
  });
  return fake;
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    uploadId: "upl_1",
    url: "https://upload.ufoload.com/17/_node/v1/ingest/upl_1",
    authorization: "UfoGrant abc12345",
    chunkSize: 8388608,
    maxBytes: 2 * 1024 * 1024 * 1024,
    expiresAt: "2026-10-12T14:00:00Z",
    ...overrides,
  };
}

describe("startUfoloadUpload", () => {
  it("reserves the provider slot, records the session, and returns upload-scoped material only", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    stub.initDirectUpload.mockResolvedValue(grant());

    const session = await startUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      fileName: "clip.mp4",
      fileSize: 1048576,
      mimeType: "video/mp4",
    });

    expect(stub.initDirectUpload).toHaveBeenCalledWith({
      fileName: "clip.mp4",
      fileSize: 1048576,
      mimeType: "video/mp4",
    });
    expect(session.uploadId).toBe("upl_1");
    expect(JSON.stringify(session)).not.toContain("ufo_");

    // The completion step will only accept a session that this admin created.
    const job = db.upload_jobs[0];
    expect(job).toMatchObject({
      provider: "ufoload",
      provider_upload_id: "upl_1",
      status: "uploading",
      created_by: ADMIN_ID,
      file_name: "clip.mp4",
      file_size: 1048576,
    });
    expect(session.jobId).toBe(job.id);
  });

  it("cancels the reserved slot and refuses a file over the account limit", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    stub.initDirectUpload.mockResolvedValue(grant({ maxBytes: 1024 }));

    const error = await rejected(
      startUfoloadUpload({
        service: client as never,
        userId: ADMIN_ID,
        provider: stub.provider,
        fileName: "huge.mp4",
        fileSize: 2048,
      })
    );

    expect(error.status).toBe(413);
    expect(error.code).toBe("plan_file_too_large");
    expect(error.message).toMatch(/larger than the UFOLOAD upload limit/i);
    expect(stub.cancelDirectUpload).toHaveBeenCalledWith("upl_1");
    expect(db.upload_jobs).toHaveLength(0);
  });

  it("still refuses the file when the cleanup call itself fails", async () => {
    const { client } = seedDb();
    const stub = stubProvider();
    stub.initDirectUpload.mockResolvedValue(grant({ maxBytes: 10 }));
    stub.cancelDirectUpload.mockRejectedValue(new Error("network"));

    await expect(
      startUfoloadUpload({
        service: client as never,
        userId: ADMIN_ID,
        provider: stub.provider,
        fileName: "huge.mp4",
        fileSize: 99,
      })
    ).rejects.toMatchObject({ status: 413, code: "plan_file_too_large" });
  });
});

describe("completeUfoloadUpload", () => {
  async function startSession(stub: ProviderStub, dbClient: { from: unknown }) {
    stub.initDirectUpload.mockResolvedValue(grant());
    return startUfoloadUpload({
      service: dbClient as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      fileName: "clip.mp4",
      fileSize: 1048576,
    });
  }

  it("refuses a session that does not belong to this admin", async () => {
    const { client } = seedDb();
    const stub = stubProvider();

    const error = await rejected(
      completeUfoloadUpload({
        service: client as never,
        userId: "someone-else",
        provider: stub.provider,
        uploadId: "upl_1",
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
      })
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe("unknown_upload_session");
    expect(stub.completeDirectUpload).not.toHaveBeenCalled();
  });

  it("publishes only once the provider says the file is ready", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockResolvedValue(fileFixture({ status: "ready" }));

    const result = await completeUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      uploadId: session.uploadId,
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      fileSize: 1048576,
      prepared: PREPARED,
    });

    expect(result.readiness).toBe("ready");
    expect(result.providerFileId).toBe(FILE_ULID);
    expect(result.providerPublicId).toBe(PUBLIC_ID);
    expect(result.embedUrl).toBe(`https://ufoload.com/e/${PUBLIC_ID}`);
    expect(result.playableUrl).toBe(`https://ufoload.com/v/${PUBLIC_ID}`);

    const video = db.videos[0];
    expect(video).toMatchObject({
      provider: "ufoload",
      provider_file_id: FILE_ULID,
      provider_public_id: PUBLIC_ID,
      embed_url: `https://ufoload.com/e/${PUBLIC_ID}`,
      playable_url: `https://ufoload.com/v/${PUBLIC_ID}`,
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      provider_progress: 100,
      thumbnail_url: "https://ufoload.com/i/pp/poster.jpg",
    });
    expect(video.published_at).toBeTruthy();
    expect(db.upload_jobs[0]).toMatchObject({ status: "completed", provider_status: "ready", progress: 100 });
    expect(stub.renameFile).toHaveBeenCalledWith(FILE_ULID, PREPARED.title);
  });

  it("keeps the video private while the provider is still encoding", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockResolvedValue(fileFixture({ status: "processing", progress: 42 }));

    const result = await completeUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      uploadId: session.uploadId,
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      prepared: PREPARED,
    });

    expect(result.readiness).toBe("processing");
    const video = db.videos[0];
    expect(video.status).toBe("processing");
    expect(video.visibility).toBe("private");
    expect(video.published_at).toBeUndefined();
    expect(video.provider_progress).toBe(42);
    expect(video.embed_url).toBe(`https://ufoload.com/e/${PUBLIC_ID}`);
    expect(video.playable_url).toBe(`https://ufoload.com/v/${PUBLIC_ID}`);
    expect(db.upload_jobs[0]).toMatchObject({ status: "processing", provider_status: "processing", progress: 42 });
  });

  it("keeps the row private and records the reason when the provider rejects the file", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockResolvedValue(
      fileFixture({ status: "failed", error: "unsupported codec", publicId: null })
    );

    const result = await completeUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      uploadId: session.uploadId,
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      prepared: PREPARED,
    });

    expect(result.readiness).toBe("failed");
    const video = db.videos[0];
    expect(video.status).toBe("draft");
    expect(video.visibility).toBe("private");
    expect(video.provider_error).toBe("unsupported codec");
    expect(db.upload_jobs[0]).toMatchObject({ status: "failed", error_message: "unsupported codec" });
  });

  it("marks the video failed when the completion call itself fails", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockRejectedValue(
      new UfoloadError("UFOLOAD is busy with this upload. Retrying in a moment.", { status: 409, code: "upload_busy" })
    );

    await expect(
      completeUfoloadUpload({
        service: client as never,
        userId: ADMIN_ID,
        provider: stub.provider,
        uploadId: session.uploadId,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        prepared: PREPARED,
      })
    ).rejects.toMatchObject({ code: "upload_busy" });

    expect(db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(db.videos[0].provider_error).toMatch(/busy with this upload/i);
    expect(db.upload_jobs[0].status).toBe("failed");
  });

  it("falls back to the ULID whenever the provider returns no public id", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockResolvedValue(fileFixture({ status: "ready", publicId: null }));

    const result = await completeUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      uploadId: session.uploadId,
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      prepared: PREPARED,
    });

    expect(result.embedUrl).toBe(`https://ufoload.com/e/${FILE_ULID}`);
    expect(db.videos[0].provider_public_id).toBeNull();
    expect(db.videos[0].embed_url).toBe(`https://ufoload.com/e/${FILE_ULID}`);
  });

  it("never fails a publish because the cosmetic rename failed", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    const session = await startSession(stub, client);
    stub.completeDirectUpload.mockResolvedValue(fileFixture({ status: "ready" }));
    stub.renameFile.mockRejectedValue(new Error("rename exploded"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await completeUfoloadUpload({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      uploadId: session.uploadId,
      categoryId: CATEGORY_ID,
      fileName: "clip.mp4",
      prepared: PREPARED,
    });

    expect(result.readiness).toBe("ready");
    expect(db.videos[0].status).toBe("published");
  });
});

describe("startUfoloadImport", () => {
  it("stores the task id as an import id and keeps the video private", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    stub.createImport.mockResolvedValue(importFixture());

    const started = await startUfoloadImport({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      categoryId: CATEGORY_ID,
      remoteUrl: "https://example.com/a.mp4",
      name: "a.mp4",
    });

    expect(started.importId).toBe("imp_1");
    expect(db.upload_jobs[0]).toMatchObject({
      provider: "ufoload",
      provider_import_id: "imp_1",
      provider_status: "running",
      status: "processing",
      video_id: db.videos[0].id,
    });
    // The import task id is not a file id.
    expect(db.upload_jobs[0].provider_file_id).toBeUndefined();
    expect(db.videos[0]).toMatchObject({ provider: "ufoload", status: "processing", visibility: "private" });
    expect(db.videos[0].embed_url).toBeUndefined();
  });

  it("marks the video failed when the provider refuses the import", async () => {
    const { client, db } = seedDb();
    const stub = stubProvider();
    stub.createImport.mockRejectedValue(
      new UfoloadError("UFOLOAD allows at most 10 active imports at a time.", { status: 429, code: "too_many_active" })
    );

    await expect(
      startUfoloadImport({
        service: client as never,
        userId: ADMIN_ID,
        provider: stub.provider,
        categoryId: CATEGORY_ID,
        remoteUrl: "https://example.com/a.mp4",
        name: "a.mp4",
      })
    ).rejects.toMatchObject({ code: "too_many_active" });

    expect(db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(db.upload_jobs[0]).toMatchObject({ status: "failed" });
    expect(db.upload_jobs[0].provider_import_id).toBeUndefined();
  });
});

describe("reconcileUfoloadRecord", () => {
  function seeded() {
    const fake = seedDb();
    const video: {
      id: string;
      provider: string;
      provider_file_id: string | null;
      provider_public_id: string | null;
      thumbnail_url: string | null;
      status: string;
      visibility: string;
    } = {
      id: "video-1",
      provider: "ufoload",
      provider_file_id: null,
      provider_public_id: null,
      thumbnail_url: null,
      status: "processing",
      visibility: "private",
    };
    fake.db.videos.push(video);
    const job: {
      id: string;
      video_id: string;
      provider: string;
      provider_import_id: string | null;
      provider_file_id: string | null;
      provider_status: string | null;
      status: string;
      created_at: string;
    } = {
      id: "job-1",
      video_id: "video-1",
      provider: "ufoload",
      provider_import_id: null,
      provider_file_id: null,
      provider_status: null,
      status: "processing",
      created_at: new Date().toISOString(),
    };
    fake.db.upload_jobs.push(job);
    return { ...fake, video, job };
  }

  it("reports an import that is still downloading without touching the video", async () => {
    const { client, db, video, job } = seeded();
    job.provider_import_id = "imp_1";
    const stub = stubProvider();
    stub.findImport.mockResolvedValue(importFixture({ status: "queued", progress: 0 }));

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome).toMatchObject({ state: "processing" });
    expect(outcome.state === "processing" && outcome.note).toMatch(/queued/i);
    expect(db.videos[0].status).toBe("processing");
    expect(db.upload_jobs[0]).toMatchObject({ provider_status: "queued", progress: 0 });
  });

  it("applies the finished file but never stores its signed links", async () => {
    const { client, db, video, job } = seeded();
    job.provider_import_id = "imp_1";
    const stub = stubProvider();
    stub.findImport.mockResolvedValue(importFixture({ status: "done", fileId: FILE_ULID, progress: 100 }));
    stub.getFile.mockResolvedValue(fileFixture({ status: "ready" }));
    // A signed, expiring link set is available from the provider…
    stub.getFileWithLinks.mockResolvedValue({
      file: fileFixture({ status: "ready" }),
      links: {
        playback: "https://cdn.ufoload.com/hls/signed/master.m3u8?sig=deadbeef",
        poster: "https://cdn.ufoload.com/i/signed-poster.jpg?sig=deadbeef",
        download: "https://cdn.ufoload.com/d/signed.mp4?sig=deadbeef",
        expiresAt: "2026-10-12T18:00:00Z",
      },
    });

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome.state).toBe("ready");
    const stored = db.videos[0];
    expect(stored.status).toBe("published");
    expect(stored.visibility).toBe("public");
    expect(stored.embed_url).toBe(`https://ufoload.com/e/${PUBLIC_ID}`);
    expect(stored.playable_url).toBe(`https://ufoload.com/v/${PUBLIC_ID}`);
    expect(String(stored.playable_url)).not.toContain("sig=");
    expect(String(stored.playable_url)).not.toMatch(/m3u8/);
    // …and it is deliberately never consulted: the signed poster expires, while
    // the stable `file.poster` does not.
    expect(stub.getFileWithLinks).not.toHaveBeenCalled();
    expect(stored.thumbnail_url).toBe("https://ufoload.com/i/pp/poster.jpg");
    expect(db.upload_jobs[0]).toMatchObject({ provider_file_id: FILE_ULID, status: "completed" });
  });

  it("keeps the admin's thumbnail when the video already has one", async () => {
    const { client, db, video, job } = seeded();
    video.thumbnail_url = "https://cdn.example.com/thumb.jpg";
    job.provider_import_id = "imp_1";
    const stub = stubProvider();
    stub.findImport.mockResolvedValue(importFixture({ status: "done", fileId: FILE_ULID }));
    stub.getFile.mockResolvedValue(fileFixture({ status: "ready" }));

    await reconcileUfoloadRecord({ service: client as never, userId: ADMIN_ID, provider: stub.provider, video, job });
    expect(db.videos[0].thumbnail_url).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("fails the record when the import task reports an error", async () => {
    const { client, db, video, job } = seeded();
    job.provider_import_id = "imp_1";
    const stub = stubProvider();
    stub.findImport.mockResolvedValue(importFixture({ status: "failed", error: "source returned 404" }));

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome).toEqual({ state: "failed", error: "source returned 404" });
    expect(db.videos[0]).toMatchObject({ status: "draft", provider_error: "source returned 404" });
    expect(db.upload_jobs[0].status).toBe("failed");
  });

  it("waits for a task the provider has not listed yet, but not forever", async () => {
    const { client, db, video, job } = seeded();
    job.provider_import_id = "imp_1";
    const stub = stubProvider();
    stub.findImport.mockResolvedValue(null);

    const fresh = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });
    expect(fresh).toMatchObject({ state: "processing" });
    expect(db.videos[0].status).toBe("processing");

    // A task that vanished beyond the documented grace window is a failure the
    // admin has to know about, not an eternal "processing".
    job.created_at = new Date(Date.now() - IMPORT_TRACKING_GRACE_MS - 60_000).toISOString();
    const stale = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });
    expect(stale).toMatchObject({ state: "failed" });
    expect(db.videos[0].status).toBe("draft");
  });

  it("records provider progress while a direct upload is still encoding", async () => {
    const { client, db, video, job } = seeded();
    video.provider_file_id = FILE_ULID;
    job.provider_file_id = FILE_ULID;
    const stub = stubProvider();
    stub.getFile.mockResolvedValue(fileFixture({ status: "processing", progress: 130 }));

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome).toMatchObject({ state: "processing" });
    expect(db.videos[0].status).toBe("processing");
    // Clamped: an encoding bar can never claim the file is finished.
    expect(db.videos[0].provider_progress).toBe(99);
    expect(db.upload_jobs[0].provider_status).toBe("processing");
  });

  it("promotes a record whose file finished encoding", async () => {
    const { client, db, video, job } = seeded();
    video.provider_file_id = FILE_ULID;
    job.provider_file_id = FILE_ULID;
    const stub = stubProvider();
    stub.getFile.mockResolvedValue(fileFixture({ status: "ready", progress: 100 }));

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome).toMatchObject({ state: "ready" });
    expect(db.videos[0]).toMatchObject({ status: "published", visibility: "public", provider_progress: 100 });
  });

  it("fails a direct upload the provider could not process", async () => {
    const { client, db, video, job } = seeded();
    video.provider_file_id = FILE_ULID;
    const stub = stubProvider();
    stub.getFile.mockResolvedValue(fileFixture({ status: "failed", error: "audio track missing" }));

    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });

    expect(outcome).toMatchObject({ state: "failed", error: "audio track missing" });
    expect(db.videos[0]).toMatchObject({ status: "draft", provider_error: "audio track missing" });
  });

  it("says what it is waiting for when no provider identifier exists yet", async () => {
    const { client, video, job } = seeded();
    const stub = stubProvider();
    const outcome = await reconcileUfoloadRecord({
      service: client as never,
      userId: ADMIN_ID,
      provider: stub.provider,
      video,
      job,
    });
    expect(outcome).toMatchObject({ state: "processing" });
    expect(outcome.state === "processing" && outcome.note).toMatch(/waiting for an upload session/i);
    expect(stub.getFile).not.toHaveBeenCalled();
  });
});
