import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () =>
          Promise.resolve({ data: [{ id: "cat", label: "Category one" }] }),
      }),
    }),
  }),
}));
vi.mock("@/src/utils/localVideoThumbnail", () => ({
  localVideoThumbnail: vi.fn(async () => ({
    thumbnail: new Blob(["jpeg"], { type: "image/jpeg" }),
    duration: 10,
  })),
}));
vi.mock("@/src/utils/uploadFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/utils/uploadFile")>()),
  uploadWithProgress: vi.fn(),
}));
vi.mock("@/src/utils/bunnyUpload", () => ({ uploadBunnyVideo: vi.fn() }));
import { uploadBunnyVideo } from "@/src/utils/bunnyUpload";
import UploadPage from "@/app/admin/(dashboard)/videos/upload/page";
import { uploadWithProgress, UploadAbortedError } from "@/src/utils/uploadFile";
const transfer = vi.mocked(uploadBunnyVideo);
let fetchMock: ReturnType<typeof vi.fn>;
let saveFails: boolean;
let encodingPending: boolean;
/** The catalog video of this file was deleted, so confirming is refused. */
let videoDeleted: boolean;
beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(uploadWithProgress).mockResolvedValue();
  saveFails = false;
  encodingPending = false;
  videoDeleted = false;
  transfer.mockImplementation(async (_url, _file, options) => {
    options?.onProgress?.({
      percent: 62,
      loaded: 62,
      total: 100,
      bytesPerSecond: 20,
    });
  });
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (!options?.body)
      return Response.json({
        policy: {
          mimeTypes: ["video/mp4"],
          concurrency: 4,
          headers: {},
        },
        sessions: [],
      });
    if (url.endsWith("/api/metadata/suggest")) {
      return Response.json({
        suggestion: {
          title: "Girlfriend Grabs My Cock Raw In The Kitchen Before Sunrise",
          description:
            "Amateur kitchen fuck filmed at home: she grabs my cock raw and rides it before sunrise. 18+ adults only, one take.",
          tags: ["amateur", "kitchen"],
          category: "Category one",
        },
        source: "ai",
        style: "explicit",
      });
    }
    if (url.endsWith("confirm")) {
      if (videoDeleted)
        return Response.json(
          {
            error:
              "This file's video was deleted from the video library, so there is nothing left to confirm. Retry to upload the file again as a new video.",
            code: "video_deleted",
          },
          { status: 409 },
        );
      if (encodingPending)
        return Response.json(
          {
            processing: true,
            slug: "saved-video",
            providerStatus: "Transcoding",
            progress: 20,
          },
          { status: 202 },
        );
      return saveFails
        ? Response.json(
            {
              error: "Bunny Finished; persistence failed. Retry confirmation.",
            },
            { status: 502 },
          )
        : Response.json({ slug: "saved-video" });
    }
    return Response.json({
      uploadUrl: "https://storage.example.com/signed",
      headers: {},
      videoId: "provider",
      storagePath: "admin/frame.jpg",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function select(
  files = [new File(["bytes"], "clip.mp4", { type: "video/mp4" })],
) {
  render(<UploadPage />);
  await waitFor(() =>
    expect(screen.getByText("Choose videos")).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("Choose video files"), {
    target: { files },
  });
  await waitFor(() =>
    expect(screen.getAllByText("Queued").length).toBe(files.length),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat" } });
}
describe("device-only upload queue", () => {
  it("has no URL ingestion and queues multiple actual files", async () => {
    await select([
      new File(["a"], "one.mp4", { type: "video/mp4" }),
      new File(["b"], "two.mp4", { type: "video/mp4" }),
    ]);
    expect(screen.queryByText(/Upload by link/i)).toBeNull();
    expect(document.querySelector('textarea, input[type="url"]')).toBeNull();
    expect(screen.getByLabelText("Choose video files")).toHaveAttribute(
      "multiple",
    );
    expect(
      screen.getByText(/no application-level video size limit/i),
    ).toBeInTheDocument();
  });
  it("rejects invalid files clearly before creating sessions", async () => {
    render(<UploadPage />);
    await waitFor(() =>
      expect(screen.getByText("Choose videos")).not.toBeDisabled(),
    );
    fireEvent.change(screen.getByLabelText("Choose video files"), {
      target: { files: [new File(["bad"], "bad.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported video type",
    );
    expect(screen.getByText("No files selected yet.")).toBeInTheDocument();
  });
  it("sends bytes directly, then confirms before completion", async () => {
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadUrl: "https://storage.example.com/signed",
      }),
      expect.any(File),
      expect.objectContaining({ title: expect.any(String) }),
    );
    expect(transfer.mock.calls[0]?.[2]?.title).not.toBe("clip");
    const postBodies = fetchMock.mock.calls
      .filter(([, o]) => o?.body)
      .map(([, o]) => o.body);
    expect(postBodies.every((b: unknown) => typeof b === "string")).toBe(true);
    expect(screen.getByText("View published video")).toHaveAttribute(
      "href",
      "/video/saved-video",
    );
    expect(screen.getByText("View in Videos")).toHaveAttribute(
      "href",
      "/admin/videos",
    );
    expect(screen.queryByText(/ready for review/i)).toBeNull();
    expect(screen.queryByText(/Recover interrupted sessions/i)).toBeNull();
  });
  it("retries database failures without re-transferring bytes", async () => {
    saveFails = true;
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(
        screen.getByText("Retry thumbnail / processing / save"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Completed")).toBeNull();
    saveFails = false;
    fireEvent.click(screen.getByText("Retry thumbnail / processing / save"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(1);
  });
  it("uploads a file again after its published video was deleted", async () => {
    videoDeleted = true;
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Retry transfer")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /deleted from the video library/,
    );
    expect(screen.queryByText("Completed")).toBeNull();
    // The retry transfers a brand-new video instead of confirming the old one.
    videoDeleted = false;
    fireEvent.click(screen.getByText("Retry transfer"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(2);
    // One reservation per attempt: the deleted session is never confirmed again.
    expect(
      fetchMock.mock.calls.filter(
        ([u, o]) => String(u).endsWith("sessions") && o?.body,
      ),
    ).toHaveLength(2);
  });
  it("removes a finished queue entry so the same file can be selected again", async () => {
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(screen.queryByText("Completed")).toBeNull());
    expect(screen.getByText("No files selected yet.")).toBeInTheDocument();
  });
  it("cancels only the in-flight transfer and leaves it retryable", async () => {
    transfer.mockImplementation(
      (_u, _f, o) =>
        new Promise((_resolve, reject) => {
          o?.signal?.addEventListener(
            "abort",
            () => reject(new UploadAbortedError()),
            { once: true },
          );
        }),
    );
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Cancel transfer")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Cancel transfer"));
    await waitFor(() =>
      expect(screen.getByText("Cancelled")).toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith("confirm")),
    ).toHaveLength(0);
  });
  it("shows real progress and does not equate transfer completion with saving", async () => {
    let finish: (() => void) | undefined;
    transfer.mockImplementation(
      (_u, _f, o) =>
        new Promise((resolve) => {
          o?.onProgress?.({
            percent: 42,
            loaded: 42,
            total: 100,
            bytesPerSecond: 1,
          });
          finish = resolve;
        }),
    );
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42"),
    );
    expect(screen.queryByText("Completed")).toBeNull();
    finish?.();
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
  });
  it("runs four simultaneous transfers and continues the queue without waiting for encoding", async () => {
    encodingPending = true;
    const resolvers: (() => void)[] = [];
    transfer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    await select(
      ["one", "two", "three", "four", "five"].map(
        (name) => new File([name], `${name}.mp4`, { type: "video/mp4" }),
      ),
    );
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() => expect(transfer).toHaveBeenCalledTimes(4));
    expect(resolvers).toHaveLength(4);
    resolvers[0]();
    await waitFor(() => expect(transfer).toHaveBeenCalledTimes(5));
    resolvers.slice(1).forEach((resolve) => resolve());
    await waitFor(() =>
      expect(screen.getAllByText("Encoding")).toHaveLength(5),
    );
    expect(screen.queryByText("Uploading…")).toBeNull();
    expect(
      screen.getByText(/Uploads continue while Bunny encodes/),
    ).toBeInTheDocument();
  });

  it("retries thumbnail storage without transferring video again", async () => {
    vi.mocked(uploadWithProgress).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(
        screen.getByText("Retry thumbnail / processing / save"),
      ).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Retry thumbnail / processing / save"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(uploadWithProgress).toHaveBeenCalledTimes(2);
  });

  it("generates AI title and description via OpenRouter for the selected category and removes session recovery UI", async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({
          policy: {
            mimeTypes: ["video/mp4"],
            concurrency: 4,
            headers: {},
          },
          sessions: [],
        });
      if (url.endsWith("/api/metadata/suggest")) {
        return Response.json({
          suggestion: {
            title: "My Amateur Girlfriend Grabs My Cock For A Raw Doggy Style Fuck",
            description:
              "Amateur fuck filmed at home: she grabs my cock, takes it raw doggy style and cums twice on camera. 18+ adults only, one take.",
            tags: ["amateur", "doggy-style", "4k"],
            category: "Category one",
          },
          source: "ai",
          style: "explicit",
        });
      }
      if (url.endsWith("confirm")) {
        return Response.json({
          slug: "amateur-cinema-neon-pulse",
          status: "published",
          visibility: "public",
          published: true,
        });
      }
      return Response.json({
        uploadUrl: "https://storage.example.com/signed",
        headers: {},
        videoId: "provider",
        storagePath: "admin/frame.jpg",
      });
    });

    await select();
    expect(screen.queryByText(/Recover interrupted sessions/i)).toBeNull();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadUrl: "https://storage.example.com/signed",
      }),
      expect.any(File),
      expect.objectContaining({
        title: "My Amateur Girlfriend Grabs My Cock For A Raw Doggy Style Fuck",
      }),
    );
    expect(screen.getByText(/1 published/i)).toBeInTheDocument();
    const metadataCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/metadata/suggest"),
    );
    const metadataPayload = JSON.parse(String(metadataCall?.[1]?.body));
    expect(metadataPayload).toMatchObject({ category: "Category one" });
    expect(metadataPayload).not.toHaveProperty("title");
    expect(metadataPayload).not.toHaveProperty("fileName");
    expect(metadataPayload).not.toHaveProperty("tags");
  });

  it("drafts the explicit title while files are still being added", async () => {
    let suggestions = 0;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({
          policy: { mimeTypes: ["video/mp4"], concurrency: 4, headers: {} },
          sessions: [],
        });
      if (url.endsWith("/api/metadata/suggest")) {
        suggestions += 1;
        return Response.json({
          suggestion: {
            title: "My Amateur Girlfriend Takes My Dick Raw On Cam In Our Apartment",
            description:
              "Amateur blowjob turned doggy style fuck with one verified 18+ couple, uncut and filmed at home on a phone in a single continuous take.",
            tags: ["amateur", "blowjob"],
            category: "Category one",
          },
          source: "ai",
        });
      }
      if (url.endsWith("confirm"))
        return Response.json({
          slug: "amateur-girlfriend-takes-dick-raw-cam-apartment",
          status: "published",
          visibility: "public",
          published: true,
        });
      return Response.json({
        uploadUrl: "https://storage.example.com/signed",
        headers: {},
        videoId: "provider",
        storagePath: "admin/frame.jpg",
      });
    });

    // Files first, category second: picking the category is enough to draft copy.
    await select([
      new File(["a"], "IMG_2041_final_v2.mp4", { type: "video/mp4" }),
    ]);

    // The queue shows real listing copy before "Start uploads" is pressed, so a
    // filename never becomes the published title.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue(
          "My Amateur Girlfriend Takes My Dick Raw On Cam In Our Apartment",
        ),
      ).toBeInTheDocument(),
    );
    // The source filename stays visible as a caption, but it is no longer the title.
    expect(
      screen.getByLabelText("Title for IMG_2041_final_v2.mp4"),
    ).toHaveValue(
      "My Amateur Girlfriend Takes My Dick Raw On Cam In Our Apartment",
    );
    expect(suggestions).toBe(1);
    // The title is already drafted, so starting must not ask the model again.
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
    expect(suggestions).toBe(1);
  });

  it("keeps retrying a genuine AI outage instead of calling a draft offline, then uses the model's own title once it recovers", async () => {
    let suggestCalls = 0;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({
          policy: { mimeTypes: ["video/mp4"], concurrency: 4, headers: {} },
          sessions: [],
        });
      if (url.endsWith("/api/metadata/suggest")) {
        suggestCalls += 1;
        if (suggestCalls === 1)
          return Response.json(
            {
              error: "The model declined to produce a suggestion for this file.",
              code: "bad_output",
            },
            { status: 502 },
          );
        return Response.json({
          suggestion: {
            title: "Girlfriend Grabs My Cock For A Raw Fuck On Cam",
            description:
              "Amateur fuck at home with a verified 18+ couple, uncut, in one continuous take, ending with a cumshot on her tits before the light changes.",
            tags: ["amateur"],
            category: "Category one",
          },
          source: "ai",
          style: "explicit",
        });
      }
      return Response.json({
        uploadUrl: "https://storage.example.com/signed",
        headers: {},
        videoId: "provider",
        storagePath: "admin/frame.jpg",
      });
    });

    await select();
    // While the first attempt is failing, the entry is left waiting on the AI
    // (never handed an offline draft), and the retry is automatic.
    await waitFor(() =>
      expect(screen.getByText(/Waiting for AI title/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/declined to produce a suggestion for this file/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/keeps retrying automatically; the upload will not start until it succeeds/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Written offline|offline/i)).toBeNull();
    // Once the model answers, its own title is used and the notice clears.
    await waitFor(
      () =>
        expect(
          screen.getByDisplayValue("Girlfriend Grabs My Cock For A Raw Fuck On Cam"),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText(/Waiting for AI title/)).toBeNull();
    expect(suggestCalls).toBe(2);
  });

  describe("asking the metadata route again before drafting in the browser", () => {
    const aiDraft = {
      suggestion: {
        title: "My Amateur Girlfriend Rides My Cock Raw On The Couch",
        description:
          "Amateur couch fuck filmed at home: she rides my cock raw, switches to doggy style and finishes me on camera. 18+ adults only.",
        tags: ["amateur"],
        category: "Category one",
      },
      source: "ai",
      style: "explicit",
    };

    function routeAnswering(...replies: Array<() => Response | Promise<Response>>) {
      const calls: number[] = [];
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (!options?.body)
          return Response.json({
            policy: { mimeTypes: ["video/mp4"], concurrency: 4, headers: {} },
            sessions: [],
          });
        if (url.endsWith("/api/metadata/suggest")) {
          calls.push(Date.now());
          const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
          return reply();
        }
        return Response.json({
          uploadUrl: "https://storage.example.com/signed",
          headers: {},
          videoId: "provider",
          storagePath: "admin/frame.jpg",
        });
      });
      return calls;
    }

    it("shows no notice at all when the model's draft is used", async () => {
      const calls = routeAnswering(() => Response.json(aiDraft));
      await select();
      await waitFor(() =>
        expect(screen.getByDisplayValue(aiDraft.suggestion.title)).toBeInTheDocument(),
      );
      expect(calls).toHaveLength(1);
      expect(screen.queryByText(/AI copy unavailable|offline/i)).toBeNull();
    });

    it("waits out a rate limit, then uses the model's draft", async () => {
      const calls = routeAnswering(
        () =>
          Response.json(
            { error: "Too many suggestion requests — try again shortly", retryAfter: 1 },
            { status: 429, headers: { "Retry-After": "1" } },
          ),
        () => Response.json(aiDraft),
      );
      await select();
      await waitFor(
        () => expect(screen.getByDisplayValue(aiDraft.suggestion.title)).toBeInTheDocument(),
        { timeout: 4000 },
      );
      expect(calls).toHaveLength(2);
      expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(900);
      expect(screen.queryByText(/AI copy unavailable|offline/i)).toBeNull();
    });

    it("retries an unreachable route before composing a draft in the browser", async () => {
      const calls = routeAnswering(
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => Response.json(aiDraft),
      );
      await select();
      await waitFor(
        () => expect(screen.getByDisplayValue(aiDraft.suggestion.title)).toBeInTheDocument(),
        { timeout: 4000 },
      );
      expect(calls).toHaveLength(2);
      expect(screen.queryByText(/AI copy unavailable|offline/i)).toBeNull();
    });
  });
});

describe("re-selected files and server session recovery", () => {
  const policyResponse = () =>
    Response.json({
      policy: { mimeTypes: ["video/mp4"], concurrency: 4, headers: {} },
      sessions: [],
    });
  const target = {
    uploadUrl: "https://storage.example.com/signed",
    headers: {},
    videoId: "provider",
    storagePath: "admin/frame.jpg",
  };
  /** Routes the session reservation to `session`; everything else succeeds. */
  function serverReturns(session: (body: any) => Record<string, unknown>) {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (!options?.body) return policyResponse();
      if (url.endsWith("/api/metadata/suggest")) {
        return Response.json({
          suggestion: {
            title: "Girlfriend Grabs My Cock Raw In The Kitchen Before Sunrise",
            description:
              "Amateur kitchen fuck filmed at home: she grabs my cock raw and rides it before sunrise. 18+ adults only, one take.",
            tags: ["amateur", "kitchen"],
            category: "Category one",
          },
          source: "ai",
          style: "explicit",
        });
      }
      if (
        url.endsWith("/api/videos/bunny/sessions") &&
        options.method === "POST"
      )
        return Response.json(session(JSON.parse(String(options.body))));
      if (url.endsWith("confirm"))
        return Response.json({ slug: "saved-video" });
      return Response.json(target);
    });
  }
  const calls = (suffix: string, method = "POST") =>
    fetchMock.mock.calls
      .filter(([u, o]) => String(u).endsWith(suffix) && o?.method === method)
      .map(([, o]) => JSON.parse(String(o.body)));

  it("continues on the earlier server session that the re-selected file resumed", async () => {
    serverReturns(() => ({
      ...target,
      sessionId: "earlier-session",
      resumed: true,
    }));
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(calls("confirm").map((b) => b.sessionId)).toEqual([
      "earlier-session",
    ]);
  });

  it("shows an already uploaded file as completed without uploading it again", async () => {
    serverReturns(() => ({
      completed: true,
      slug: "existing-video",
      sessionId: "earlier-session",
      alreadyUploaded: true,
    }));
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(screen.getByText(/already uploaded earlier/i)).toBeInTheDocument();
    expect(screen.getByText("View published video")).toHaveAttribute(
      "href",
      "/video/existing-video",
    );
    expect(transfer).not.toHaveBeenCalled();
    expect(calls("confirm")).toHaveLength(0);
  });

  it("shows the server's database migration warning", async () => {
    serverReturns((body) => ({
      ...target,
      sessionId: body.sessionId,
      warning:
        "Database migration 00000000000019_auto_publish_and_ai_metadata.sql has not been applied.",
    }));
    await select();
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/00000000000019_auto_publish_and_ai_metadata\.sql/),
    ).toBeInTheDocument();
  });

  it("never uploads one source twice when two queue entries resolve to the same session", async () => {
    serverReturns(() => ({ ...target, sessionId: "shared-session" }));
    await select([
      new File(["a"], "one.mp4", { type: "video/mp4" }),
      new File(["b"], "two.mp4", { type: "video/mp4" }),
    ]);
    fireEvent.click(screen.getByText("Start uploads"));
    await waitFor(() =>
      expect(screen.getByText("Completed")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/already being uploaded by another entry/i),
      ).toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledTimes(1);
    // The duplicate entry must not mark the shared session as failed.
    expect(calls("/api/videos/bunny/sessions", "PATCH")).toHaveLength(0);
  });
});
