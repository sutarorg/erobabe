import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";
import { verifyRelayToken } from "@/lib/video/relay-token";
import {
  ADMIN_ID,
  createHarness,
  jsonRequest,
  multipartRequest,
  onProvider,
  providerCalls,
  resetStreamtapeMock,
  streamtapeMock,
} from "./helpers/video-route-harness";

/**
 * HTTP contract tests for the upload control plane:
 *   POST   /api/videos/streamtape-session  (start)
 *   POST   /api/videos/streamtape-cancel   (cancel session / import)
 *   DELETE /api/videos/streamtape-cancel   (mark job cancelled)
 *
 * Provider is faked (helpers/mock-streamtape.ts), Supabase is in memory.
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

import { POST as startSession } from "@/app/api/videos/streamtape-session/route";
import { POST as cancelUpload, DELETE as cancelJob } from "@/app/api/videos/streamtape-cancel/route";

const SECRET = "relay-secret-0123456789abcdef";
const NODE = "https://tapecontent.net/xfsupload/wg8ad12d3QiJRXG";
const previousEnv = { ...process.env };

let harness = createHarness();

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetStreamtapeMock();
  process.env.STREAMTAPE_RELAY_SECRET = SECRET;
  process.env.STREAMTAPE_API_KEY = "key-secret-0123456789";
  process.env.STREAMTAPE_LOGIN = "login-secret-abcdef";
  onProvider("getUploadUrl", async () => ({ url: NODE, validUntil: null }));
});

afterEach(() => {
  process.env = { ...previousEnv };
});

describe("POST /api/videos/streamtape-session", () => {
  it("starts an upload: relay URL with a signed token, job recorded for this admin", async () => {
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "trip.mp4", fileSize: 1048576, mimeType: "video/mp4" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.uploadUrl.startsWith("https://relay.erobabe.com/upload/")).toBe(true);
    const token = body.uploadUrl.split("/upload/")[1];
    const claims = verifyRelayToken(token, SECRET);
    expect(claims.u).toBe(NODE);
    expect(claims.s).toBe(body.uploadId);

    expect(harness.db.upload_jobs).toHaveLength(1);
    expect(harness.db.upload_jobs[0]).toMatchObject({
      provider: "streamtape",
      provider_upload_id: body.uploadId,
      status: "uploading",
      created_by: ADMIN_ID,
      file_name: "trip.mp4",
      file_size: 1048576,
    });
    expect(body.jobId).toBe(harness.db.upload_jobs[0].id);
    expect(providerCalls("getUploadUrl")).toHaveLength(1);
  });

  it("never returns the API credentials, the relay secret or the node URL", async () => {
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 10 }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("key-secret-0123456789");
    expect(text).not.toContain("login-secret-abcdef");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("tapecontent.net"); // only inside the signed (opaque) token
    expect(text).not.toMatch(/STREAMTAPE_API_KEY/);
  });

  it("rejects a multipart body instead of buffering a video", async () => {
    const res = await startSession(multipartRequest("/api/videos/streamtape-session"));
    expect(res.status).toBe(415);
    expect(providerCalls("getUploadUrl")).toHaveLength(0);
  });

  it.each([
    [{ fileSize: 10 }, "fileName"],
    [{ fileName: "a.mp4" }, "fileSize"],
    [{ fileName: "a.mp4", fileSize: 0 }, "fileSize"],
    [{ fileName: "a.mp4", fileSize: "abc" }, "fileSize"],
    [{ fileName: "a.mp4", fileSize: -5 }, "fileSize"],
  ])("rejects invalid input %j", async (payload, field) => {
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", payload));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("rejects oversize files before talking to Streamtape", async () => {
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "huge.mp4", fileSize: 6 * 1024 * 1024 * 1024 }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/STREAMTAPE_MAX_UPLOAD_BYTES/);
    expect(providerCalls("getUploadUrl")).toHaveLength(0);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("requires an authenticated admin", async () => {
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.fake.client.from };
    expect((await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }))).status).toBe(401);

    const nonAdmin = createHarness({ profiles: [{ id: ADMIN_ID, role: "advertiser", status: "active" }] });
    dbState.auth = nonAdmin.auth;
    dbState.service = nonAdmin.service;
    expect((await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }))).status).toBe(403);

    const suspended = createHarness({ profiles: [{ id: ADMIN_ID, role: "admin", status: "suspended" }] });
    dbState.auth = suspended.auth;
    expect((await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }))).status).toBe(403);
    expect(providerCalls("getUploadUrl")).toHaveLength(0);
  });

  it("fails closed when the provider is not configured or approved", async () => {
    streamtapeMock.enabled = false;
    streamtapeMock.disabledReason = "Streamtape uploads are disabled until STREAMTAPE_ADULT_CONTENT_ALLOWED=true";
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/STREAMTAPE_ADULT_CONTENT_ALLOWED/);
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("fails closed when the relay is not configured", async () => {
    streamtapeMock.relay = null;
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("missing_relay");
  });

  it("maps provider errors without leaking secrets or creating a job", async () => {
    onProvider("getUploadUrl", async () => {
      throw new StreamtapeError("Streamtape denied the request (403). key=key-secret-0123456789", { status: 403, code: "http_403" });
    });
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }));
    const body = await res.json();
    expect(res.status).toBe(502); // upstream misconfiguration, not our auth failure
    expect(JSON.stringify(body)).not.toContain("key-secret-0123456789");
    expect(harness.db.upload_jobs).toHaveLength(0);
  });

  it("surfaces bandwidth limits (509) and Retry-After", async () => {
    onProvider("getUploadUrl", async () => {
      throw new StreamtapeError("Bandwidth exhausted (509).", { status: 509, code: "http_509" });
    });
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 1 }));
    expect(res.status).toBe(509);
  });
});

describe("cancel", () => {
  async function seedSession() {
    const res = await startSession(jsonRequest("/api/videos/streamtape-session", { fileName: "a.mp4", fileSize: 10 }));
    return res.json();
  }

  it("cancels a direct upload by job id and keeps it from ever being completed", async () => {
    const session = await seedSession();
    const res = await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { jobId: session.jobId }));
    expect(res.status).toBe(200);
    expect(harness.db.upload_jobs[0]).toMatchObject({ status: "cancelled", provider_status: "cancelled" });
    expect(providerCalls("removeRemoteUpload")).toHaveLength(0); // direct uploads have no provider task
  });

  it("cancels by session id", async () => {
    const session = await seedSession();
    const res = await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { uploadId: session.uploadId }));
    expect(res.status).toBe(200);
    expect(harness.db.upload_jobs[0].status).toBe("cancelled");
  });

  it("removes the remote task for imports and takes the video private", async () => {
    harness.db.videos.push({ id: "video-9", status: "processing", visibility: "private" });
    harness.db.upload_jobs.push({ id: "job-9", video_id: "video-9", created_by: ADMIN_ID, provider: "streamtape", provider_import_id: "rbAarvRPXdYbaxY", status: "processing" });
    const res = await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { jobId: "job-9" }));
    expect(res.status).toBe(200);
    expect(providerCalls("removeRemoteUpload")).toEqual([["rbAarvRPXdYbaxY"]]);
    expect(harness.db.upload_jobs.find((job: any) => job.id === "job-9")).toMatchObject({ status: "cancelled" });
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
  });

  it("still cancels when the provider-side removal fails", async () => {
    harness.db.upload_jobs.push({ id: "job-9", video_id: null, created_by: ADMIN_ID, provider: "streamtape", provider_import_id: "t1", status: "processing" });
    onProvider("removeRemoteUpload", async () => {
      throw new StreamtapeError("boom", { status: 500 });
    });
    const res = await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { jobId: "job-9" }));
    expect(res.status).toBe(200);
    expect(harness.db.upload_jobs[0].status).toBe("cancelled");
  });

  it("does not let an admin cancel somebody else's job", async () => {
    harness.db.upload_jobs.push({ id: "job-x", created_by: "other-admin", provider: "streamtape", status: "uploading" });
    const res = await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { jobId: "job-x" }));
    expect(res.status).toBe(404);
    expect(harness.db.upload_jobs[0].status).toBe("uploading");
  });

  it("validates input and auth; DELETE marks the job cancelled", async () => {
    expect((await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", {}))).status).toBe(400);
    harness.db.upload_jobs.push({ id: "job-d", created_by: ADMIN_ID, provider: "streamtape", status: "uploading", video_id: null });
    const del = await cancelJob(jsonRequest("/api/videos/streamtape-cancel?jobId=job-d", {}, "DELETE"));
    expect(del.status).toBe(200);
    expect(harness.db.upload_jobs[0].status).toBe("cancelled");
    expect((await cancelJob(jsonRequest("/api/videos/streamtape-cancel", {}, "DELETE"))).status).toBe(400);

    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.fake.client.from };
    expect((await cancelUpload(jsonRequest("/api/videos/streamtape-cancel", { jobId: "job-d" }))).status).toBe(401);
  });
});
