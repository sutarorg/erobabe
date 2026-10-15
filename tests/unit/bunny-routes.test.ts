import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
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
} from "./helpers/video-route-harness";
import {
  POST as create,
  GET as recover,
  PATCH as reportLifecycle,
} from "@/app/api/videos/bunny/sessions/route";
import { POST as confirm } from "@/app/api/videos/bunny/confirm/route";
import {
  signUpload,
  uploadConfiguration,
  bunnyRequest,
} from "@/lib/video/bunny";
const ID = "22222222-2222-4222-8222-222222222222";
const REMOTE = "44444444-4444-4444-8444-444444444444";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
/** Constraint names as created by migration 12 (verified against PostgreSQL). */
const BUNNY_UNIQUE = {
  bunny_uploads: {
    bunny_uploads_pkey: ["id"],
    bunny_uploads_created_by_original_name_size_bytes_mime_type_key: [
      "created_by",
      "original_name",
      "size_bytes",
      "mime_type",
    ],
    bunny_uploads_library_id_provider_id_key: ["library_id", "provider_id"],
  },
};
const metadata = {
  sessionId: ID,
  title: "Clip",
  originalName: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 5,
  categoryId: CATEGORY,
};
let h: ReturnType<typeof createHarness>;
let fetchMock: ReturnType<typeof vi.fn>;
const remote = {
  guid: REMOTE,
  videoLibraryId: 123,
  status: 4,
  length: 10,
  encodeProgress: 100,
};
beforeEach(() => {
  vi.stubEnv("BUNNY_STREAM_LIBRARY_ID", "123");
  vi.stubEnv("BUNNY_STREAM_API_KEY", "test-secret");
  h = createHarness(
    { categories: [{ id: CATEGORY }], bunny_uploads: [] },
    { unique: BUNNY_UNIQUE },
  );
  vi.mocked(createClient).mockResolvedValue(h.auth);
  vi.mocked(createServiceClient).mockReturnValue(h.service);
  h.service.rpc = vi.fn(async () => ({
    data: { videoId: ID, slug: "clip" },
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function seed(state = "uploading") {
  h.db.bunny_uploads.push({
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
  });
}
describe("Bunny Stream server routes (mock provider, not live acceptance)", () => {
  it.each([create, confirm])("requires authentication first", async (route) => {
    h.auth.auth.getUser = async () => ({ data: { user: null } });
    expect(
      (await route(jsonRequest("/api/videos/bunny", metadata))).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["suspended", "disabled"])(
    "rejects %s administrators",
    async (status) => {
      h.db.profiles[0].status = status;
      expect(
        (await create(jsonRequest("/api/videos/bunny/sessions", metadata)))
          .status,
      ).toBe(403);
    },
  );
  it("rejects active non-admin", async () => {
    h.db.profiles[0].role = "advertiser";
    expect((await recover()).status).toBe(403);
  });
  it.each(["", "0", "-1", "abc", "123/path"])(
    "validates library ID %s",
    (id) => {
      vi.stubEnv("BUNNY_STREAM_LIBRARY_ID", id);
      expect(() => uploadConfiguration()).toThrow(/configuration/);
    },
  );
  it("configures four parallel uploads without an application video-size cap", () => {
    const { policy } = uploadConfiguration();
    expect(policy.concurrency).toBe(4);
    expect(policy).not.toHaveProperty("maxBytes");
  });
  it("enforces an operator-configured size limit before creating provider media", async () => {
    vi.stubEnv("BUNNY_UPLOAD_MAX_BYTES", "1024");
    expect(uploadConfiguration().policy.maxBytes).toBe(1024);
    const response = await create(
      jsonRequest("/api/videos/bunny/sessions", {
        ...metadata,
        sizeBytes: 1025,
      }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates key and expiration/signature exactly", () => {
    const signed = signUpload(REMOTE, "123", 1700000000000);
    expect(signed.expiration).toBe(1700086400);
    expect(signed.headers.AuthorizationSignature).toBe(
      createHash("sha256")
        .update(`123test-secret1700086400${REMOTE}`)
        .digest("hex"),
    );
    expect(signed.headers).toMatchObject({
      LibraryId: "123",
      VideoId: REMOTE,
      AuthorizationExpire: "1700086400",
    });
    vi.stubEnv("BUNNY_STREAM_API_KEY", "");
    expect(() => signUpload(REMOTE)).toThrow(/configuration/);
  });
  it.each([
    { mimeType: "text/html" },
    { sizeBytes: 0 },
    { originalName: "../file.mp4" },
    { sessionId: "bad" },
    { title: "" },
    { categoryId: "bad" },
  ])("rejects malformed metadata %j", async (override) => {
    expect(
      (
        await create(
          jsonRequest("/api/videos/bunny/sessions", {
            ...metadata,
            ...override,
          }),
        )
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses AccessKey only server-side and returns scoped TUS authorization", async () => {
    const response = await create(
      jsonRequest("/api/videos/bunny/sessions", metadata),
    );
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://video.bunnycdn.com/library/123/videos",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ AccessKey: "test-secret" }),
      }),
    );
    const body = await response.json();
    expect(body.videoId).toBe(REMOTE);
    expect(JSON.stringify(body)).not.toContain("test-secret");
  });
  it("accepts upload metadata larger than the former 10 GiB application limit", async () => {
    const response = await create(
      jsonRequest("/api/videos/bunny/sessions", {
        ...metadata,
        sizeBytes: 20 * 1024 ** 3,
      }),
    );
    expect(response.status).toBe(201);
  });
  it("re-signs same video and prevents duplicate creation", async () => {
    seed();
    expect(
      (await create(jsonRequest("/api/videos/bunny/sessions", metadata)))
        .status,
    ).toBe(200);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });
  it("keeps uncertain creation reservation and does not replay POST", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(
      (await create(jsonRequest("/api/videos/bunny/sessions", metadata)))
        .status,
    ).toBe(502);
    expect(
      (await create(jsonRequest("/api/videos/bunny/sessions", metadata)))
        .status,
    ).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2, 3, 7, 8])(
    "stages a private Encoding row for provider status %s without publishing",
    async (status) => {
      seed();
      fetchMock.mockResolvedValue(Response.json({ ...remote, status }));
      const response = await confirm(
        jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
      );
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        processing: true,
        slug: "clip",
        providerStatus: expect.any(String),
      });
      expect(h.service.rpc).toHaveBeenCalledWith(
        "stage_bunny_upload",
        expect.objectContaining({
          p_session: ID,
          p_provider_status: status,
          p_embed: `https://iframe.mediadelivery.net/embed/123/${REMOTE}`,
        }),
      );
      expect(h.service.rpc).not.toHaveBeenCalledWith(
        "finish_bunny_upload",
        expect.anything(),
      );
    },
  );
  it.each([5, 6])("reports provider failure %s", async (status) => {
    seed();
    fetchMock.mockResolvedValue(Response.json({ ...remote, status }));
    const response = await confirm(
      jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ failed: true });
    expect(h.service.rpc).toHaveBeenCalledWith(
      "fail_bunny_upload",
      expect.objectContaining({ p_provider_status: status }),
    );
    expect(h.service.rpc).not.toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.anything(),
    );
  });
  it("publishes only Finished with verified thumbnail via atomic RPC", async () => {
    seed();
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(200);
    expect(h.service.rpc).toHaveBeenCalledWith(
      "finish_bunny_upload",
      expect.objectContaining({
        p_embed: `https://iframe.mediadelivery.net/embed/123/${REMOTE}`,
        p_duration: 10,
      }),
    );
  });
  it("retry after DB failure only reads existing provider video", async () => {
    seed();
    h.service.rpc.mockResolvedValueOnce({ data: null, error: {} });
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(502);
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(200);
    expect(fetchMock.mock.calls.every(([, o]) => o.method === "GET")).toBe(
      true,
    );
  });
  it("allows another active admin to reconcile a shared encoding row, but rejects mismatched remote identity", async () => {
    seed();
    h.db.bunny_uploads[0].created_by = "other-admin";
    h.db.bunny_uploads[0].thumbnail_path = "other-admin/frame.jpg";
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 3 }));
    const staged = await confirm(
      jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
    );
    expect(staged.status).toBe(202);
    h.db.bunny_uploads[0].created_by = ADMIN_ID;
    h.db.bunny_uploads[0].thumbnail_path = `${ADMIN_ID}/frame.jpg`;
    fetchMock.mockResolvedValue(
      Response.json({ ...remote, videoLibraryId: 999 }),
    );
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(502);
  });
  it("rejects missing thumbnail and cross-owner path", async () => {
    seed();
    h.db.bunny_uploads[0].thumbnail_path = null;
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", {
            sessionId: ID,
            thumbnailPath: "other/frame.jpg",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("recovers completed metadata after a lost publication response without leaking ownership", async () => {
    seed("completed");
    h.db.bunny_uploads[0].title = "Edited title";
    const request = new NextRequest(
      `http://localhost/api/videos/bunny/sessions?sessionId=${ID}`,
    );
    expect((await (await recover(request)).json()).session.title).toBe(
      "Edited title",
    );
    h.db.bunny_uploads[0].created_by = "other";
    expect((await (await recover(request)).json()).session).toBeNull();
  });
  it("stores recoverable thumbnail/cancellation diagnostics and rejects cross-owner reports", async () => {
    seed();
    expect(
      (
        await reportLifecycle(
          jsonRequest(
            "/api/videos/bunny/sessions",
            { sessionId: ID, reason: "thumbnail_failed" },
            "PATCH",
          ),
        )
      ).status,
    ).toBe(200);
    expect(h.db.bunny_uploads[0].last_error).toContain("Thumbnail");
    h.db.bunny_uploads[0].created_by = "other";
    expect(
      (
        await reportLifecycle(
          jsonRequest(
            "/api/videos/bunny/sessions",
            { sessionId: ID, reason: "user_cancelled" },
            "PATCH",
          ),
        )
      ).status,
    ).toBe(404);
  });
  it("blocks publication when the thumbnail object is missing", async () => {
    seed();
    h.service.storage.from = () => ({
      getPublicUrl: () => ({
        data: { publicUrl: "https://cdn.example.com/frame.jpg" },
      }),
      list: async () => ({ data: [], error: null }),
    });
    const response = await confirm(
      jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Thumbnail storage failed");
    expect(h.service.rpc).not.toHaveBeenCalled();
  });
  it("reports auth failure without upstream private bodies", async () => {
    fetchMock.mockResolvedValue(
      new Response("test-secret private", { status: 401 }),
    );
    await expect(bunnyRequest("")).rejects.toThrow(/authentication failed/);
  });
  it("honours long rate-limit delay without immediate retry", async () => {
    fetchMock.mockResolvedValue(
      new Response("private", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    await expect(bunnyRequest("")).rejects.toMatchObject({
      status: 429,
      retryAfter: 60,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("re-selected files resume their session instead of failing to reserve", () => {
  const NEW_ID = "55555555-5555-4555-8555-555555555555";
  const OTHER_CATEGORY = "66666666-6666-4666-8666-666666666666";
  const SETTLED = "2026-01-01T00:00:00.000Z";
  const sessions = (body: Record<string, unknown>) =>
    create(jsonRequest("/api/videos/bunny/sessions", { ...metadata, ...body }));
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resumes an earlier failed session for the same file (formerly 'Session already reserved')", async () => {
    seed("failed");
    h.db.bunny_uploads[0].last_error = "Browser reported upload failure.";
    h.db.categories.push({ id: OTHER_CATEGORY });
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 0 }));
    const response = await sessions({
      sessionId: NEW_ID,
      title: "Fresh AI title",
      description: "Fresh AI description",
      categoryId: OTHER_CATEGORY,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionId: ID,
      videoId: REMOTE,
      transferred: false,
      resumed: true,
    });
    // Only the existing provider video is read; nothing new is created.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(h.db.bunny_uploads).toHaveLength(1);
    expect(h.db.bunny_uploads[0]).toMatchObject({
      id: ID,
      state: "uploading",
      last_error: null,
      title: "Fresh AI title",
      description: "Fresh AI description",
      category_id: OTHER_CATEGORY,
    });
  });

  it("reports transferred bytes so a resumed upload skips straight to confirmation", async () => {
    seed("processing");
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 3 }));
    const response = await sessions({ sessionId: NEW_ID });
    expect(await response.json()).toMatchObject({
      sessionId: ID,
      transferred: true,
    });
    expect(h.db.bunny_uploads[0].state).toBe("processing");
  });

  it("reactivates a cancelled session so its confirmation is accepted", async () => {
    seed("cancelled");
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 0 }));
    expect((await sessions({})).status).toBe(200);
    expect(h.db.bunny_uploads[0].state).toBe("uploading");
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 3 }));
    expect(
      (
        await confirm(
          jsonRequest("/api/videos/bunny/confirm", { sessionId: ID }),
        )
      ).status,
    ).toBe(202);
  });

  it("reports an already uploaded file as completed without a duplicate", async () => {
    seed("completed");
    Object.assign(h.db.bunny_uploads[0], {
      video_id: ID,
      video_slug: "clip-video",
    });
    const response = await sessions({ sessionId: NEW_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      completed: true,
      slug: "clip-video",
      sessionId: ID,
      alreadyUploaded: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.db.bunny_uploads).toHaveLength(1);
  });

  it("explains how to re-upload a file whose video was deleted", async () => {
    seed("completed");
    Object.assign(h.db.bunny_uploads[0], {
      video_id: null,
      video_slug: "clip-video",
    });
    const response = await sessions({ sessionId: NEW_ID });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(
      /video was later deleted.*rename the file/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still rejects a different file sent with an existing session ID", async () => {
    seed();
    const response = await sessions({ sizeBytes: 6 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/does not match/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resumes the winner when a concurrent request reserves the same file first", async () => {
    const realFrom = h.service.from;
    let raced = false;
    h.service.from = (table: string) => {
      const query = realFrom(table);
      if (table === "bunny_uploads" && !raced) {
        const insert = query.insert.bind(query);
        // The competing reservation commits between our lookup and our insert.
        query.insert = (values: Record<string, unknown>) => {
          raced = true;
          seed("uploading");
          return insert(values);
        };
      }
      return query;
    };
    fetchMock.mockResolvedValue(Response.json({ ...remote, status: 0 }));
    const response = await sessions({ sessionId: NEW_ID });
    expect(raced).toBe(true);
    expect(response.status).toBe(200);
    expect((await response.json()).sessionId).toBe(ID);
    expect(fetchMock.mock.calls.every(([, o]) => o.method === "GET")).toBe(
      true,
    );
    expect(h.db.bunny_uploads.map((row) => row.id)).toEqual([ID]);
  });

  it("uploads without the AI description when migration 19 is missing, and says so", async () => {
    h = createHarness(
      { categories: [{ id: CATEGORY }], bunny_uploads: [] },
      {
        unique: BUNNY_UNIQUE,
        missingColumns: { bunny_uploads: ["description"] },
      },
    );
    vi.mocked(createClient).mockResolvedValue(h.auth);
    vi.mocked(createServiceClient).mockReturnValue(h.service);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(Response.json({ guid: REMOTE }));
    const response = await sessions({ description: "AI description" });
    expect(response.status).toBe(201);
    expect((await response.json()).warning).toContain(
      "00000000000019_auto_publish_and_ai_metadata.sql",
    );
    expect(h.db.bunny_uploads).toHaveLength(1);
    expect(h.db.bunny_uploads[0]).toMatchObject({
      id: ID,
      provider_id: REMOTE,
      state: "uploading",
    });
    expect(h.db.bunny_uploads[0]).not.toHaveProperty("description");
    expect(warn).toHaveBeenCalled();
  });

  it("surfaces the actual database failure instead of a generic conflict", async () => {
    const realFrom = h.service.from;
    h.service.from = (table: string) => {
      const query = realFrom(table);
      if (table === "bunny_uploads")
        query.insert = async () => ({
          data: null,
          error: {
            code: "42501",
            message: "permission denied for table bunny_uploads",
          },
        });
      return query;
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await sessions({});
    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).toMatch(/permission denied.*service-role key.*42501/);
    expect(error).not.toMatch(/already reserved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adopts the Bunny video carrying the session marker after a lost create response", async () => {
    seed("creating");
    Object.assign(h.db.bunny_uploads[0], {
      provider_id: null,
      created_at: SETTLED,
    });
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("?search=")
        ? Response.json({
            items: [
              {
                guid: REMOTE,
                title: `Clip [session:${ID}]`,
                videoLibraryId: 123,
              },
            ],
          })
        : Response.json({ ...remote, status: 0 }),
    );
    const response = await sessions({ sessionId: NEW_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionId: ID,
      videoId: REMOTE,
      transferred: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://video.bunnycdn.com/library/123/videos?search=${ID}&itemsPerPage=100`,
    );
    expect(fetchMock.mock.calls.every(([, o]) => o.method === "GET")).toBe(
      true,
    );
    expect(h.db.bunny_uploads[0]).toMatchObject({
      provider_id: REMOTE,
      state: "uploading",
    });
  });

  it("creates exactly one video when an earlier create never reached Bunny", async () => {
    seed("failed");
    Object.assign(h.db.bunny_uploads[0], {
      provider_id: null,
      created_at: SETTLED,
    });
    fetchMock.mockImplementation(async (url: string, options: RequestInit) =>
      url.includes("?search=")
        ? Response.json({ items: [] })
        : options.method === "POST"
          ? Response.json({ guid: REMOTE })
          : Response.json({ ...remote, status: 0 }),
    );
    const response = await sessions({});
    expect(response.status).toBe(200);
    expect((await response.json()).videoId).toBe(REMOTE);
    const posts = fetchMock.mock.calls.filter(([, o]) => o.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body).title).toBe(`Clip [session:${ID}]`);
    expect(h.db.bunny_uploads[0]).toMatchObject({
      provider_id: REMOTE,
      state: "uploading",
    });
  });

  it("refuses to guess when several Bunny videos carry the session marker", async () => {
    seed("creating");
    Object.assign(h.db.bunny_uploads[0], {
      provider_id: null,
      created_at: SETTLED,
    });
    const marked = (guid: string) => ({
      guid,
      title: `Clip [session:${ID}]`,
      videoLibraryId: 123,
    });
    fetchMock.mockResolvedValue(
      Response.json({
        items: [marked(REMOTE), marked("77777777-7777-4777-8777-777777777777")],
      }),
    );
    const response = await sessions({});
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Several Bunny videos/);
    expect(fetchMock.mock.calls.some(([, o]) => o.method === "POST")).toBe(
      false,
    );
    expect(h.db.bunny_uploads[0].provider_id).toBeNull();
  });

  it("waits for a recent uncertain creation instead of duplicating it", async () => {
    seed("creating");
    Object.assign(h.db.bunny_uploads[0], {
      provider_id: null,
      created_at: new Date().toISOString(),
    });
    const response = await sessions({ sessionId: NEW_ID });
    expect(response.status).toBe(409);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
