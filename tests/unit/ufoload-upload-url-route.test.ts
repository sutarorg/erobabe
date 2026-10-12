import { describe, it, expect, vi, beforeEach } from "vitest";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import {
  ADMIN_ID,
  CATEGORY_ID,
  createHarness,
  jsonRequest,
  onProvider,
  providerCalls,
  resetUfoloadMock,
  ufoloadMock,
} from "./helpers/video-route-harness";

/**
 * Tests for `POST /api/videos/upload-url` — URL imports.
 *
 * A UFOLOAD import is asynchronous, so the contract under test is deliberately
 * modest: the route reports `queued` (never `published`), records the provider's
 * *task* id, keeps every row private, and stops the batch when the provider
 * refuses more concurrent imports.
 */

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  return {
    ...actual,
    suggestVideoMetadata: async (params: { fileName?: string }) => ({
      title: "Imported from the web",
      description: `Metadata suggestion for ${params.fileName || "the file"}.`,
      tags: ["import"],
      category: "Boudoir",
      reasoning: "stub",
    }),
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

import { POST as startImports } from "@/app/api/videos/upload-url/route";

let harness = createHarness();

function importTask(overrides: Record<string, unknown> = {}) {
  return {
    id: `imp_${Math.random().toString(36).slice(2, 8)}`,
    url: "https://example.com/a.mp4",
    name: "a.mp4",
    status: "queued",
    progress: 0,
    error: null,
    fileId: null,
    createdAt: "2026-10-12T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  harness = createHarness();
  dbState.auth = harness.auth;
  dbState.service = harness.service;
  resetUfoloadMock();
});

describe("POST /api/videos/upload-url", () => {
  it("starts one asynchronous import and reports it as queued, not published", async () => {
    onProvider("createImport", async () => importTask({ id: "imp_1" }));

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: "https://example.com/a.mp4" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ queued: 1, succeeded: 1, failed: 0 });
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      remoteUrl: "https://example.com/a.mp4",
      importId: "imp_1",
      status: "queued",
      processing: true,
      providerStatus: "queued",
    });
    expect(body.note).toMatch(/background/i);

    // The task id is a task id, and the row waits for the provider.
    const job = harness.db.upload_jobs[0];
    expect(job).toMatchObject({ provider: "ufoload", provider_import_id: "imp_1", status: "processing" });
    expect(job.provider_file_id).toBeUndefined();
    expect(harness.db.videos[0]).toMatchObject({
      provider: "ufoload",
      status: "processing",
      visibility: "private",
      rights_status: "cleared",
    });
    expect(harness.db.videos[0].published_at).toBeUndefined();
    expect(harness.db.videos[0].provider_file_id).toBeUndefined();

    // The audit trail names the host and the task, never a secret.
    expect(harness.db.audit_logs[0]).toMatchObject({ action: "video_import_started", actor_id: ADMIN_ID });
    expect(harness.db.audit_logs[0].metadata).toMatchObject({ provider: "ufoload", host: "example.com", import_task_id: "imp_1" });
    expect(JSON.stringify(body)).not.toContain("ufo_test_key");
  });

  it("accepts a list of URLs and reports one result per link", async () => {
    let call = 0;
    onProvider("createImport", async () => importTask({ id: `imp_${++call}` }));

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", {
        categoryId: CATEGORY_ID,
        urls: "https://example.com/a.mp4\nhttps://example.com/b.mp4",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.map((row: any) => row.remoteUrl)).toEqual([
      "https://example.com/a.mp4",
      "https://example.com/b.mp4",
    ]);
    expect(body.queued).toBe(2);
    expect(harness.db.videos).toHaveLength(2);
  });

  it("keeps the batch alive when one entry fails, and answers 207", async () => {
    onProvider("createImport", async (request: { url: string }) => {
      if (request.url.includes("bad")) throw new UfoloadError("The source URL is not reachable.", { status: 400 });
      return importTask({ id: "imp_good" });
    });

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", {
        categoryId: CATEGORY_ID,
        entries: [{ source: "https://example.com/bad.mp4" }, { source: "https://example.com/good.mp4" }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(207);
    expect(body).toMatchObject({ queued: 1, failed: 1 });
    expect(body.results[0]).toMatchObject({ status: "failed", error: "The source URL is not reachable." });
    expect(body.results[1]).toMatchObject({ status: "queued" });
  });

  it("reports 422 when the provider accepts nothing", async () => {
    onProvider("createImport", async () => {
      throw new UfoloadError("The source server refused the download.", { status: 400 });
    });

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: "https://example.com/a.mp4" })
    );
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body).toMatchObject({ queued: 0, failed: 1 });
  });

  it("stops the batch when the provider is at its concurrent-import limit", async () => {
    onProvider("createImport", async () => {
      throw new UfoloadError("UFOLOAD allows at most 10 active imports at a time.", {
        status: 429,
        code: "too_many_active",
      });
    });

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", {
        categoryId: CATEGORY_ID,
        urls: "https://example.com/a.mp4\nhttps://example.com/b.mp4\nhttps://example.com/c.mp4",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    // Only the first link was offered to the provider; the rest were skipped.
    expect(providerCalls("createImport")).toHaveLength(1);
    expect(body.results.every((row: any) => row.status === "failed")).toBe(true);
    expect(body.results[1].error).toMatch(/active imports/i);
  });

  it("refuses more URLs than one request may carry", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.mp4`).join("\n");
    const res = await startImports(jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/10 active imports/);
    expect(providerCalls("createImport")).toHaveLength(0);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("rejects non-public or malformed links with a 400, not a server error", async () => {
    for (const url of ["http://127.0.0.1/a.mp4", "http://localhost/a.mp4", "ftp://example.com/a.mp4", "not-a-url"]) {
      const res = await startImports(jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: url }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/URL/i);
    }
    expect(providerCalls("createImport")).toHaveLength(0);
  });

  it("requires a category, and at least one URL", async () => {
    const noCategory = await startImports(
      jsonRequest("/api/videos/upload-url", { urls: "https://example.com/a.mp4" })
    );
    expect(noCategory.status).toBe(400);
    expect((await noCategory.json()).error).toMatch(/category/i);

    const noUrls = await startImports(jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: "" }));
    expect(noUrls.status).toBe(400);

    expect(providerCalls("createImport")).toHaveLength(0);
  });

  it("attaches a per-entry thumbnail and fails only that entry when it is invalid", async () => {
    onProvider("createImport", async () => importTask({ id: "imp_1" }));

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", {
        categoryId: CATEGORY_ID,
        entries: [
          { source: "https://example.com/a.mp4", thumbnailPath: `${ADMIN_ID}/cover.jpg` },
          { source: "https://example.com/b.mp4", thumbnailPath: "someone-else/cover.jpg" },
        ],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(207);
    expect(harness.db.videos[0].thumbnail_url).toBe(
      `https://cdn.example.com/video-thumbnails/${ADMIN_ID}/cover.jpg`
    );
    expect(body.results[1]).toMatchObject({ status: "failed" });
    expect(body.results[1].error).toMatch(/not a valid upload for this account/i);
  });

  it("fails closed when UFOLOAD is not configured", async () => {
    ufoloadMock.enabled = false;
    ufoloadMock.disabledReason = "Set UFOLOAD_API_KEY (server-only) to the API key from the UFOLOAD dashboard.";

    const res = await startImports(
      jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: "https://example.com/a.mp4" })
    );
    expect(res.status).toBe(503);
    expect(providerCalls("createImport")).toHaveLength(0);
    expect(harness.db.videos).toHaveLength(0);
  });

  it("requires an active admin", async () => {
    dbState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harness.auth.from };
    const res = await startImports(
      jsonRequest("/api/videos/upload-url", { categoryId: CATEGORY_ID, urls: "https://example.com/a.mp4" })
    );
    expect(res.status).toBe(401);
    expect(providerCalls("createImport")).toHaveLength(0);
  });
});
