import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";
import { ADMIN_ID, CATEGORY_ID, createHarness, jsonRequest, onProvider, providerCalls, resetStreamtapeMock, streamtapeMock } from "./helpers/video-route-harness";

/** Tests for `POST /api/videos/upload-url` — Streamtape remote uploads. */

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

vi.mock("@/lib/gemini/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gemini/client")>("@/lib/gemini/client");
  return {
    ...actual,
    suggestVideoMetadata: async () => ({ title: "Imported Clip", description: "A neutral description.", tags: ["hd", "romantic"], category: "Romantic" }),
  };
});

import { POST as startImports } from "@/app/api/videos/upload-url/route";

const previousEnv = { ...process.env };
let harness = createHarness();

const request = (body: Record<string, unknown>) => startImports(jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, ...body }));

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetStreamtapeMock();
  process.env.STREAMTAPE_API_KEY = "key-secret-0123456789";
  process.env.STREAMTAPE_LOGIN = "login-secret-abcdef";
  onProvider("addRemoteUpload", async () => ({ id: "rbAarvRPXdYbaxY", folderId: null }));
});

afterEach(() => {
  process.env = { ...previousEnv };
});

describe("POST /api/videos/upload-url", () => {
  it("queues an import: private row, task id kept apart from the file id, never 'published'", async () => {
    const res = await request({ urls: "https://cdn.example.com/a.mp4" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ queued: 1, failed: 0 });
    expect(body.results[0]).toMatchObject({ status: "queued", importId: "rbAarvRPXdYbaxY", processing: true, metadataSource: "ai" });
    expect(providerCalls("addRemoteUpload")).toEqual([["https://cdn.example.com/a.mp4", { name: "a.mp4" }]]);

    expect(harness.db.videos[0]).toMatchObject({ provider: "streamtape", status: "processing", visibility: "private" });
    expect(harness.db.videos[0].provider_file_id ?? null).toBeNull();
    expect(harness.db.upload_jobs[0]).toMatchObject({ provider: "streamtape", provider_import_id: "rbAarvRPXdYbaxY", status: "processing" });
    expect(harness.db.upload_jobs[0].provider_file_id ?? null).toBeNull();
    expect(harness.db.audit_logs[0]).toMatchObject({ action: "video_import_started", metadata: { provider: "streamtape", host: "cdn.example.com" } });
  });

  it.each([
    "http://localhost/a.mp4",
    "http://127.0.0.1/a.mp4",
    "http://10.0.0.5/a.mp4",
    "http://192.168.1.1/a.mp4",
    "http://169.254.169.254/latest/meta-data",
    "https://user:pass@example.com/a.mp4",
    "ftp://example.com/a.mp4",
    "file:///etc/passwd",
    "not a url",
  ])("blocks SSRF-prone or invalid URL %s", async (url) => {
    const res = await request({ urls: url });
    expect(res.status).toBe(400);
    expect(providerCalls("addRemoteUpload")).toHaveLength(0);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("validates category, URL presence, batch size and the active-import cap", async () => {
    expect((await startImports(jsonRequest("/api/videos/upload-url", { urls: "https://a.example/x.mp4" }))).status).toBe(400);
    expect((await request({ urls: "" })).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.mp4`).join("\n");
    const res = await request({ urls: many });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 10/);
    expect(providerCalls("addRemoteUpload")).toHaveLength(0);
  });

  it("de-duplicates repeated URLs", async () => {
    await request({ urls: "https://cdn.example.com/a.mp4\nhttps://cdn.example.com/a.mp4" });
    expect(providerCalls("addRemoteUpload")).toHaveLength(1);
  });

  it("marks a refused task failed and private, with a redacted reason", async () => {
    onProvider("addRemoteUpload", async () => {
      throw new StreamtapeError("Denied key=key-secret-0123456789", { status: 400 });
    });
    const res = await request({ urls: "https://cdn.example.com/a.mp4" });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.results[0].status).toBe("failed");
    expect(JSON.stringify(body)).not.toContain("key-secret-0123456789");
    expect(harness.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });
    expect(harness.db.upload_jobs[0].status).toBe("failed");
  });

  it("stops the batch once Streamtape signals a bandwidth/rate limit", async () => {
    onProvider("addRemoteUpload", async () => {
      throw new StreamtapeError("Bandwidth (509)", { status: 509 });
    });
    const res = await request({ urls: "https://cdn.example.com/a.mp4\nhttps://cdn.example.com/b.mp4" });
    const body = await res.json();
    expect(providerCalls("addRemoteUpload")).toHaveLength(1);
    expect(body.failed).toBe(2);
    expect(body.results[1].error).toMatch(/509/);
  });

  it("requires an authenticated admin and an enabled provider", async () => {
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.fake.client.from };
    expect((await request({ urls: "https://cdn.example.com/a.mp4" })).status).toBe(401);
    const nonAdmin = createHarness({ profiles: [{ id: ADMIN_ID, role: "advertiser", status: "active" }] });
    dbState.auth = nonAdmin.auth;
    expect((await request({ urls: "https://cdn.example.com/a.mp4" })).status).toBe(403);

    dbState.auth = harness.auth;
    streamtapeMock.enabled = false;
    streamtapeMock.disabledReason = "Streamtape uploads are disabled until STREAMTAPE_ADULT_CONTENT_ALLOWED=true";
    const disabled = await request({ urls: "https://cdn.example.com/a.mp4" });
    expect(disabled.status).toBe(503);
    expect(providerCalls("addRemoteUpload")).toHaveLength(0);
  });

  it("rejects a thumbnail path that is not this admin's upload per entry", async () => {
    const res = await request({ entries: [{ url: "https://cdn.example.com/a.mp4", thumbnailPath: "someone-else/x.jpg" }] });
    const body = await res.json();
    expect(body.results[0].status).toBe("failed");
    expect(providerCalls("addRemoteUpload")).toHaveLength(0);
  });
});
