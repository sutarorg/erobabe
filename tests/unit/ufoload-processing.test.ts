import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TEST_API_KEY, createFakeUfoload, PAPI_EXAMPLE, type FakeUfoload } from "./helpers/fake-ufoload";
import { ADMIN_ID, createVideoHarness, type VideoHarness } from "./helpers/video-harness";

/**
 * The processing state machine: a video is private until UFOLOAD reports its
 * file `ready`; imports are followed from task → file → ready; failures keep a
 * reason an admin can act on; provider trouble never fails a job; unattended
 * reconciliation is bounded. UFOLOAD is the contract mock from
 * helpers/fake-ufoload.ts — these tests do not prove a real encode works.
 */

const dbState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.client,
  createServiceClient: () => dbState.client,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

import {
  IMPORT_LIST_GRACE_MS,
  IMPORT_STALL_MS,
  PROCESSING_TIMEOUT_MS,
  UPLOAD_SESSION_IDLE_MS,
  countActiveImports,
  importSlotsFull,
  providerDetails,
  qualityLabel,
  reconcileJob,
  reconcileOutstandingJobs,
  type UploadJobRow,
} from "@/lib/video/processing";
import { UfoloadProvider } from "@/lib/video/provider";
import { VideoProviderConfigError } from "@/lib/video/errors";
import { parseFile } from "@/lib/video/ufoload";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const ENV = { UFOLOAD_API_KEY: TEST_API_KEY, UFOLOAD_ADULT_CONTENT_APPROVED: "true" };
const FILE_ID = "01JFILEPROCESSING00000000A";
const PUBLIC_ID = "abcDEF12345";

let h: VideoHarness;
let ufo: FakeUfoload;
let provider: UfoloadProvider;

function makeProvider(env: Record<string, string | undefined> = ENV) {
  return new UfoloadProvider({ env, fetchImpl: ufo.fetch, sleep: async () => {}, random: () => 0 });
}

beforeEach(() => {
  h = createVideoHarness();
  dbState.client = h.service;
  ufo = createFakeUfoload();
  provider = makeProvider();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function seedVideo(overrides: Record<string, unknown> = {}) {
  h.db.videos.push({
    id: "vid-1",
    slug: "velvet-1",
    title: "Velvet",
    status: "processing",
    visibility: "private",
    rights_status: "cleared",
    moderation_status: "approved",
    provider: "ufoload",
    created_by: ADMIN_ID,
    ...overrides,
  });
}

/** A registered direct upload: UFOLOAD has the file and is processing it. */
function seedUploadJob(overrides: Record<string, unknown> = {}, videoOverrides: Record<string, unknown> = {}) {
  seedVideo({ provider_file_id: FILE_ID, ...videoOverrides });
  const job = {
    id: "job-1",
    video_id: "vid-1",
    provider: "ufoload",
    status: "processing",
    progress: 0,
    provider_file_id: FILE_ID,
    provider_upload_id: "upl_0001",
    created_by: ADMIN_ID,
    created_at: ago(MINUTE),
    last_checked_at: null,
    file_name: "clip.mp4",
    ...overrides,
  };
  h.db.upload_jobs.push(job);
  return job as unknown as UploadJobRow;
}

function seedImportJob(overrides: Record<string, unknown> = {}) {
  seedVideo();
  const job = {
    id: "job-1",
    video_id: "vid-1",
    provider: "ufoload",
    status: "uploading",
    progress: 0,
    provider_import_task_id: "imp_TASK",
    created_by: ADMIN_ID,
    created_at: ago(MINUTE),
    last_checked_at: null,
    file_name: "trip.mp4",
    ...overrides,
  };
  h.db.upload_jobs.push(job);
  return job as unknown as UploadJobRow;
}

const stored = () => h.db.upload_jobs[0] as unknown as UploadJobRow & Record<string, any>;
const storedVideo = () => h.db.videos[0] as Record<string, any>;

function step(job: UploadJobRow, extra: { now?: Date; force?: boolean; minIntervalMs?: number } = {}) {
  return reconcileJob({ service: h.service as never, provider, job, now: extra.now ?? NOW, force: extra.force ?? true, minIntervalMs: extra.minIntervalMs });
}

describe("direct upload: queued → processing → ready → published", () => {
  it("keeps the video private through every UFOLOAD stage and publishes only on `ready`", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "queued", progress: 0 });

    let view = await step(job);
    expect(view).toMatchObject({ phase: "processing", providerStatus: "queued", progress: 0, published: false });
    expect(storedVideo()).toMatchObject({ status: "processing", visibility: "private" });

    ufo.files.get(FILE_ID)!.status = "uploading";
    view = await step(stored());
    expect(view).toMatchObject({ phase: "processing", providerStatus: "uploading", published: false });

    ufo.files.get(FILE_ID)!.status = "processing";
    ufo.files.get(FILE_ID)!.progress = 45;
    view = await step(stored());
    expect(view).toMatchObject({ phase: "processing", providerStatus: "processing", progress: 45, published: false });
    expect(stored()).toMatchObject({ status: "processing", progress: 45, provider_status: "processing" });
    expect(storedVideo()).toMatchObject({ status: "processing", visibility: "private" });
    expect(storedVideo().published_at).toBeFalsy();

    Object.assign(ufo.files.get(FILE_ID)!, { status: "ready", progress: 100, public_id: PUBLIC_ID, duration_ms: 125400, width: 1920, height: 1080, max_quality: 1080 });
    view = await step(stored());
    expect(view).toMatchObject({ phase: "published", published: true, embedUrl: `https://ufoload.com/e/${PUBLIC_ID}`, progress: 100 });
    expect(storedVideo()).toMatchObject({
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      embed_url: `https://ufoload.com/e/${PUBLIC_ID}`,
      provider_file_id: FILE_ID,
      duration_seconds: 125,
      resolution: "1920x1080",
      quality: "HD",
      updated_by: ADMIN_ID,
    });
    expect(storedVideo().published_at).toBeTruthy();
    expect(storedVideo().playable_url).toBeNull();
    expect(stored()).toMatchObject({ status: "completed", progress: 100, provider_status: "ready", error_message: null });
  });

  it("never stores an expiring signed playback or poster URL", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, public_id: PUBLIC_ID });
    await step(job);
    const everything = JSON.stringify(h.db);
    expect(everything).not.toMatch(/sig=|master\.m3u8|EXPIRING|cdn\.ufoload\.com/);
    expect(storedVideo().playable_url).toBeNull();
    expect(storedVideo().thumbnail_url).toBeFalsy();
  });

  it("takes the stable embed URL from papi file/info when the REST file has no public id", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, papiFilecode: PAPI_EXAMPLE.filecode });
    const view = await step(job);
    expect(view.published).toBe(true);
    expect(storedVideo().embed_url).toBe(PAPI_EXAMPLE.protected_embed);
  });

  it("stays private — and says why — while UFOLOAD is ready but has given no verifiable embed id", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100 }); // no public_id, no papi code → papi answers 404
    const view = await step(job);
    expect(view.published).toBe(false);
    expect(view.phase).toBe("processing");
    expect(view.warning).toMatch(/UFOLOAD has no file with this ID|embed identifier/);
    expect(storedVideo()).toMatchObject({ status: "processing", visibility: "private" });
    expect(stored().status).toBe("processing");

    // A later check, once UFOLOAD can answer, publishes it.
    ufo.files.get(FILE_ID)!.papiFilecode = PAPI_EXAMPLE.filecode;
    const later = await step(stored(), { now: new Date(NOW.getTime() + 30_000) });
    expect(later.published).toBe(true);
    expect(storedVideo().embed_url).toBe(PAPI_EXAMPLE.protected_embed);
  });

  it("holds at 99% with a warning when papi returns no usable code at all", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100 });
    ufo.respondOnce((call) => call.host === "api.ufoload.com", { status: 200, json: { msg: "OK", status: 200, result: [{ filecode: "x" }] } });
    const view = await step(job);
    expect(view).toMatchObject({ phase: "processing", progress: 99, providerStatus: "ready", published: false });
    expect(view.warning).toMatch(/has not yet provided its public embed identifier/);
    expect(storedVideo().status).toBe("processing");
  });

  it("records UFOLOAD's failure reason and returns the video to a private draft", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "failed", progress: 12, error: "unsupported audio codec" });
    const view = await step(job);

    expect(view).toMatchObject({ phase: "failed", published: false });
    expect(view.error).toContain("unsupported audio codec");
    expect(view.error).toMatch(/Upload it again/);
    expect(stored()).toMatchObject({ status: "failed" });
    expect(stored().error_message).toContain("unsupported audio codec");
    expect(storedVideo()).toMatchObject({ status: "draft", visibility: "private" });
    expect(h.db.audit_logs.at(-1)).toMatchObject({ action: "video_processing_failed", level: "warning", target_id: "vid-1" });
  });

  it("gives a failure with no provider reason a sensible default", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "failed", progress: 0 });
    const view = await step(job);
    expect(view.error).toMatch(/encoding failed \(no reason given\)/);
  });

  it("fails the job when UFOLOAD no longer has the file", async () => {
    const job = seedUploadJob();
    // The file was never added: GET /files/{id} answers 404.
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(view.error).toMatch(/no file with this ID/);
    expect(view.error).toMatch(/Upload the video again/);
    expect(storedVideo().status).toBe("draft");
  });

  it("gives up on a file still processing after 48 hours", async () => {
    const job = seedUploadJob({ created_at: ago(PROCESSING_TIMEOUT_MS + HOUR) });
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 80 });
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(view.error).toMatch(/48 hours/);
    expect(storedVideo()).toMatchObject({ status: "draft", visibility: "private" });
  });

  it("does not give up on a file that is still within the window", async () => {
    const job = seedUploadJob({ created_at: ago(PROCESSING_TIMEOUT_MS - HOUR) });
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 80 });
    expect((await step(job)).phase).toBe("processing");
  });

  it("leaves a video an admin changed in the meantime exactly as they left it", async () => {
    const job = seedUploadJob({}, { status: "draft" });
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, public_id: PUBLIC_ID });
    const view = await step(job);
    expect(view.phase).toBe("ready");
    expect(view.published).toBe(false);
    expect(storedVideo()).toMatchObject({ status: "draft", visibility: "private", embed_url: `https://ufoload.com/e/${PUBLIC_ID}` });
    expect(stored().status).toBe("completed");
  });

  it("does not publish when the video was deleted while UFOLOAD processed it", async () => {
    const job = seedUploadJob({ video_id: null });
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, public_id: PUBLIC_ID });
    const view = await step(job);
    expect(view.phase).toBe("cancelled");
    expect(view.error).toMatch(/deleted/);
  });

  it("publishes once when two reconcilers race on the same ready file", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, public_id: PUBLIC_ID });
    const [a, b] = await Promise.all([step({ ...job }), step({ ...job })]);
    expect(a.published && b.published).toBe(true);
    expect(h.db.audit_logs.filter((entry) => entry.action === "video_published_when_ready")).toHaveLength(1);
    expect(storedVideo().status).toBe("published");
  });

  it("never re-publishes or touches a finished job", async () => {
    const job = seedUploadJob({ status: "completed", progress: 100 }, { status: "published", visibility: "public", embed_url: `https://ufoload.com/e/${PUBLIC_ID}` });
    const view = await step(job);
    expect(view).toMatchObject({ phase: "published", published: true });
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });
});

describe("provider trouble never fails a job", () => {
  const troubles: Array<[string, () => void]> = [
    ["rate limited (429)", () => ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), ufo.error(429, "rate_limited", "slow", { "Retry-After": "1" }), 10)],
    ["UFOLOAD down (503)", () => ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), { status: 503, json: {} }, 10)],
    ["gateway error (502)", () => ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), { status: 502, json: {} }, 10)],
    ["a rejected API key (401)", () => ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), ufo.error(401, "unauthorized", "bad key"), 10)],
    ["a hung request", () => ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), { status: 200, hang: true }, 10)],
  ];

  it.each(troubles)("%s leaves the job exactly as it was and reports a warning", async (_label, arrange) => {
    const job = seedUploadJob({ progress: 33, provider_status: "processing" });
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 60 });
    arrange();
    provider = new UfoloadProvider({ env: ENV, fetchImpl: ufo.fetch, sleep: async () => {}, random: () => 0, timeoutMs: 25 });

    const view = await step(job);
    expect(view.phase).toBe("processing");
    expect(view.warning).toBeTruthy();
    expect(view.progress).toBe(33);
    expect(stored()).toMatchObject({ status: "processing", progress: 33, provider_status: "processing" });
    expect(storedVideo()).toMatchObject({ status: "processing", visibility: "private" });
    expect(stored().last_checked_at).toBe(NOW.toISOString());
    expect(JSON.stringify(view)).not.toContain(TEST_API_KEY);
  });

  it("reports an unreachable UFOLOAD (network) as a warning too", async () => {
    const job = seedUploadJob();
    provider = new UfoloadProvider({
      env: ENV,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 0,
    });
    const view = await step(job);
    expect(view.phase).toBe("processing");
    expect(view.warning).toMatch(/Could not reach UFOLOAD/);
    expect(stored().status).toBe("processing");
  });

  it("explains a misconfigured provider instead of failing videos", async () => {
    const job = seedUploadJob();
    provider = makeProvider({ ...ENV, UFOLOAD_ADULT_CONTENT_APPROVED: "false" });
    const view = await step(job);
    expect(view.phase).toBe("processing");
    expect(view.warning).toMatch(/cannot be refreshed/);
    expect(view.warning).toMatch(/Written approval/);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(stored().status).toBe("processing");
  });

  it("then carries on normally once UFOLOAD answers again", async () => {
    const job = seedUploadJob();
    ufo.addFile({ id: FILE_ID, status: "ready", progress: 100, public_id: PUBLIC_ID });
    ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), { status: 503, json: {} }, 3);
    expect((await step(job)).published).toBe(false);
    expect((await step(stored(), { now: new Date(NOW.getTime() + 20_000) })).published).toBe(true);
  });
});

describe("rechecking is throttled, not unbounded", () => {
  it("skips the provider when the job was checked a moment ago", async () => {
    const job = seedUploadJob({ last_checked_at: ago(1000) });
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 50 });
    const view = await step(job, { force: false });
    expect(view.phase).toBe("processing");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("asks again once the interval has passed, or when forced", async () => {
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 50 });
    await step(seedUploadJob({ last_checked_at: ago(10_000) }), { force: false });
    expect(ufo.fetchMock).toHaveBeenCalledTimes(1);

    ufo.fetchMock.mockClear();
    await step(stored(), { force: false });
    expect(ufo.fetchMock).not.toHaveBeenCalled(); // just checked at NOW
    await step(stored(), { force: true });
    expect(ufo.fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("URL import: task → file → ready", () => {
  it("follows the import task by its own id to a file, then to ready, keeping the two ids apart", async () => {
    const job = seedImportJob();
    // Decoys that share the URL and name must never be mistaken for our task.
    ufo.addImport({ id: "imp_DECOY1", url: "https://cdn.example.com/trip.mp4", name: "trip.mp4", status: "done", progress: 100, file_id: "01JDECOYFILE0000000000001" });
    ufo.addImport({ id: "imp_DECOY2", url: "https://cdn.example.com/trip.mp4", name: "trip.mp4", status: "failed", error: "not ours" });
    const task = ufo.addImport({ id: "imp_TASK", url: "https://cdn.example.com/trip.mp4", name: "trip.mp4", status: "queued" });
    ufo.imports.reverse(); // order must not matter either

    let view = await step(job);
    expect(view).toMatchObject({ phase: "uploading", providerStatus: "import:queued", progress: 0, published: false });
    expect(stored()).toMatchObject({ status: "uploading", provider_import_task_id: "imp_TASK" });
    expect(stored().provider_file_id).toBeUndefined();

    Object.assign(task, { status: "running", progress: 40 });
    view = await step(stored());
    expect(view).toMatchObject({ phase: "uploading", providerStatus: "import:running", progress: 40 });
    expect(stored().provider_file_id).toBeUndefined();

    // The download finished: UFOLOAD hands back a FILE id, which is a different thing.
    Object.assign(task, { status: "done", progress: 100, file_id: FILE_ID });
    ufo.addFile({ id: FILE_ID, status: "processing", progress: 10 });
    view = await step(stored());
    expect(view).toMatchObject({ phase: "processing", progress: 10, published: false });
    expect(stored()).toMatchObject({ status: "processing", provider_import_task_id: "imp_TASK", provider_file_id: FILE_ID });
    expect(stored().provider_file_id).not.toBe(stored().provider_import_task_id);
    expect(storedVideo()).toMatchObject({ provider_file_id: FILE_ID, status: "processing", visibility: "private" });

    Object.assign(ufo.files.get(FILE_ID)!, { status: "ready", progress: 100, public_id: PUBLIC_ID });
    view = await step(stored());
    expect(view).toMatchObject({ phase: "published", published: true });
    expect(storedVideo()).toMatchObject({ status: "published", visibility: "public", embed_url: `https://ufoload.com/e/${PUBLIC_ID}`, provider_file_id: FILE_ID });
    expect(stored()).toMatchObject({ status: "completed", provider_import_task_id: "imp_TASK", provider_file_id: FILE_ID });

    // The file was looked up by its file id — the task id was never used as one.
    const fileCalls = ufo.calls.filter((call) => call.path.startsWith("/api/v1/files/") && !call.path.startsWith("/api/v1/files/import"));
    expect(fileCalls.length).toBeGreaterThan(0);
    expect(fileCalls.every((call) => call.path === `/api/v1/files/${FILE_ID}`)).toBe(true);
    expect(JSON.stringify(h.db.videos)).not.toContain("imp_TASK");
  });

  it("fails with UFOLOAD's reason when the import fails", async () => {
    const job = seedImportJob();
    ufo.addImport({ id: "imp_TASK", status: "failed", error: "origin returned 403 Forbidden" });
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(view.error).toContain("origin returned 403 Forbidden");
    expect(view.error).toMatch(/direct, public video file URL/);
    expect(stored().status).toBe("failed");
    expect(storedVideo()).toMatchObject({ status: "draft", visibility: "private" });
  });

  it("gives a failed import with no reason a default", async () => {
    const job = seedImportJob();
    ufo.addImport({ id: "imp_TASK", status: "failed" });
    expect((await step(job)).error).toMatch(/it gave no reason/);
  });

  it("marks a cancelled import cancelled, not failed", async () => {
    const job = seedImportJob();
    ufo.addImport({ id: "imp_TASK", status: "cancelled" });
    const view = await step(job);
    expect(view.phase).toBe("cancelled");
    expect(stored().status).toBe("cancelled");
    expect(stored().error_message).toMatch(/cancelled at UFOLOAD/);
  });

  it("waits for a task UFOLOAD has not listed yet, then reports it lost", async () => {
    const fresh = seedImportJob({ created_at: ago(IMPORT_LIST_GRACE_MS - 30_000) });
    const waiting = await step(fresh);
    expect(waiting.phase).toBe("uploading");
    expect(stored().status).toBe("uploading");

    h.db.upload_jobs.length = 0;
    h.db.videos.length = 0;
    const old = seedImportJob({ created_at: ago(IMPORT_LIST_GRACE_MS + 60_000) });
    const lost = await step(old);
    expect(lost.phase).toBe("failed");
    expect(lost.error).toMatch(/no longer lists import task imp_TASK/);
    expect(lost.error).toMatch(/import the link again/);
  });

  it("does not match a different task just because the URL or name is the same", async () => {
    const job = seedImportJob({ created_at: ago(IMPORT_LIST_GRACE_MS + MINUTE) });
    ufo.addImport({ id: "imp_OTHER", url: "https://cdn.example.com/trip.mp4", name: "trip.mp4", status: "done", progress: 100, file_id: "01JOTHERFILE0000000000001" });
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(stored().provider_file_id).toBeUndefined();
  });

  it("waits briefly for a done task's file id, then fails if UFOLOAD never supplies one", async () => {
    ufo.addImport({ id: "imp_TASK", status: "done", progress: 100 });
    const recent = seedImportJob({ created_at: ago(5 * MINUTE) });
    const waiting = await step(recent);
    expect(waiting.phase).toBe("uploading");
    expect(waiting.warning).toMatch(/waiting for UFOLOAD to report the file/);

    h.db.upload_jobs.length = 0;
    h.db.videos.length = 0;
    const old = seedImportJob({ created_at: ago(15 * MINUTE) });
    const failed = await step(old);
    expect(failed.phase).toBe("failed");
    expect(failed.error).toMatch(/never returned a file ID/);
  });

  it("cancels and fails an import that is still downloading after six hours", async () => {
    const job = seedImportJob({ created_at: ago(IMPORT_STALL_MS + HOUR) });
    ufo.addImport({ id: "imp_TASK", status: "running", progress: 3 });
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(view.error).toMatch(/6 hours/);
    expect(ufo.calls.some((call) => call.method === "DELETE" && call.path === "/api/v1/files/import/imp_TASK")).toBe(true);
  });

  it("treats an import status it does not know as still running — never as done", async () => {
    const job = seedImportJob();
    ufo.respondOnce((call) => call.path === "/api/v1/files/import" && call.method === "GET", {
      status: 200,
      json: { items: [{ id: "imp_TASK", status: "paused-by-ufo", progress: 12 }] },
    });
    const view = await step(job);
    expect(view).toMatchObject({ phase: "uploading", progress: 12 });
    expect(stored().provider_file_id).toBeUndefined();
  });

  it("survives a rate-limited import list without failing the import", async () => {
    const job = seedImportJob();
    ufo.respondOnce((call) => call.path === "/api/v1/files/import" && call.method === "GET", ufo.error(429, "rate_limited", "slow", { "Retry-After": "1" }), 10);
    const view = await step(job);
    expect(view.phase).toBe("uploading");
    expect(view.warning).toMatch(/rate limiting/);
    expect(stored().status).toBe("uploading");
    // GET is retried a bounded number of times, not forever.
    expect(ufo.calls.filter((call) => call.method === "GET" && call.path === "/api/v1/files/import").length).toBeLessThanOrEqual(3);
  });
});

describe("direct-upload sessions that never finish", () => {
  /** A direct upload has a job from the moment the grant is issued — but no video until it is registered. */
  const sessionJob = (overrides: Record<string, unknown> = {}) => {
    const job = {
      id: "job-1",
      video_id: null,
      provider: "ufoload",
      status: "uploading",
      progress: 0,
      provider_upload_id: "upl_0001",
      created_by: ADMIN_ID,
      created_at: ago(30 * MINUTE),
      last_checked_at: null,
      file_name: "clip.mp4",
      ...overrides,
    };
    h.db.upload_jobs.push(job);
    ufo.uploads.set("upl_0001", { id: "upl_0001", filename: "clip.mp4", size: 100, state: "pending" });
    return job as unknown as UploadJobRow;
  };

  it("leaves a session alone while the browser is plausibly still sending", async () => {
    const job = sessionJob({ created_at: ago(5 * MINUTE) });
    const view = await step(job);
    expect(view.phase).toBe("uploading");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(stored().status).toBe("uploading");
  });

  it("treats a recent keep-alive as activity, however old the session is", async () => {
    const job = sessionJob({ created_at: ago(3 * HOUR), last_checked_at: ago(4 * MINUTE) });
    expect((await step(job)).phase).toBe("uploading");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("releases an abandoned session at UFOLOAD and cancels the job", async () => {
    const job = sessionJob({ created_at: ago(UPLOAD_SESSION_IDLE_MS + 5 * MINUTE) });
    const view = await step(job);
    expect(view.phase).toBe("cancelled");
    expect(view.error).toMatch(/no activity for 20 minutes/);
    expect(ufo.uploads.get("upl_0001")?.state).toBe("aborted");
    expect(stored()).toMatchObject({ status: "cancelled" });
    expect(h.db.videos).toHaveLength(0);
  });

  it("reports a session UFOLOAD completed but the app never registered, with the file id", async () => {
    const job = sessionJob({ created_at: ago(UPLOAD_SESSION_IDLE_MS + 5 * MINUTE) });
    Object.assign(ufo.uploads.get("upl_0001")!, { state: "completed", fileId: "01JUNREGISTERED00000000001" });
    const view = await step(job);
    expect(view.phase).toBe("cancelled");
    expect(view.error).toContain("01JUNREGISTERED00000000001");
    expect(view.error).toMatch(/never registered it/);
    expect(ufo.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});

describe("legacy and unrelated jobs are not touched", () => {
  it("ignores Uqload-era jobs entirely", async () => {
    const job = seedUploadJob({ provider: "uqload", provider_file_id: "u9150wqzvhxj" }, { provider: "uqload", provider_file_id: "u9150wqzvhxj" });
    const view = await step(job);
    expect(view.jobStatus).toBe("processing");
    expect(ufo.fetchMock).not.toHaveBeenCalled();
    expect(storedVideo()).toMatchObject({ provider: "uqload", status: "processing" });
  });

  it("fails a job that has no UFOLOAD reference at all", async () => {
    const job = seedUploadJob({ provider_file_id: null, provider_upload_id: null, provider_import_task_id: null });
    const view = await step(job);
    expect(view.phase).toBe("failed");
    expect(view.error).toMatch(/no UFOLOAD reference/);
  });
});

describe("background reconciliation", () => {
  function seedMany(count: number, lastChecked: Array<string | null> = []) {
    for (let index = 0; index < count; index++) {
      const fileId = `01JFILEBATCH0000000000${String(index).padStart(4, "0")}`;
      h.db.videos.push({ id: `bv-${index}`, slug: `bv-${index}`, title: `V${index}`, status: "processing", visibility: "private", provider: "ufoload", provider_file_id: fileId, created_by: ADMIN_ID });
      h.db.upload_jobs.push({
        id: `bj-${index}`,
        video_id: `bv-${index}`,
        provider: "ufoload",
        status: "processing",
        progress: 0,
        provider_file_id: fileId,
        created_by: ADMIN_ID,
        created_at: ago(HOUR - index),
        last_checked_at: lastChecked[index] ?? null,
        file_name: "x.mp4",
      });
      ufo.addFile({ id: fileId, status: "processing", progress: 10 });
    }
  }

  const run = (extra: Record<string, unknown> = {}) =>
    reconcileOutstandingJobs({ service: h.service as never, provider, now: () => NOW, ...extra });

  it("checks never-checked jobs first, then the longest-unchecked", async () => {
    seedMany(4, [ago(10 * MINUTE), null, ago(40 * MINUTE), ago(5 * MINUTE)]);
    await run({ limit: 3 });
    const order = ufo.calls.map((call) => call.path.split("/").pop());
    expect(order).toEqual([
      "01JFILEBATCH00000000000001", // never checked
      "01JFILEBATCH00000000000002", // 40 min
      "01JFILEBATCH00000000000000", // 10 min
    ]);
  });

  it("reports what happened and how much was left for next time", async () => {
    seedMany(5);
    const summary = await run({ limit: 2 });
    expect(summary).toMatchObject({ checked: 2, deferred: 3, failed: 0, published: 0, stillProcessing: 2 });
  });

  it("stops at its time budget and defers the rest", async () => {
    seedMany(6);
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 600));
    const summary = await run({ limit: 6, budgetMs: 1500 });
    expect(summary.checked).toBeLessThan(6);
    expect(summary.checked + summary.deferred).toBe(6);
    expect(summary.deferred).toBeGreaterThan(0);
  });

  it("counts published, failed and still-processing jobs", async () => {
    seedMany(3);
    const ids = [...ufo.files.keys()];
    Object.assign(ufo.files.get(ids[0])!, { status: "ready", progress: 100, public_id: "rdy00000001" });
    Object.assign(ufo.files.get(ids[1])!, { status: "failed", error: "bad file" });
    const summary = await run();
    expect(summary).toMatchObject({ checked: 3, published: 1, failed: 1, stillProcessing: 1, cancelled: 0, deferred: 0 });
  });

  it("collects a few warnings when UFOLOAD is struggling, without failing anything", async () => {
    seedMany(3);
    ufo.respondOnce((call) => call.path.startsWith("/api/v1/files/01"), { status: 503, json: {} }, 20);
    const summary = await run();
    expect(summary).toMatchObject({ checked: 3, failed: 0, published: 0, stillProcessing: 3 });
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.warnings.length).toBeLessThanOrEqual(5);
    expect(h.db.upload_jobs.every((job) => job.status === "processing")).toBe(true);
  });

  it("ignores finished and legacy jobs", async () => {
    h.db.upload_jobs.push(
      { id: "a", provider: "ufoload", status: "completed", created_at: ago(HOUR) },
      { id: "b", provider: "ufoload", status: "failed", created_at: ago(HOUR) },
      { id: "c", provider: "ufoload", status: "cancelled", created_at: ago(HOUR) },
      { id: "d", provider: "uqload", status: "processing", provider_file_id: "u1", created_at: ago(HOUR) }
    );
    const summary = await run();
    expect(summary.checked).toBe(0);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run — loudly — when UFOLOAD is not enabled", async () => {
    seedMany(1);
    provider = makeProvider({ ...ENV, UFOLOAD_ADULT_CONTENT_APPROVED: "false" });
    await expect(run()).rejects.toBeInstanceOf(VideoProviderConfigError);
    expect(ufo.fetchMock).not.toHaveBeenCalled();
  });

  it("clamps an absurd limit", async () => {
    seedMany(3);
    const summary = await run({ limit: 100000 });
    expect(summary.checked).toBe(3);
  });
});

describe("concurrency accounting for URL imports", () => {
  it("counts only our imports that UFOLOAD is still downloading", async () => {
    h.db.upload_jobs.push(
      { id: "1", provider: "ufoload", status: "uploading", provider_import_task_id: "imp_1" },
      { id: "2", provider: "ufoload", status: "uploading", provider_import_task_id: "imp_2" },
      { id: "3", provider: "ufoload", status: "processing", provider_import_task_id: "imp_3", provider_file_id: "01F" },
      { id: "4", provider: "ufoload", status: "uploading", provider_upload_id: "upl_4" },
      { id: "5", provider: "uqload", status: "uploading", provider_import_task_id: "legacy" }
    );
    expect(await countActiveImports(h.service as never)).toBe(2);
  });

  it("is full at UFOLOAD's limit of ten", () => {
    expect(importSlotsFull(9)).toBe(false);
    expect(importSlotsFull(10)).toBe(true);
    expect(importSlotsFull(11)).toBe(true);
  });
});

describe("provider facts stored on a published video", () => {
  it("derives HD / 4K only from the heights UFOLOAD reports", () => {
    expect(qualityLabel(null)).toBeNull();
    expect(qualityLabel(0)).toBeNull();
    expect(qualityLabel(480)).toBeNull();
    expect(qualityLabel(719)).toBeNull();
    expect(qualityLabel(720)).toBe("HD");
    expect(qualityLabel(1080)).toBe("HD");
    expect(qualityLabel(2160)).toBe("4K");
    expect(qualityLabel(4320)).toBe("4K");
  });

  it("reduces a file to duration, resolution and quality — nothing signed", () => {
    const file = parseFile({ id: "01F", status: "ready", duration_ms: 90500, width: 3840, height: 2160, max_quality: 2160, poster: "https://x/p.jpg?sig=1" });
    expect(providerDetails(file)).toEqual({ durationSeconds: 91, resolution: "3840x2160", quality: "4K" });
    expect(providerDetails(parseFile({ id: "01F", status: "ready" }))).toEqual({ durationSeconds: null, resolution: null, quality: null });
    expect(providerDetails(parseFile({ id: "01F", status: "ready", duration_ms: 200 })).durationSeconds).toBe(1);
  });
});
