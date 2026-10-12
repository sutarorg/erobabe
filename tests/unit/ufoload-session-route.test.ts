import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import { MAX_VIDEO_SIZE } from "@/lib/video/storage";
import {
  ADMIN_ID,
  createHarness,
  jsonRequest,
  multipartRequest,
  onProvider,
  providerCalls,
  resetUfoloadMock,
  ufoloadMock,
} from "./helpers/video-route-harness";

/**
 * HTTP contract tests for the UFOLOAD direct-upload control plane:
 *   POST /api/videos/ufoload-session   (start / keep-alive)
 *   POST /api/videos/ufoload-cancel    (cancel at the provider)
 *   DELETE /api/videos/ufoload-cancel  (mark the stored job cancelled)
 *
 * The provider module is faked (see helpers/mock-ufoload.ts) and Supabase is in
 * memory, so these tests are about the guarantees the routes make to the admin
 * page and to the provider — not about UFOLOAD's own network behaviour.
 */

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

import { POST as startSession } from "@/app/api/videos/ufoload-session/route";
import { POST as cancelUpload, DELETE as cancelJob } from "@/app/api/videos/ufoload-cancel/route";

const GRANT = {
  uploadId: "upl_01HZX8J9K2N7T4Q1",
  url: "https://upload.ufoload.com/17/_node/v1/ingest/upl_01HZX8J9K2N7T4Q1",
  authorization: "UfoGrant 5f2c1e...",
  chunkSize: 8388608,
  maxBytes: 2147483648,
  expiresAt: "2026-10-12T14:00:00.000Z",
};

let harness = createHarness();

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetUfoloadMock();
});

describe("POST /api/videos/ufoload-session", () => {
  it("starts a direct upload and records the session for this admin", async () => {
    onProvider("initDirectUpload", async () => GRANT);

    const res = await startSession(
      jsonRequest("/api/videos/ufoload-session", {
        fileName: "trip.mp4",
        fileSize: 1048576,
        mimeType: "video/mp4",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(providerCalls("initDirectUpload")).toEqual([
      [{ fileName: "trip.mp4", fileSize: 1048576, mimeType: "video/mp4" }],
    ]);
    expect(body).toMatchObject({
      uploadId: GRANT.uploadId,
      url: GRANT.url,
      authorization: GRANT.authorization,
      chunkSize: GRANT.chunkSize,
      maxBytes: GRANT.maxBytes,
      keepAliveIntervalMs: expect.any(Number),
      fileName: "trip.mp4",
      fileSize: 1048576,
    });
    // The completion route validates the job the server just created.
    expect(harness.db.upload_jobs).toHaveLength(1);
    expect(harness.db.upload_jobs[0]).toMatchObject({
      provider: "ufoload",
      provider_upload_id: GRANT.uploadId,
      status: "uploading",
      created_by: ADMIN_ID,
      file_name: "trip.mp4",
      file_size: 1048576,
    });
    expect(body.jobId).toBe(harness.db.upload_jobs[0].id);
  });

  it("never returns the server-side API key, only the upload grant", async () => {
    onProvider("initDirectUpload", async () => GRANT);
    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));

    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("ufo_test_key");
    expect(text).not.toMatch(/UFOLOAD_API_KEY/);
    expect(res.headers.get("authorization")).toBeNull();
    // The grant is upload-scoped material handed out by the provider itself.
    expect(JSON.parse(text).authorization).toBe(GRANT.authorization);
  });

  it("rejects a multipart body instead of buffering a video", async () => {
    const res = await startSession(multipartRequest("/api/videos/ufoload-session"));
    expect(res.status).toBe(415);
    expect((await res.json()).details).toMatch(/chunks/i);
    expect(providerCalls("initDirectUpload")).toHaveLength(0);
  });

  it("validates the file name and size before calling the provider", async () => {
    const missingName = await startSession(jsonRequest("/api/videos/ufoload-session", { fileSize: 10 }));
    expect(missingName.status).toBe(400);

    const missingSize = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4" }));
    expect(missingSize.status).toBe(400);

    const zeroSize = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 0 }));
    expect(zeroSize.status).toBe(400);

    expect(providerCalls("initDirectUpload")).toHaveLength(0);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("enforces the same 2 GB ceiling as the rest of the app", async () => {
    const res = await startSession(
      jsonRequest("/api/videos/ufoload-session", { fileName: "huge.mp4", fileSize: MAX_VIDEO_SIZE + 1 })
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/2 GB/);
    expect(providerCalls("initDirectUpload")).toHaveLength(0);
  });

  it("reports the provider's own plan limit as a 413 the admin can act on", async () => {
    // The provider refuses during initialization: no slot, no job.
    onProvider("initDirectUpload", async () => {
      throw new UfoloadError("This file is larger than the UFOLOAD upload limit for the account (10 GB).", {
        status: 413,
        code: "plan_file_too_large",
      });
    });

    const res = await startSession(
      jsonRequest("/api/videos/ufoload-session", { fileName: "big.mp4", fileSize: 1024 })
    );
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.code).toBe("plan_file_too_large");
    expect(body.error).toMatch(/UFOLOAD upload limit/i);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("refuses to guess when the provider is not approved yet", async () => {
    ufoloadMock.enabled = false;
    ufoloadMock.disabledReason = "Set UFOLOAD_ADULT_CONTENT_APPROVED=true after written confirmation.";

    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/UFOLOAD_ADULT_CONTENT_APPROVED/);
    expect(providerCalls("initDirectUpload")).toHaveLength(0);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("requires an active admin", async () => {
    const adminAuth = harness.auth;
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: adminAuth.from };
    const anonymous = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    expect(anonymous.status).toBe(401);

    dbState.auth = adminAuth;
    harness.db.profiles[0].role = "viewer";
    const viewer = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    expect(viewer.status).toBe(403);

    // An admin whose account is not active is refused as well.
    harness.db.profiles[0].role = "admin";
    harness.db.profiles[0].status = "suspended";
    const suspended = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    expect(suspended.status).toBe(403);

    expect(providerCalls("initDirectUpload")).toHaveLength(0);
  });

  it("keeps the concurrency slot alive when the browser posts an existing uploadId", async () => {
    onProvider("getUploadState", async () => ({ state: "pending", fileId: null }));

    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { uploadId: GRANT.uploadId }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(providerCalls("getUploadState")).toEqual([[GRANT.uploadId]]);
    expect(body).toMatchObject({ uploadId: GRANT.uploadId, state: "pending", keepAlive: true });
    expect(body.nextKeepAliveMs).toBeGreaterThan(0);
    // A keep-alive is not a new upload.
    expect(providerCalls("initDirectUpload")).toHaveLength(0);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("passes the terminal upload state through instead of inventing one", async () => {
    onProvider("getUploadState", async () => ({ state: "completed", fileId: "01J6FSPD0S1N7M4HP2Y7Z1B5GE" }));
    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { uploadId: "upl_1" }));
    expect(await res.json()).toMatchObject({ state: "completed", fileId: "01J6FSPD0S1N7M4HP2Y7Z1B5GE" });
  });

  it("surfaces a rate-limit answer with the retry delay", async () => {
    onProvider("initDirectUpload", async () => {
      const error = new UfoloadError("UFOLOAD is rate-limiting this account.", { status: 429, code: "rate_limited" });
      error.retryAfterSeconds = 30;
      throw error;
    });

    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toMatch(/Retry in about 30s/);
  });

  it("maps an upstream auth failure to a configuration error, not an admin logout", async () => {
    // A 401 from UFOLOAD means *our* key is wrong; the admin's session is fine.
    onProvider("initDirectUpload", async () => {
      throw new UfoloadError("The UFOLOAD API key was rejected. Update UFOLOAD_API_KEY.", { status: 401 });
    });

    const res = await startSession(jsonRequest("/api/videos/ufoload-session", { fileName: "a.mp4", fileSize: 10 }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/UFOLOAD_API_KEY/);
  });
});

describe("POST /api/videos/ufoload-cancel", () => {
  it("cancels the provider-side upload and frees the slot", async () => {
    const res = await cancelUpload(jsonRequest("/api/videos/ufoload-cancel", { uploadId: GRANT.uploadId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadId: GRANT.uploadId, cancelled: true, state: "aborted" });
    expect(providerCalls("cancelDirectUpload")).toEqual([[GRANT.uploadId]]);
  });

  it("treats an upload that already finished as gone, not as an error", async () => {
    onProvider("cancelDirectUpload", async () => false);
    const res = await cancelUpload(jsonRequest("/api/videos/ufoload-cancel", { uploadId: "upl_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadId: "upl_1", cancelled: false, state: "already-gone" });
  });

  it("requires an uploadId and an admin", async () => {
    expect((await cancelUpload(jsonRequest("/api/videos/ufoload-cancel", {}))).status).toBe(400);

    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.auth.from };
    expect((await cancelUpload(jsonRequest("/api/videos/ufoload-cancel", { uploadId: "upl_1" }))).status).toBe(401);
    expect(providerCalls("cancelDirectUpload")).toHaveLength(0);
  });
});

describe("DELETE /api/videos/ufoload-cancel", () => {
  it("marks the stored job cancelled", async () => {
    harness.db.upload_jobs.push({
      id: "job-1",
      provider: "ufoload",
      provider_upload_id: GRANT.uploadId,
      status: "uploading",
      file_name: "trip.mp4",
    });

    const res = await cancelJob(
      new NextRequest("http://localhost/api/videos/ufoload-cancel?jobId=job-1", { method: "DELETE" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-1", status: "cancelled" });
    expect(harness.db.upload_jobs[0].status).toBe("cancelled");
  });

  it("requires a jobId", async () => {
    const res = await cancelJob(new NextRequest("http://localhost/api/videos/ufoload-cancel", { method: "DELETE" }));
    expect(res.status).toBe(400);
  });
});
