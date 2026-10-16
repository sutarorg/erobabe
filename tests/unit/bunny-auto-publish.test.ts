import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  createHarness,
  jsonRequest,
  ADMIN_ID,
  type Harness,
} from "./helpers/video-route-harness";
import { GET as publish, POST as publishOnPost } from "@/app/api/cron/bunny-publish/route";

/**
 * Background auto-publish (mock provider, not live acceptance).
 *
 * Bunny keeps encoding after the administrator closes the tab, so a scheduler
 * has to finish the job the browser started. These tests drive the sweep that
 * `/api/cron/bunny-publish` performs.
 */

const ID = "22222222-2222-4222-8222-222222222222";
const SECOND = "55555555-5555-4555-8555-555555555555";
const REMOTE = "44444444-4444-4444-8444-444444444444";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const CRON_SECRET = "schedul3r-secret-value";
const remote = {
  guid: REMOTE,
  videoLibraryId: 123,
  status: 4,
  length: 10,
  encodeProgress: 100,
};

let h: Harness;
let fetchMock: ReturnType<typeof vi.fn>;

/** A scheduler call, with or without the shared secret. */
function cronRequest(secret?: string) {
  return new NextRequest("http://localhost/api/cron/bunny-publish", {
    method: "GET",
    ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
  });
}

function seed(
  overrides: Record<string, unknown> = {},
  state = "processing",
): Record<string, unknown> {
  const row = {
    id: ID,
    created_by: ADMIN_ID,
    state,
    title: "Clip",
    original_name: "clip.mp4",
    size_bytes: 5,
    mime_type: "video/mp4",
    category_id: CATEGORY,
    provider_id: REMOTE,
    library_id: "123",
    thumbnail_path: `${ADMIN_ID}/frame.jpg`,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  h.db.bunny_uploads.push(row);
  return row;
}

beforeEach(() => {
  vi.stubEnv("BUNNY_STREAM_LIBRARY_ID", "123");
  vi.stubEnv("BUNNY_STREAM_API_KEY", "test-secret");
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  h = createHarness(
    { categories: [{ id: CATEGORY }], bunny_uploads: [] },
    {
      unique: {
        bunny_uploads: {
          bunny_uploads_pkey: ["id"],
          bunny_uploads_library_id_provider_id_key: ["library_id", "provider_id"],
        },
      },
    },
  );
  vi.mocked(createClient).mockResolvedValue(h.auth);
  vi.mocked(createServiceClient).mockReturnValue(h.service);
  // Mirrors the real functions closely enough for the sweep: each RPC returns
  // the shape the routes read.
  h.service.rpc = vi.fn(async (fn: string) => ({
    data:
      fn === "fail_bunny_upload"
        ? { videoId: ID, state: "failed", error: "Bunny Error" }
        : { videoId: ID, slug: "clip" },
    error: null,
  }));
  h.service.storage.from = () => ({
    getPublicUrl: (p: string) => ({
      data: { publicUrl: `https://cdn.example.com/${p}` },
    }),
    list: async () => ({
      data: [{ name: "frame.jpg", metadata: { size: 100 } }],
      error: null,
    }),
  });
  fetchMock = vi.fn(async () => Response.json(remote));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("background publish sweep", () => {
  it("publishes a finished encode with no browser involved", async () => {
    seed();
    const response = await publish(cronRequest(CRON_SECRET));
    expect(response.status).toBe(200);
    const summary = await response.json();
    expect(summary).toMatchObject({ checked: 1, published: 1, errors: 0 });
    expect(summary.slugs).toEqual(["clip"]);
    // Publishing runs as the administrator who uploaded the file, so the
    // database's own active-admin check is what authorizes the background run.
    expect(h.service.rpc).toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.objectContaining({
        p_session: ID,
        p_admin: ADMIN_ID,
        p_embed: `https://iframe.mediadelivery.net/embed/123/${REMOTE}`,
        p_duration: 10,
      }),
    );
    expect(h.db.bunny_uploads[0].state).toBe("ready");
  });

  it("refreshes an encode that is still running instead of publishing it", async () => {
    seed();
    fetchMock.mockResolvedValue(
      Response.json({ ...remote, status: 2, encodeProgress: 40 }),
    );
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    expect(summary).toMatchObject({ published: 0, processing: 1 });
    expect(summary.results[0]).toMatchObject({
      state: "processing",
      progress: 40,
      providerStatus: "Processing",
    });
    expect(h.service.rpc).toHaveBeenCalledWith(
      "stage_bunny_upload",
      expect.objectContaining({ p_progress: 40 }),
    );
    expect(h.service.rpc).not.toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.anything(),
    );
  });

  it("records a provider failure without publishing anything", async () => {
    seed();
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 5 }));
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    expect(summary).toMatchObject({ published: 0, failed: 1 });
    expect(h.service.rpc).toHaveBeenCalledWith(
      "fail_bunny_upload",
      expect.objectContaining({ p_provider_status: 5 }),
    );
  });

  it("keeps sweeping when one session cannot be reconciled", async () => {
    const broken = seed({ id: SECOND, provider_id: REMOTE, updated_at: new Date(0).toISOString() });
    seed();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes(String(broken.provider_id)) && broken.id === SECOND
        ? Response.json({ message: "upstream failure" }, { status: 500 })
        : Response.json(remote),
    );
    // The broken session's provider GET fails every time it is asked.
    fetchMock.mockImplementation(async () =>
      Response.json({ message: "upstream failure" }, { status: 500 }),
    );
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    expect(summary.checked).toBe(2);
    expect(summary.errors).toBe(2);
    expect(summary.published).toBe(0);
    // The next run retries them: nothing was marked finished or failed.
    expect(h.service.rpc).not.toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.anything(),
    );
  });

  it("leaves sessions alone that cannot be published without a browser", async () => {
    seed({ state: "uploading", thumbnail_path: null });
    seed({ state: "completed" });
    seed({ state: "failed" });
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    expect(summary.checked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.service.rpc).not.toHaveBeenCalled();
  });

  it("never publishes a video whose frame never reached storage", async () => {
    seed();
    h.service.storage.from = () => ({
      getPublicUrl: (p: string) => ({
        data: { publicUrl: `https://cdn.example.com/${p}` },
      }),
      list: async () => ({ data: [], error: null }),
    });
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    expect(summary).toMatchObject({ published: 0, errors: 1 });
    expect(h.service.rpc).not.toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.anything(),
    );
  });

  it("is closed to a scheduler that cannot prove itself", async () => {
    seed();
    // A scheduler holds no session cookie; the secret is all it can offer.
    h.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await publish(cronRequest())).status).toBe(401);
    expect((await publish(cronRequest("wrong-secret"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.service.rpc).not.toHaveBeenCalled();
  });

  it("lets an administrator trigger the same sweep by hand", async () => {
    seed();
    // The browser never sees CRON_SECRET, so an operator runs the sweep from
    // the admin session instead of from a scheduler.
    expect((await publish(cronRequest())).status).toBe(200);
    expect(h.service.rpc).toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.objectContaining({ p_session: ID }),
    );
    h.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await publish(cronRequest())).status).toBe(401);
  });

  it("falls back to an administrator session when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    seed();
    h.auth.auth.getUser = async () => ({ data: { user: null } });
    expect((await publish(cronRequest(CRON_SECRET))).status).toBe(401);
    h.auth.auth.getUser = async () => ({ data: { user: { id: ADMIN_ID } } });
    expect((await publish(cronRequest())).status).toBe(200);
    // The scheduler's own header is irrelevant once the secret is unset.
    expect((await publishOnPost(cronRequest(CRON_SECRET))).status).toBe(200);
  });

  it("reports a configuration failure instead of pretending to publish", async () => {
    seed();
    vi.stubEnv("BUNNY_STREAM_API_KEY", "");
    const summary = await (await publish(cronRequest(CRON_SECRET))).json();
    // The sweep itself ran; the session could not be checked, and says so.
    expect(summary).toMatchObject({ checked: 1, published: 0, errors: 1 });
    expect(summary.results[0].error).toMatch(/configuration missing/i);
    expect(h.service.rpc).not.toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.anything(),
    );
  });
});