import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SuggestedMetadata } from "@/lib/gemini/client";
import { TEST_API_KEY, createFakeUfoload, type FakeUfoload } from "./helpers/fake-ufoload";
import { ADMIN_ID, CATEGORY_ID, OTHER_ADMIN_ID, createVideoHarness, jsonRequest, type VideoHarness } from "./helpers/video-harness";

/**
 * Route tests for the UFOLOAD upload flow: authorization, validation, the
 * direct-upload session/registration pair, the async import route, status
 * polling and the reconcile route. Supabase is an in-memory fake and UFOLOAD is
 * the contract mock in helpers/fake-ufoload.ts, so these prove the app's own
 * rules — they do not prove a real upload works (see the live smoke test).
 */

const state = vi.hoisted(() => ({ auth: null as any, service: null as any }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.auth,
  createServiceClient: () => state.service,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  const suggestion: SuggestedMetadata = {
    title: "Velvet Evening",
    description: "A calm portrait in soft light.",
    tags: ["mature", "portrait"],
    category: "Mature",
    reasoning: "AI-generated suggestion, requires human review",
  };
  return { ...actual, suggestVideoMetadata: async () => suggestion };
});

import { POST as sessionPost, GET as sessionGet, DELETE as sessionDelete } from "@/app/api/videos/ufoload-session/route";
import { POST as registerPost } from "@/app/api/videos/upload/route";
import { POST as importPost } from "@/app/api/videos/upload-url/route";
import { GET as statusGet } from "@/app/api/videos/status/route";
import { GET as reconcileGet, POST as reconcilePost } from "@/app/api/videos/reconcile/route";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const BASE = "https://erobabe.example";
const CRON_SECRET = "a-long-random-cron-secret-0123456789";

let h: VideoHarness;
let ufo: FakeUfoload;

function install(harness: VideoHarness = createVideoHarness()) {
  h = harness;
  state.auth = h.auth;
  state.service = h.service;
}

beforeEach(() => {
  vi.stubEnv("VIDEO_PROVIDER", "ufoload");
  vi.stubEnv("UFOLOAD_API_KEY", TEST_API_KEY);
  vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "true");
  vi.stubEnv("CRON_SECRET", "");
  ufo = createFakeUfoload();
  vi.stubGlobal("fetch", ufo.fetch);
  install();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  fileName: "clip.mp4",
  fileSize: 5 * MiB,
  mimeType: "video/mp4",
  categoryId: CATEGORY_ID,
  ...overrides,
});

const startSession = (overrides: Record<string, unknown> = {}) =>
  sessionPost(jsonRequest(`${BASE}/api/videos/ufoload-session`, { body: sessionBody(overrides) }));

async function openSession(overrides: Record<string, unknown> = {}) {
  const response = await startSession(overrides);
  expect(response.status).toBe(200);
  return (await response.json()) as { jobId: string; uploadId: string; uploadUrl: string; authorization: string };
}

const register = (body: Record<string, unknown>) => registerPost(jsonRequest(`${BASE}/api/videos/upload`, { body }));
const startImport = (body: Record<string, unknown>) => importPost(jsonRequest(`${BASE}/api/videos/upload-url`, { body }));

describe("authorization — nothing reaches UFOLOAD without an active admin", () => {
  const cases: Array<[string, () => VideoHarness]> = [
    ["an anonymous visitor", () => createVideoHarness({ user: null })],
    ["a signed-in non-admin", () => createVideoHarness({ profile: { id: ADMIN_ID, role: "advertiser", status: "active" } })],
    ["a suspended admin", () => createVideoHarness({ profile: { id: ADMIN_ID, role: "admin", status: "suspended" } })],
    ["an admin with no profile row", () => createVideoHarness({ profile: null })],
  ];

  const routes: Array<[string, () => Promise<Response>, number]> = [
    ["session POST", () => startSession(), 0],
    ["session GET", () => sessionGet(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=job-1`)), 0],
    ["session DELETE", () => sessionDelete(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=job-1`, { method: "DELETE" })), 0],
    ["register POST", () => register({ jobId: "job-1", categoryId: CATEGORY_ID }), 0],
    ["import POST", () => startImport({ categoryId: CATEGORY_ID, entries: [{ url: "https://cdn.example.com/a.mp4" }] }), 0],
    ["status GET", () => statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=job-1`)), 0],
    ["reconcile POST", () => reconcilePost(jsonRequest(`${BASE}/api/videos/reconcile`, { body: {} })), 0],
    ["reconcile GET", () => reconcileGet(jsonRequest(`${BASE}/api/videos/reconcile`)), 0],
  ];

  for (const [who, make] of cases) {
    for (const [route, call] of routes) {
      it(`${route} refuses ${who} and never calls UFOLOAD`, async () => {
        install(make());
        const response = await call();
        expect([401, 403]).toContain(response.status);
        expect(response.status).toBe(who === "an anonymous visitor" ? 401 : 403);
        expect(ufo.fetchMock).not.toHaveBeenCalled();
        expect(h.jobs()).toHaveLength(0);
        expect(h.videos()).toHaveLength(0);
      });
    }
  }
});

describe("POST /api/videos/ufoload-session", () => {
  it("initialises the upload with the server-side key and returns only what the browser needs", async () => {
    const response = await startSession();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["authorization", "chunkSize", "expiresAt", "jobId", "maxBytes", "uploadId", "uploadUrl"]);
    expect(body.uploadUrl).toBe(`https://upload.ufoload.com/07/_node/v1/ingest/${body.uploadId}`);
    expect(body.authorization).toBe(`UfoGrant grant_${body.uploadId}`);
    expect(body.chunkSize).toBeGreaterThan(0);
    expect(body.maxBytes).toBeGreaterThanOrEqual(5 * MiB);
    expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);

    expect(ufo.calls).toHaveLength(1);
    expect(ufo.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/files/uploads",
      body: { filename: "clip.mp4", size: 5 * MiB, mime_type: "video/mp4" },
    });
    expect(ufo.calls[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it("records the session as an upload job owned by the admin — and no video yet", async () => {
    const body = await openSession();
    expect(h.jobs()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({
      id: body.jobId,
      provider: "ufoload",
      status: "uploading",
      provider_upload_id: body.uploadId,
      file_name: "clip.mp4",
      file_size: 5 * MiB,
      created_by: ADMIN_ID,
      video_id: null,
    });
    expect(h.jobs()[0].provider_file_id).toBeUndefined();
    expect(h.videos()).toHaveLength(0);
  });

  it("keeps the 2 GB limit: 2 GB is accepted, one byte more is refused before UFOLOAD is contacted", async () => {
    const ok = await startSession({ fileSize: 2 * GiB });
    expect(ok.status).toBe(200);

    ufo.calls.length = 0;
    const tooBig = await startSession({ fileSize: 2 * GiB + 1 });
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error).toMatch(/too large \(max 2 GB\)/);
    expect(ufo.calls).toHaveLength(0);
  });

  it.each([0, -5, 1.5, Number.NaN, "abc", null])("rejects the file size %j", async (fileSize) => {
    const response = await startSession({ fileSize });
    expect(response.status).toBe(400);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects something that is not a video", async () => {
    const response = await startSession({ fileName: "notes.pdf", mimeType: "application/pdf" });
    expect(response.status).toBe(400);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a video whose browser MIME type is empty but whose extension is a video one", async () => {
    expect((await startSession({ fileName: "clip.mkv", mimeType: "" })).status).toBe(200);
  });

  it("requires a real category before any byte is sent", async () => {
    expect((await startSession({ categoryId: "" })).status).toBe(400);
    const invalid = await startSession({ categoryId: "no-such-category" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("Choose a valid category");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(h.jobs()).toHaveLength(0);
  });

  it("ignores provider data the browser tries to supply", async () => {
    const body = await openSession({
      provider: "uqload",
      providerFileId: "EVIL",
      uploadId: "attacker-session",
      url: "https://attacker.example/ingest",
      serverUrl: "https://attacker.example/upload",
    });
    expect(body.uploadId).not.toBe("attacker-session");
    expect(body.uploadUrl).not.toContain("attacker");
    expect(h.jobs()[0].provider).toBe("ufoload");
    expect(h.jobs()[0].provider_upload_id).toBe(body.uploadId);
    expect(ufo.calls[0].body).toEqual({ filename: "clip.mp4", size: 5 * MiB, mime_type: "video/mp4" });
  });

  it("answers 503 with an actionable message when the adult-content approval is not recorded", async () => {
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "false");
    const response = await startSession();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("adult_content_not_approved");
    expect(body.details).toMatch(/written/i);
    expect(body.retryable).toBe(false);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(h.jobs()).toHaveLength(0);
  });

  it("answers 503 when the API key is missing", async () => {
    vi.stubEnv("UFOLOAD_API_KEY", "");
    const response = await startSession();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("api_key_missing");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown VIDEO_PROVIDER, and on the retired uqload value", async () => {
    vi.stubEnv("VIDEO_PROVIDER", "bunny");
    const unknown = await startSession();
    expect(unknown.status).toBe(503);
    expect((await unknown.json()).code).toBe("provider_unknown");

    vi.stubEnv("VIDEO_PROVIDER", "uqload");
    const legacy = await startSession();
    expect(legacy.status).toBe(503);
    expect((await legacy.json()).code).toBe("provider_legacy_unsupported");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("reports 503 direct_upload_unavailable clearly, with no fallback through our server", async () => {
    ufo.failNext("POST /files/uploads", ufo.error(503, "direct_upload_unavailable", "no node available", { "Retry-After": "45" }));
    const response = await startSession();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("45");
    const body = await response.json();
    expect(body).toMatchObject({ code: "direct_upload_unavailable", retryable: true });
    expect(body.error).toMatch(/direct upload is temporarily unavailable/);
    expect(body.error).toMatch(/does not fall back/);
    expect(h.jobs()).toHaveLength(0);
    // Exactly one provider call; the file is never offered a route through the server.
    expect(ufo.calls).toHaveLength(1);
  });

  it.each([
    [401, "provider_auth_failed", 503, "UFOLOAD_API_KEY"],
    [402, "payment_required", 402, "balance is negative"],
    [409, "conflict", 409, "storage"],
    [413, "payload_too_large", 413, "too large"],
    [429, "rate_limited", 429, "concurrent-upload limit"],
  ])("maps a UFOLOAD %i on init to %s (HTTP %i)", async (status, code, httpStatus, fragment) => {
    ufo.failNext("POST /files/uploads", ufo.error(status, "x", "details"));
    const response = await startSession();
    expect(response.status).toBe(httpStatus);
    const body = await response.json();
    expect(body.code).toBe(code);
    expect(body.error).toContain(fragment);
    expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);
    expect(h.jobs()).toHaveLength(0);
  });

  it("releases the UFOLOAD slot if the job cannot be saved", async () => {
    h.failInserts("upload_jobs");
    const response = await startSession();
    expect(response.status).toBe(500);
    const init = ufo.calls.find((call) => call.method === "POST");
    const uploadId = [...ufo.uploads.keys()][0];
    expect(init).toBeTruthy();
    expect(ufo.calls.some((call) => call.method === "DELETE" && call.path === `/api/v1/files/uploads/${uploadId}`)).toBe(true);
    expect(ufo.uploads.get(uploadId)?.state).toBe("aborted");
  });

  it("explains a database that has not had the UFOLOAD migration applied (PostgREST error objects, not Errors)", async () => {
    h.failInserts("upload_jobs", { code: "PGRST204", message: "Could not find the 'provider_upload_id' column of 'upload_jobs' in the schema cache" });
    const response = await startSession();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("migration_missing");
    expect(body.error).toMatch(/00000000000006_ufoload_video_provider\.sql/);
    expect(JSON.stringify(body)).not.toContain("PGRST204");
  });

  it("explains the provider check constraint of an un-migrated videos table when registering", async () => {
    const { jobId } = await openSession();
    h.failInserts("videos", { code: "23514", message: 'new row for relation "videos" violates check constraint "videos_provider_check"' });
    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("migration_missing");
  });

  it("surfaces other database errors with their own message (not a generic one)", async () => {
    h.failInserts("upload_jobs", { code: "XX000", message: "connection to the database was lost" });
    const response = await startSession();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("connection to the database was lost");
  });

  it("refuses a multipart body — video bytes never go through this route", async () => {
    const request = jsonRequest(`${BASE}/api/videos/ufoload-session`, { body: sessionBody(), headers: { "Content-Type": "multipart/form-data; boundary=x" } });
    expect((await sessionPost(request)).status).toBe(415);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET/DELETE /api/videos/ufoload-session (keep-alive and cancel)", () => {
  it("refreshes the upload slot through the server and records the activity", async () => {
    const { jobId, uploadId } = await openSession();
    ufo.calls.length = 0;
    const response = await sessionGet(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "pending", jobStatus: "uploading" });
    expect(ufo.calls).toHaveLength(1);
    expect(ufo.calls[0]).toMatchObject({ method: "GET", path: `/api/v1/files/uploads/${uploadId}` });
    expect(ufo.calls[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(h.jobs()[0].last_checked_at).toBeTruthy();
    expect(h.jobs()[0].provider_status).toBe("upload:pending");
  });

  it("closes the job when UFOLOAD says the session is gone", async () => {
    const { jobId, uploadId } = await openSession();
    ufo.uploads.get(uploadId)!.state = "aborted";
    const response = await sessionGet(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`));
    expect(await response.json()).toMatchObject({ state: "aborted", jobStatus: "cancelled" });
    expect(h.jobs()[0].status).toBe("cancelled");
  });

  it("does not reveal or touch another admin's session", async () => {
    const { jobId } = await openSession();
    state.auth = h.authFor(OTHER_ADMIN_ID);
    ufo.calls.length = 0;
    expect((await sessionGet(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`))).status).toBe(404);
    expect((await sessionDelete(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`, { method: "DELETE" }))).status).toBe(404);
    expect(ufo.calls).toHaveLength(0);
    expect(h.jobs()[0].status).toBe("uploading");
  });

  it("cancels at UFOLOAD and marks the job cancelled", async () => {
    const { jobId, uploadId } = await openSession();
    const response = await sessionDelete(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cancelled: true, jobStatus: "cancelled" });
    expect(ufo.uploads.get(uploadId)?.state).toBe("aborted");
    expect(h.jobs()[0]).toMatchObject({ status: "cancelled", error_message: expect.stringMatching(/Cancelled/) });
  });

  it("treats a session UFOLOAD already forgot as cancelled", async () => {
    const { jobId, uploadId } = await openSession();
    ufo.uploads.delete(uploadId);
    const response = await sessionDelete(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(h.jobs()[0].status).toBe("cancelled");
  });

  it("refuses to cancel an upload that has already been registered", async () => {
    const { jobId } = await openSession();
    expect((await register({ jobId, categoryId: CATEGORY_ID })).status).toBe(200);
    const response = await sessionDelete(jsonRequest(`${BASE}/api/videos/ufoload-session?jobId=${jobId}`, { method: "DELETE" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_completed");
  });

  it("requires a job id", async () => {
    expect((await sessionGet(jsonRequest(`${BASE}/api/videos/ufoload-session`))).status).toBe(400);
  });
});

describe("POST /api/videos/upload (complete and register)", () => {
  it("completes through UFOLOAD, persists UFOLOAD's file id and leaves the video private and processing", async () => {
    const { jobId, uploadId } = await openSession({ fileSize: 7 * MiB });
    ufo.calls.length = 0;

    const response = await register({ jobId, categoryId: CATEGORY_ID, fileName: "clip.mp4", fileSize: 1 });
    expect(response.status).toBe(200);
    const body = await response.json();

    // The completion call carries the size the SERVER recorded, not the browser's claim.
    const complete = ufo.calls.find((call) => call.path.endsWith("/complete"));
    expect(complete).toMatchObject({ method: "POST", path: `/api/v1/files/uploads/${uploadId}/complete`, body: { size: 7 * MiB } });
    expect(complete?.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);

    const fileId = [...ufo.files.keys()][0];
    expect(body).toMatchObject({ jobId, status: "processing", published: false, processing: true, providerStatus: "queued" });
    expect(body.metadataSource).toBe("ai");

    expect(h.videos()).toHaveLength(1);
    expect(h.videos()[0]).toMatchObject({
      provider: "ufoload",
      provider_file_id: fileId,
      status: "processing",
      visibility: "private",
      created_by: ADMIN_ID,
    });
    expect(h.videos()[0].embed_url).toBeFalsy();
    expect(h.videos()[0].playable_url).toBeFalsy();
    expect(h.videos()[0].published_at).toBeFalsy();

    expect(h.jobs()[0]).toMatchObject({ status: "processing", provider_file_id: fileId, video_id: h.videos()[0].id, provider_upload_id: uploadId });
  });

  it("does not publish — the public page cannot see the video until UFOLOAD reports it ready", async () => {
    const { jobId } = await openSession();
    await register({ jobId, categoryId: CATEGORY_ID });
    const video = h.videos()[0];
    // Exactly the public read policy: published + public.
    expect(video.status === "published" && video.visibility === "public").toBe(false);
  });

  it("ignores any provider file id, embed URL or provider name in the request body", async () => {
    const { jobId } = await openSession();
    const response = await register({
      jobId,
      categoryId: CATEGORY_ID,
      providerFileId: "EVIL-FILE-ID",
      file_code: "EVIL",
      filecode: "EVIL",
      embedUrl: "https://evil.example/e/xxxxxxxxxxx",
      playableUrl: "https://evil.example/video.mp4",
      provider: "uqload",
      status: "published",
      visibility: "public",
    });
    expect(response.status).toBe(200);

    const fileId = [...ufo.files.keys()][0];
    const video = h.videos()[0];
    expect(video.provider).toBe("ufoload");
    expect(video.provider_file_id).toBe(fileId);
    expect(video.status).toBe("processing");
    expect(video.visibility).toBe("private");
    expect(JSON.stringify(h.db)).not.toMatch(/EVIL|evil\.example/);
  });

  it("only lets the admin who started an upload complete it", async () => {
    const { jobId } = await openSession();
    state.auth = h.authFor(OTHER_ADMIN_ID);
    ufo.calls.length = 0;
    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(404);
    expect(ufo.calls).toHaveLength(0);
    expect(h.videos()).toHaveLength(0);
  });

  it("404s for an unknown job and 400s without one", async () => {
    expect((await register({ jobId: "nope", categoryId: CATEGORY_ID })).status).toBe(404);
    expect((await register({ categoryId: CATEGORY_ID })).status).toBe(400);
  });

  it("will not complete something that was not started as a direct upload", async () => {
    h.db.upload_jobs.push({ id: "import-job", provider: "ufoload", status: "uploading", created_by: ADMIN_ID, provider_import_task_id: "imp_1", file_name: "a.mp4" });
    const response = await register({ jobId: "import-job", categoryId: CATEGORY_ID });
    expect(response.status).toBe(409);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad category BEFORE completing, so the finished upload is not burned", async () => {
    const { jobId } = await openSession();
    ufo.calls.length = 0;
    const response = await register({ jobId, categoryId: "no-such-category" });
    expect(response.status).toBe(400);
    expect(ufo.calls.some((call) => call.path.endsWith("/complete"))).toBe(false);
    expect(h.jobs()[0].status).toBe("uploading");
    expect(h.videos()).toHaveLength(0);
  });

  it("refuses another admin's thumbnail path", async () => {
    const { jobId } = await openSession();
    ufo.calls.length = 0;
    const response = await register({ jobId, categoryId: CATEGORY_ID, thumbnailPath: `${OTHER_ADMIN_ID}/stolen.jpg` });
    expect(response.status).toBe(400);
    expect(ufo.calls).toHaveLength(0);
  });

  it("uses the thumbnail from the existing Supabase flow", async () => {
    const { jobId } = await openSession();
    await register({ jobId, categoryId: CATEGORY_ID, thumbnailPath: `${ADMIN_ID}/cover.jpg` });
    expect(h.videos()[0].thumbnail_url).toBe(`https://project.supabase.co/storage/v1/object/public/video-thumbnails/${ADMIN_ID}/cover.jpg`);
  });

  it("is safe to repeat: the same job never creates a second video or a second completion", async () => {
    const { jobId } = await openSession();
    const first = await register({ jobId, categoryId: CATEGORY_ID });
    expect(first.status).toBe(200);
    const completions = ufo.calls.filter((call) => call.path.endsWith("/complete")).length;

    const again = await register({ jobId, categoryId: CATEGORY_ID });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ jobId, status: "processing" });
    expect(h.videos()).toHaveLength(1);
    expect(ufo.calls.filter((call) => call.path.endsWith("/complete"))).toHaveLength(completions);
  });

  it("passes a retryable UFOLOAD `upload_busy` back to the browser and creates nothing", async () => {
    const { jobId } = await openSession();
    ufo.failNext("POST /complete", ufo.error(409, "upload_busy", "still finishing"));
    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "upload_busy", retryable: true });
    expect(h.videos()).toHaveLength(0);
    expect(h.jobs()[0].status).toBe("uploading");

    // The retry (same job) then succeeds.
    expect((await register({ jobId, categoryId: CATEGORY_ID })).status).toBe(200);
    expect(h.videos()).toHaveLength(1);
  });

  it("reports an expired/forgotten session as 404 and creates nothing", async () => {
    const { jobId, uploadId } = await openSession();
    ufo.uploads.delete(uploadId);
    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/Start the upload again/);
    expect(h.videos()).toHaveLength(0);
  });

  it("does not create a second public copy of content UFOLOAD already hosts", async () => {
    h.db.videos.push({ id: "existing", provider: "ufoload", provider_file_id: "01FILEEXISTING000000000000A", title: "Already There", slug: "already-there", status: "published" });
    const { jobId } = await openSession();
    ufo.respondOnce((call) => call.path.endsWith("/complete"), {
      status: 200,
      json: { file: { id: "01FILEEXISTING000000000000A", name: "clip.mp4", status: "ready", progress: 100 }, duplicate: true },
    });
    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "duplicate_upload", videoId: "existing" });
    expect(h.videos()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({ status: "failed", error_message: expect.stringMatching(/already hosts this exact file/) });
  });

  it("publishes immediately only when UFOLOAD already reports the file ready and the embed id is verified", async () => {
    const { jobId } = await openSession();
    ufo.respondOnce((call) => call.path.endsWith("/complete"), {
      status: 200,
      json: { file: { id: "01FILEREADY0000000000000AA", name: "clip.mp4", status: "ready", progress: 100, duration_ms: 90000, width: 1280, height: 720, public_id: "abcDEF12345" }, duplicate: true },
    });
    ufo.addFile({ id: "01FILEREADY0000000000000AA", status: "ready", progress: 100, duration_ms: 90000, width: 1280, height: 720, max_quality: 720, public_id: "abcDEF12345" });

    const response = await register({ jobId, categoryId: CATEGORY_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "published", published: true });
    expect(h.videos()[0]).toMatchObject({
      status: "published",
      visibility: "public",
      embed_url: "https://ufoload.com/e/abcDEF12345",
      provider_file_id: "01FILEREADY0000000000000AA",
      duration_seconds: 90,
      quality: "HD",
    });
    expect(h.videos()[0].playable_url).toBeNull();
  });
});

describe("POST /api/videos/upload-url (asynchronous import)", () => {
  const entries = (...urls: string[]) => urls.map((url) => ({ url }));

  it("starts the import at UFOLOAD and returns without waiting for the download", async () => {
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/trip.mp4") });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.succeeded).toBe(1);
    expect(body.results[0]).toMatchObject({ status: "processing", providerStatus: "import:queued", progress: 0 });

    expect(ufo.calls).toHaveLength(1);
    expect(ufo.calls[0]).toMatchObject({ method: "POST", path: "/api/v1/files/import", body: { url: "https://cdn.example.com/trip.mp4" } });
    expect(ufo.calls[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    // No polling inside the request.
    expect(ufo.calls.some((call) => call.method === "GET")).toBe(false);
  });

  it("stores the import TASK id in its own column — never in provider_file_id", async () => {
    const body = await (await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/trip.mp4") })).json();
    const taskId = body.results[0].importTaskId;
    expect(taskId).toMatch(/^imp_/);

    expect(h.jobs()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({ provider: "ufoload", status: "uploading", provider_import_task_id: taskId, provider_status: "import:queued" });
    expect(h.jobs()[0].provider_file_id).toBeUndefined();
    expect(h.videos()).toHaveLength(1);
    expect(h.videos()[0]).toMatchObject({ provider: "ufoload", status: "processing", visibility: "private" });
    expect(h.videos()[0].provider_file_id).toBeUndefined();
    expect(JSON.stringify(h.videos())).not.toContain(taskId);
  });

  it.each([
    ["a loopback address", "http://127.0.0.1/video.mp4"],
    ["localhost", "http://localhost:8080/video.mp4"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data"],
    ["a private 10.x address", "http://10.0.0.5/video.mp4"],
    ["a private 192.168.x address", "http://192.168.1.10/video.mp4"],
    ["an IPv6 loopback", "http://[::1]/video.mp4"],
    ["a decimal-encoded loopback", "http://2130706433/video.mp4"],
    ["a non-http scheme", "ftp://cdn.example.com/video.mp4"],
    ["embedded credentials", "https://user:pass@cdn.example.com/video.mp4"],
    ["a single-label host", "http://intranet/video.mp4"],
  ])("refuses %s (SSRF guard) and queues nothing", async (_label, url) => {
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries(url) });
    expect(response.status).toBe(400);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(h.jobs()).toHaveLength(0);
    expect(h.videos()).toHaveLength(0);
  });

  it("rejects the whole request when any one link is unsafe", async () => {
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/ok.mp4", "http://127.0.0.1/evil.mp4") });
    expect(response.status).toBe(400);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("requires a valid category and at least one link, and caps a request at 20 links", async () => {
    expect((await startImport({ categoryId: "", entries: entries("https://cdn.example.com/a.mp4") })).status).toBe(400);
    expect((await startImport({ categoryId: "missing", entries: entries("https://cdn.example.com/a.mp4") })).status).toBe(400);
    expect((await startImport({ categoryId: CATEGORY_ID, entries: [] })).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, index) => `https://cdn.example.com/${index}.mp4`);
    expect((await startImport({ categoryId: CATEGORY_ID, entries: entries(...many) })).status).toBe(400);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("de-duplicates identical links in one request", async () => {
    const body = await (await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4", "https://cdn.example.com/a.mp4") })).json();
    expect(body.results).toHaveLength(1);
    expect(ufo.imports).toHaveLength(1);
  });

  it("respects UFOLOAD's limit of 10 active imports without calling UFOLOAD when our own count is full", async () => {
    for (let index = 0; index < 10; index++) {
      h.db.upload_jobs.push({ id: `job-${index}`, provider: "ufoload", status: "uploading", provider_import_task_id: `imp_old_${index}`, created_by: ADMIN_ID, file_name: "x.mp4" });
    }
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/eleventh.mp4") });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    const body = await response.json();
    expect(body).toMatchObject({ code: "import_slots_full", retryable: true, retryAfterSeconds: 30 });
    expect(body.results[0]).toMatchObject({ status: "failed", code: "import_slots_full" });
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(h.videos()).toHaveLength(0);
    expect(h.jobs()).toHaveLength(10);
  });

  it("does not count finished imports or direct uploads against the 10-slot limit", async () => {
    for (let index = 0; index < 10; index++) {
      h.db.upload_jobs.push({ id: `done-${index}`, provider: "ufoload", status: "processing", provider_import_task_id: `imp_done_${index}`, provider_file_id: `01F${index}`, created_by: ADMIN_ID, file_name: "x.mp4" });
      h.db.upload_jobs.push({ id: `direct-${index}`, provider: "ufoload", status: "uploading", provider_upload_id: `upl_${index}`, created_by: ADMIN_ID, file_name: "x.mp4" });
    }
    expect((await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4") })).status).toBe(202);
  });

  it("treats UFOLOAD's own 409 (too many imports) as retryable and leaves nothing behind", async () => {
    ufo = createFakeUfoload({ maxActiveImports: 1 });
    vi.stubGlobal("fetch", ufo.fetch);
    ufo.addImport({ id: "imp_busy", status: "running", progress: 40 });

    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4") });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("import_slots_full");
    expect(h.videos()).toHaveLength(0);
    expect(h.jobs()).toHaveLength(0);
  });

  it("starts what fits and reports the rest as retryable when slots run out mid-request", async () => {
    ufo = createFakeUfoload({ maxActiveImports: 1 });
    vi.stubGlobal("fetch", ufo.fetch);
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4", "https://cdn.example.com/c.mp4") });
    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body.succeeded).toBe(1);
    expect(body.results.map((result: any) => result.status)).toEqual(["processing", "failed", "failed"]);
    expect(body.results[1]).toMatchObject({ code: "import_slots_full", retryable: true });
    // Only one POST ever reached UFOLOAD after the first 409.
    expect(ufo.calls.filter((call) => call.method === "POST")).toHaveLength(2);
    expect(h.jobs()).toHaveLength(1);
  });

  it("cancels the UFOLOAD task if it cannot be recorded, so nothing downloads untracked", async () => {
    h.failInserts("upload_jobs");
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4") });
    expect(response.status).toBe(422);
    const taskId = ufo.imports[0].id;
    expect(ufo.calls.some((call) => call.method === "DELETE" && call.path === `/api/v1/files/import/${taskId}`)).toBe(true);
    expect(ufo.imports[0].status).toBe("cancelled");
    expect(h.videos()).toHaveLength(0);
  });

  it("reports a link UFOLOAD refuses as a failed entry with the reason", async () => {
    ufo.failNext("POST /files/import", ufo.error(400, "invalid_url", "private range"));
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4") });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.results[0].status).toBe("failed");
    expect(body.results[0].error).toMatch(/direct, public http\(s\) link/);
    expect(body.error).toMatch(/direct, public http\(s\) link/);
    expect(h.jobs()).toHaveLength(0);
  });

  it("answers 503 when UFOLOAD is not approved/configured, before touching anything", async () => {
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "false");
    const response = await startImport({ categoryId: CATEGORY_ID, entries: entries("https://cdn.example.com/a.mp4") });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("adult_content_not_approved");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("uses the admin's thumbnail from the existing Supabase flow", async () => {
    await startImport({ categoryId: CATEGORY_ID, entries: [{ url: "https://cdn.example.com/a.mp4", thumbnailPath: `${ADMIN_ID}/cover.png` }] });
    expect(h.videos()[0].thumbnail_url).toContain(`/video-thumbnails/${ADMIN_ID}/cover.png`);
  });
});

describe("GET /api/videos/status", () => {
  function seedJob(overrides: Record<string, unknown> = {}) {
    h.db.videos.push({ id: "vid-1", slug: "velvet-1", title: "Velvet", status: "processing", visibility: "private", provider: "ufoload", provider_file_id: "01FILESTATUS00000000000001", created_by: ADMIN_ID });
    h.db.upload_jobs.push({
      id: "job-1",
      video_id: "vid-1",
      provider: "ufoload",
      status: "processing",
      progress: 0,
      provider_file_id: "01FILESTATUS00000000000001",
      created_by: ADMIN_ID,
      created_at: new Date().toISOString(),
      file_name: "clip.mp4",
      ...overrides,
    });
  }

  it("refreshes the jobs it returns from UFOLOAD", async () => {
    seedJob();
    ufo.addFile({ id: "01FILESTATUS00000000000001", status: "processing", progress: 37 });
    const response = await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=job-1`));
    expect(response.status).toBe(200);
    const { jobs } = await response.json();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobId: "job-1", phase: "processing", progress: 37, providerStatus: "processing", published: false });
    expect(h.jobs()[0].progress).toBe(37);
  });

  it("publishes a video the moment UFOLOAD reports it ready", async () => {
    seedJob();
    ufo.addFile({ id: "01FILESTATUS00000000000001", status: "ready", progress: 100, public_id: "abcDEF12345", duration_ms: 125000 });
    const { jobs } = await (await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=job-1`))).json();
    expect(jobs[0]).toMatchObject({ phase: "published", published: true, embedUrl: "https://ufoload.com/e/abcDEF12345", slug: "velvet-1" });
    expect(h.videos()[0]).toMatchObject({ status: "published", visibility: "public", embed_url: "https://ufoload.com/e/abcDEF12345", duration_seconds: 125 });
    expect(h.jobs()[0].status).toBe("completed");
  });

  it("omits unknown ids and refuses more than 20 at once", async () => {
    seedJob();
    ufo.addFile({ id: "01FILESTATUS00000000000001", status: "processing", progress: 5 });
    const { jobs } = await (await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=job-1,ghost`))).json();
    expect(jobs.map((job: any) => job.jobId)).toEqual(["job-1"]);

    const tooMany = Array.from({ length: 21 }, (_, index) => `j${index}`).join(",");
    expect((await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=${tooMany}`))).status).toBe(400);
  });

  it("returns the stored state with a warning — never an error — when the provider is not configured", async () => {
    seedJob();
    vi.stubEnv("UFOLOAD_API_KEY", "");
    const response = await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=job-1`));
    expect(response.status).toBe(200);
    const { jobs } = await response.json();
    expect(jobs[0].warning).toMatch(/cannot be refreshed/);
    expect(jobs[0].phase).toBe("processing");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("answers a single job or video lookup", async () => {
    seedJob();
    ufo.addFile({ id: "01FILESTATUS00000000000001", status: "processing", progress: 12 });
    const byJob = await (await statusGet(jsonRequest(`${BASE}/api/videos/status?jobId=job-1`))).json();
    expect(byJob.status).toMatchObject({ progress: 12 });
    expect(byJob.video.id).toBe("vid-1");
    expect(byJob.job.id).toBe("job-1");

    const byVideo = await (await statusGet(jsonRequest(`${BASE}/api/videos/status?videoId=vid-1`))).json();
    expect(byVideo.job.id).toBe("job-1");
    expect((await statusGet(jsonRequest(`${BASE}/api/videos/status?videoId=ghost`))).status).toBe(404);
    expect((await statusGet(jsonRequest(`${BASE}/api/videos/status`))).status).toBe(400);
  });

  it("leaves legacy Uqload videos alone — no provider call, no change", async () => {
    h.db.videos.push({ id: "old-1", slug: "old", title: "Old", status: "published", visibility: "public", provider: "uqload", provider_file_id: "u9150wqzvhxj", embed_url: "https://uqload.vc/embed-u9150wqzvhxj.html" });
    h.db.upload_jobs.push({ id: "old-job", video_id: "old-1", provider: "uqload", status: "processing", progress: 100, provider_file_id: "u9150wqzvhxj", created_at: "2025-01-01T00:00:00Z", file_name: "old.mp4" });
    const { jobs } = await (await statusGet(jsonRequest(`${BASE}/api/videos/status?jobIds=old-job`))).json();
    expect(jobs[0]).toMatchObject({ jobId: "old-job", jobStatus: "processing" });
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(h.videos()[0]).toMatchObject({ status: "published", embed_url: "https://uqload.vc/embed-u9150wqzvhxj.html", provider: "uqload" });
  });
});

describe("/api/videos/reconcile", () => {
  function seedProcessing(count: number) {
    for (let index = 0; index < count; index++) {
      const fileId = `01FILERECON0000000000000${String(index).padStart(3, "0")}`;
      h.db.videos.push({ id: `rv-${index}`, slug: `rv-${index}`, title: `Video ${index}`, status: "processing", visibility: "private", provider: "ufoload", provider_file_id: fileId, created_by: ADMIN_ID });
      h.db.upload_jobs.push({ id: `rj-${index}`, video_id: `rv-${index}`, provider: "ufoload", status: "processing", progress: 0, provider_file_id: fileId, created_by: ADMIN_ID, created_at: new Date().toISOString(), file_name: "x.mp4" });
      ufo.addFile({ id: fileId, status: index % 2 === 0 ? "ready" : "processing", progress: index % 2 === 0 ? 100 : 20, public_id: `rdy${String(index).padStart(8, "0")}` });
    }
  }

  const schedulerRequest = (secret: string | null, method = "POST") =>
    jsonRequest(`${BASE}/api/videos/reconcile`, { method, ...(method === "POST" ? { body: {} } : {}), headers: secret ? { Authorization: `Bearer ${secret}` } : {} });

  it("lets a scheduler holding CRON_SECRET finish unattended work — no browser, no session", async () => {
    install(createVideoHarness({ user: null }));
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    seedProcessing(4);

    const response = await reconcilePost(schedulerRequest(CRON_SECRET));
    expect(response.status).toBe(200);
    const summary = await response.json();
    expect(summary).toMatchObject({ ok: true, checked: 4, published: 2, stillProcessing: 2, failed: 0 });
    expect(h.videos().filter((video) => video.status === "published")).toHaveLength(2);
    expect(h.videos().filter((video) => video.status === "processing")).toHaveLength(2);
  });

  it("accepts GET too, because Vercel Cron issues GET", async () => {
    install(createVideoHarness({ user: null }));
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    seedProcessing(2);
    const response = await reconcileGet(schedulerRequest(CRON_SECRET, "GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).checked).toBe(2);
  });

  it.each([
    ["a wrong secret", "x".repeat(CRON_SECRET.length)],
    ["no header", null],
    ["a near-miss secret", `${CRON_SECRET}x`],
  ])("rejects %s", async (_label, secret) => {
    install(createVideoHarness({ user: null }));
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    seedProcessing(1);
    const response = await reconcilePost(schedulerRequest(secret));
    expect(response.status).toBe(401);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("ignores header authentication entirely when CRON_SECRET is unset or too short", async () => {
    install(createVideoHarness({ user: null }));
    seedProcessing(1);
    expect((await reconcilePost(schedulerRequest("anything-at-all-goes-1234"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await reconcilePost(schedulerRequest("short"))).status).toBe(401);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("lets an active admin trigger it without the secret", async () => {
    seedProcessing(2);
    const response = await reconcilePost(jsonRequest(`${BASE}/api/videos/reconcile`, { body: { limit: 1 } }));
    expect(response.status).toBe(200);
    expect((await response.json()).checked).toBe(1);
  });

  it("answers 503 — not a silent success — when UFOLOAD is not enabled", async () => {
    install(createVideoHarness({ user: null }));
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "false");
    seedProcessing(1);
    const response = await reconcilePost(schedulerRequest(CRON_SECRET));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("adult_content_not_approved");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });
});
