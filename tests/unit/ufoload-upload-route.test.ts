import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestedMetadata } from "@/lib/gemini/client";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import {
  ADMIN_ID,
  CATEGORY_ID,
  createHarness,
  jsonRequest,
  multipartRequest,
  onProvider,
  providerCalls,
  resetUfoloadMock,
  ufoloadMock,
} from "./helpers/video-route-harness";

/**
 * Tests for `POST /api/videos/upload` — the completion step of a UFOLOAD direct
 * upload.
 *
 * The rules under test are the ones the migration promised:
 *   - the browser sends a *session* id, never a provider file id;
 *   - the video row stays private until UFOLOAD reports the file as `ready`;
 *   - metadata is generated once (or reused), and no secret reaches the client.
 */

const geminiState = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  const suggestion: SuggestedMetadata = {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["boudoir", "cinematic"],
    category: "Boudoir",
    reasoning: "AI suggestion",
  };
  return {
    ...actual,
    suggestVideoMetadata: async () => {
      geminiState.calls += 1;
      return suggestion;
    },
  };
});

const dbState = vi.hoisted(() => ({ auth: null as unknown, service: null as unknown }));

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

import { POST as completeUpload } from "@/app/api/videos/upload/route";

const UPLOAD_ID = "upl_01HZX8J9K2N7T4Q1";
const FILE_ULID = "01J6FSPD0S1N7M4HP2Y7Z1B5GE";
const PUBLIC_ID = "aBcD1234xyz";

const PREPARED = {
  title: "Evening in Velvet",
  description: "An elegant, slow-paced portrait captured in soft cinematic light.",
  tags: ["boudoir", "cinematic"],
  source: "ai" as const,
};

function fileFixture(overrides: Record<string, unknown> = {}) {
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

let harness = createHarness();

/** A job row as `/api/videos/ufoload-session` would have created it. */
function seedSession(overrides: Record<string, unknown> = {}) {
  harness.db.upload_jobs.push({
    id: "job-1",
    video_id: null,
    provider: "ufoload",
    provider_upload_id: UPLOAD_ID,
    file_name: "clip.mp4",
    file_size: 1048576,
    status: "uploading",
    progress: 0,
    created_by: ADMIN_ID,
    ...overrides,
  });
}

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetUfoloadMock();
  geminiState.calls = 0;
});

describe("POST /api/videos/upload", () => {
  it("completes the upload, keeps the video private while UFOLOAD encodes, and stores the provider ids", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "processing", progress: 37 }));

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        fileSize: 1048576,
        metadata: PREPARED,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(providerCalls("completeDirectUpload")[0][0]).toBe(UPLOAD_ID);
    expect(body).toMatchObject({
      videoId: expect.any(String),
      jobId: "job-1",
      providerFileId: FILE_ULID,
      providerPublicId: PUBLIC_ID,
      providerStatus: "processing",
      status: "processing",
      processing: true,
      progress: 37,
      metadataSource: "ai",
      embedUrl: `https://ufoload.com/e/${PUBLIC_ID}`,
      playableUrl: `https://ufoload.com/v/${PUBLIC_ID}`,
    });

    const video = harness.db.videos[0];
    expect(video).toMatchObject({
      provider: "ufoload",
      provider_file_id: FILE_ULID,
      provider_public_id: PUBLIC_ID,
      status: "processing",
      visibility: "private",
      provider_progress: 37,
    });
    // Nothing unplayable is on the public site yet.
    expect(video.published_at).toBeUndefined();
    expect(harness.db.upload_jobs[0]).toMatchObject({ status: "processing", provider_status: "processing" });
    // The prepared metadata was reused: no second Gemini call after the upload.
    expect(geminiState.calls).toBe(0);
  });

  it("publishes immediately when the provider already reports the file as ready", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "ready" }));

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: PREPARED,
      })
    );
    const body = await res.json();

    expect(body.status).toBe("ready");
    expect(body.processing).toBe(false);

    const video = harness.db.videos[0];
    expect(video).toMatchObject({
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      embed_url: `https://ufoload.com/e/${PUBLIC_ID}`,
      playable_url: `https://ufoload.com/v/${PUBLIC_ID}`,
      provider_progress: 100,
    });
    expect(video.published_at).toBeTruthy();
    expect(String(video.playable_url)).not.toContain("sig=");
  });

  it("refuses a provider file id supplied by the browser", async () => {
    seedSession();
    for (const key of ["providerFileId", "filecode", "file_code"]) {
      const res = await completeUpload(
        jsonRequest("/api/videos/upload", {
          uploadId: UPLOAD_ID,
          categoryId: CATEGORY_ID,
          fileName: "clip.mp4",
          [key]: "attacker-supplied",
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not accepted from the browser/i);
    }
    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("rejects multipart bodies so video bytes never transit the app", async () => {
    const res = await completeUpload(multipartRequest("/api/videos/upload"));
    expect(res.status).toBe(415);
    expect((await res.json()).details).toMatch(/uploadId/);
    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
  });

  it("requires the upload session and a category", async () => {
    seedSession();
    const noUpload = await completeUpload(
      jsonRequest("/api/videos/upload", { categoryId: CATEGORY_ID, fileName: "clip.mp4" })
    );
    expect(noUpload.status).toBe(400);
    expect((await noUpload.json()).error).toMatch(/uploadId is required/);

    const noCategory = await completeUpload(
      jsonRequest("/api/videos/upload", { uploadId: UPLOAD_ID, fileName: "clip.mp4" })
    );
    expect(noCategory.status).toBe(400);
    expect((await noCategory.json()).error).toMatch(/category/i);

    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
  });

  it("refuses a session that belongs to another admin", async () => {
    seedSession({ created_by: "someone-else" });
    onProvider("completeDirectUpload", async () => fileFixture());

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: PREPARED,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/does not belong to your account/i);
    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("refuses an uploadId that was never registered", async () => {
    onProvider("completeDirectUpload", async () => fileFixture());
    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: "upl_made_up",
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: PREPARED,
      })
    );
    expect(res.status).toBe(404);
    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
  });

  it("keeps the row private and reports the provider's refusal when completion fails", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => {
      throw new UfoloadError("UFOLOAD is busy with this upload. Retrying in a moment.", {
        status: 409,
        code: "upload_busy",
      });
    });

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: PREPARED,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("upload_busy");
    expect(body.error).toMatch(/busy with this upload/i);
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(harness.db.videos[0].provider_error).toMatch(/busy/i);
    expect(harness.db.upload_jobs[0].status).toBe("failed");
  });

  it("fails closed when the provider is not configured", async () => {
    seedSession();
    ufoloadMock.enabled = false;
    ufoloadMock.disabledReason = "Set UFOLOAD_API_KEY (server-only) to the API key from the UFOLOAD dashboard.";

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: PREPARED,
      })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/UFOLOAD_API_KEY/);
    expect(providerCalls("completeDirectUpload")).toHaveLength(0);
  });

  it("uses a thumbnail the admin uploaded and refuses one from another account", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "ready" }));

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        thumbnailPath: `${ADMIN_ID}/cover.jpg`,
        metadata: PREPARED,
      })
    );
    expect(res.status).toBe(200);
    expect(harness.db.videos[0].thumbnail_url).toBe(
      `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/cover.jpg`
    );

    harness.db.videos.length = 0;
    harness.db.upload_jobs.length = 0;
    seedSession();
    const foreign = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        thumbnailPath: "someone-else/cover.jpg",
        metadata: PREPARED,
      })
    );
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toMatch(/not a valid upload for this account/i);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("writes an audit entry that names the provider and never the key", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "ready" }));

    await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        fileSize: 1048576,
        metadata: PREPARED,
      })
    );

    expect(harness.db.audit_logs).toHaveLength(1);
    const entry = harness.db.audit_logs[0];
    expect(entry).toMatchObject({ actor_id: ADMIN_ID, action: "video_published_from_upload", level: "info" });
    expect(entry.metadata).toMatchObject({
      provider: "ufoload",
      provider_file_id: FILE_ULID,
      provider_status: "ready",
      file_name: "clip.mp4",
    });
    expect(JSON.stringify(entry)).not.toContain("ufo_test_key");
  });

  it("generates metadata when the page could not prepare it, and reports the source", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "ready" }));
    geminiState.calls = 0;

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(geminiState.calls).toBe(1);
    expect(body.metadataSource).toBe("ai");
    expect(body.metadata.title).toBe("Evening in Velvet");
  });

  it("passes a metadata warning through so the admin reviews the title", async () => {
    seedSession();
    onProvider("completeDirectUpload", async () => fileFixture({ status: "ready" }));

    const res = await completeUpload(
      jsonRequest("/api/videos/upload", {
        uploadId: UPLOAD_ID,
        categoryId: CATEGORY_ID,
        fileName: "clip.mp4",
        metadata: {
          ...PREPARED,
          source: "fallback",
          warning: "AI metadata unavailable. File-name metadata was used instead.",
        },
      })
    );
    const body = await res.json();
    expect(body.metadataSource).toBe("fallback");
    // Passed through verbatim so the admin page can show the reason to review.
    expect(body.metadataWarning).toBe("AI metadata unavailable. File-name metadata was used instead.");
  });
});
