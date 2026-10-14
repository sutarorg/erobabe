import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
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
} from "./helpers/video-route-harness";
import { POST as create } from "@/app/api/videos/filekosh/sessions/route";
import { POST as confirm } from "@/app/api/videos/filekosh/confirm/route";
import {
  confirmationBody,
  uploadConfiguration,
  filekoshRequest,
} from "@/lib/video/filekosh";
const ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const metadata = {
  sessionId: ID,
  title: "Clip",
  originalName: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 5,
  categoryId: CATEGORY,
};
const video = {
  id: "provider-id",
  slug: "provider-slug",
  title: "Clip",
  platform: "WEB",
  status: "READY",
  mimeType: "video/mp4",
  sizeBytes: 5,
  embedUrl: "https://filekosh.com/embed/provider-returned",
  url: "https://filekosh.com/w/provider-slug",
};
let h: ReturnType<typeof createHarness>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // Synthetic contract deliberately used only in mocks, NOT claimed to be the real confirmation schema.
  vi.stubEnv("FILEKOSH_API_KEY", "fk_live_test_only");
  vi.stubEnv("FILEKOSH_CONTRACT_VERIFIED", "true");
  vi.stubEnv("FILEKOSH_BROWSER_UPLOAD_VERIFIED", "true");
  vi.stubEnv("FILEKOSH_CONFIRM_BODY_TEMPLATE", '{"syntheticTestId":"{{id}}"}');
  vi.stubEnv("FILEKOSH_ALLOWED_MIME_TYPES", "video/mp4");
  vi.stubEnv("FILEKOSH_MAX_UPLOAD_BYTES", "1000");
  vi.stubEnv("FILEKOSH_UPLOAD_HEADERS_JSON", "{}");
  vi.stubEnv("FILEKOSH_UPLOAD_HOSTS", "storage.example.com");
  h = createHarness({
    categories: [{ id: CATEGORY, label: "Category" }],
    filekosh_uploads: [],
  });
  vi.mocked(createClient).mockResolvedValue(h.auth);
  vi.mocked(createServiceClient).mockReturnValue(h.service);
  h.service.rpc = vi.fn(async () => ({
    data: { videoId: ID, slug: "clip" },
    error: null,
  }));
  fetchMock = vi.fn(async () =>
    Response.json({
      id: video.id,
      slug: video.slug,
      uploadUrl: "https://storage.example.com/signed",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function seed(state = "uploading") {
  h.db.filekosh_uploads.push({
    id: ID,
    created_by: ADMIN_ID,
    confirmation_attempted: false,
    state,
    title: "Clip",
    original_name: "clip.mp4",
    size_bytes: 5,
    mime_type: "video/mp4",
    provider_id: video.id,
    provider_slug: video.slug,
  });
}
describe("FileKosh management routes", () => {
  it.each([create, confirm])(
    "requires signed-in administrator before doing anything",
    async (route) => {
      h.auth.auth.getUser = async () => ({ data: { user: null } });
      const response = await route(
        jsonRequest("/api/videos/filekosh", metadata),
      );
      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("rejects non-admin and inactive admin", async () => {
    h.db.profiles[0].status = "suspended";
    expect(
      (await create(jsonRequest("/api/videos/filekosh/sessions", metadata)))
        .status,
    ).toBe(403);
  });
  it("fails closed without verified configuration; never guesses confirmation", async () => {
    vi.stubEnv("FILEKOSH_CONFIRM_BODY_TEMPLATE", "");
    expect(() => uploadConfiguration()).toThrow(/verify/);
    expect(
      (await create(jsonRequest("/api/videos/filekosh/sessions", metadata)))
        .status,
    ).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates MIME and size on the server", async () => {
    expect(
      (
        await create(
          jsonRequest("/api/videos/filekosh/sessions", {
            ...metadata,
            sizeBytes: 1001,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await create(
          jsonRequest("/api/videos/filekosh/sessions", {
            ...metadata,
            mimeType: "application/octet-stream",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("uses server bearer auth; returns only scoped upload authorization", async () => {
    const response = await create(
      jsonRequest("/api/videos/filekosh/sessions", metadata),
    );
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://filekosh.com/api/v1/videos",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fk_live_test_only",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      platform: "WEB",
      title: "Clip",
    });
    expect(await response.text()).not.toContain("fk_live_test_only");
  });
  it("does not create twice for the same reserved session", async () => {
    seed();
    h.db.filekosh_uploads[0].upload_url = "https://storage.example.com/signed";
    expect(
      (await create(jsonRequest("/api/videos/filekosh/sessions", metadata)))
        .status,
    ).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves uncertain creation outcomes rather than blindly retrying POST", async () => {
    fetchMock.mockRejectedValue(new Error("Timeout"));
    expect(
      (await create(jsonRequest("/api/videos/filekosh/sessions", metadata)))
        .status,
    ).toBe(502);
    expect(
      (await create(jsonRequest("/api/videos/filekosh/sessions", metadata)))
        .status,
    ).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires verified READY metadata after confirmation before persistence", async () => {
    seed();
    fetchMock
      .mockResolvedValueOnce(Response.json({ status: "UPLOADING" }))
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json(video));
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://filekosh.com/api/v1/videos/confirm",
    );
    expect(h.service.rpc).toHaveBeenCalledWith(
      "finish_filekosh_upload",
      expect.objectContaining({ p_embed: video.embedUrl, p_share: video.url }),
    );
  });
  it("does not publish just because confirmation returned 200", async () => {
    seed();
    fetchMock.mockImplementation(async () => Response.json({ status: "UPLOADING" }));
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(502);
    expect(h.service.rpc).not.toHaveBeenCalled();
  });
  it("does not replay an uncertain confirmation POST", async () => {
    seed();
    fetchMock.mockImplementation(async () => Response.json({ status: "UPLOADING" }));
    await confirm(jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }));
    expect((await confirm(jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }))).status).toBe(409);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/confirm"))).toHaveLength(1);
  });
  it("reports partial DB failure; retry reads READY and does not create or PUT", async () => {
    seed();
    fetchMock.mockImplementation(async () => Response.json(video));
    h.service.rpc.mockResolvedValueOnce({
      error: { message: "db unavailable" },
      data: null,
    });
    const response = await confirm(
      jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
    );
    expect(await response.text()).toContain("database persistence failed");
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(200);
    expect(
      fetchMock.mock.calls.every(([, options]) => options.method === "GET"),
    ).toBe(true);
  });
  it("rejects other admins' sessions and mismatched provider identity", async () => {
    seed();
    h.db.filekosh_uploads[0].created_by = "other";
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(404);
    h.db.filekosh_uploads[0].created_by = ADMIN_ID;
    fetchMock.mockResolvedValue(Response.json({ ...video, id: "wrong" }));
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/filekosh/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(502);
    expect(h.service.rpc).not.toHaveBeenCalled();
  });
  it("respects long Retry-After without immediately replaying requests", async () => {
    fetchMock.mockResolvedValue(
      new Response("private upstream error", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    await expect(filekoshRequest("/videos/test")).rejects.toMatchObject({
      status: 429,
      retryAfter: 60,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("substitutes a documented template structurally, not with raw string injection", () =>
    expect(confirmationBody({ test: ["{{id}}"] }, 'x"y')).toEqual({
      test: ['x"y'],
    }));
});
