import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Link from "next/link";

/**
 * Tests for the admin publishing page (`/admin/videos/upload`).
 *
 * The page is the only UI that changed with the UFOLOAD migration, and these
 * tests pin the behaviour that matters:
 *   - video bytes go straight from the browser to the UFOLOAD node URL, in
 *     chunks, authenticated with the upload grant (never the API key);
 *   - the completion call carries an upload *session* id, not a file id;
 *   - a row is only shown as published once the provider reports ready;
 *   - a cancelled transfer asks UFOLOAD to free its concurrency slot.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [{ id: "cat-1", label: "Mature" }], error: null }),
      }),
    }),
  }),
}));

const UploadPage = (await import("@/app/admin/videos/upload/page")).default;

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

interface RecordedRequest {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

interface ChunkCall {
  method: string;
  url: string;
  offset: number;
  length: number;
  headers: Record<string, string>;
  withCredentials: boolean;
  aborted: boolean;
}

const NODE_URL = "https://upload.ufoload.com/17/_node/v1/ingest/upl_1";
const GRANT_HEADER = "UfoGrant 5f2c1e";

let requests: RecordedRequest[] = [];
let chunks: ChunkCall[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestBody(init?: RequestInit) {
  if (!init?.body) return null;
  try {
    return JSON.parse(String(init.body));
  } catch {
    return null;
  }
}

/** `fetch` stub that records every call and routes it to `handler`. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method || "GET", body: requestBody(init), headers: (init.headers || {}) as Record<string, string> });
      return handler(url, init);
    })
  );
}

/**
 * XHR stub for the chunk PUTs.
 *
 * `settle: false` keeps a transfer open, which is how the cancel test sees an
 * upload that is genuinely in flight.
 */
function stubChunkXhr(options: { settle?: boolean; status?: number; responseText?: string } = {}) {
  const { settle = true, status = 204, responseText = "" } = options;

  class StubChunkXhr {
    upload: any = {};
    status = 0;
    responseText = "";
    withCredentials = false;
    responseType = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;

    private call: ChunkCall = { method: "", url: "", offset: -1, length: 0, headers: {}, withCredentials: false, aborted: false };

    open(method: string, url: string) {
      this.call.method = method;
      this.call.url = url;
      const parsed = new URL(url);
      this.call.offset = Number(parsed.searchParams.get("offset"));
      chunks.push(this.call);
    }

    setRequestHeader(name: string, value: string) {
      this.call.headers[name] = value;
    }

    abort() {
      this.call.aborted = true;
      this.onabort?.();
    }

    send(body: any) {
      this.call.length = Number(body?.size || 0);
      this.call.withCredentials = this.withCredentials;
      if (!settle) return;
      // The browser reports progress before the node answers.
      this.upload.onprogress?.({ lengthComputable: true, loaded: this.call.length, total: this.call.length });
      this.upload.onload?.();
      this.status = status;
      this.responseText = responseText;
      this.onload?.();
    }
  }

  vi.stubGlobal("XMLHttpRequest", StubChunkXhr as unknown as typeof XMLHttpRequest);
}

/**
 * A real (tiny) video file.
 *
 * The bytes are genuine so `Blob.slice()` reports the same size the chunk
 * planner used — faking `size` would desync the plan from the slices.
 */
function videoFile(name: string, size: number) {
  return new File([new Uint8Array(size)], name, { type: "video/mp4" });
}

function addVideoFiles(files: File[]) {
  const input = document.querySelector('label input[type="file"][accept="video/*"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

async function chooseCategory() {
  const select = await screen.findByLabelText("Category *");
  await waitFor(() => expect(within(select).queryByText("Mature")).toBeTruthy());
  fireEvent.change(select, { target: { value: "cat-1" } });
}

function submitForm() {
  fireEvent.submit(screen.getByText(/Generate AI metadata & publish/).closest("form") as HTMLFormElement);
}

/** The session + completion answers a happy-path upload needs. */
function uploadRoutes(overrides: Record<string, (url: string, init: RequestInit) => Response> = {}) {
  return (url: string, init: RequestInit): Response => {
    for (const [fragment, answer] of Object.entries(overrides)) {
      if (url.includes(fragment)) return answer(url, init);
    }
    if (url.includes("/api/videos/ufoload-session")) {
      return json({
        uploadId: "upl_1",
        jobId: "job-1",
        url: NODE_URL,
        authorization: GRANT_HEADER,
        chunkSize: 4,
        maxBytes: 2 * 1024 * 1024 * 1024,
        expiresAt: "2026-10-12T14:00:00Z",
        keepAliveIntervalMs: 300000,
      });
    }
    if (url.includes("/api/videos/upload")) {
      return json({
        videoId: "video-1",
        jobId: "job-1",
        providerFileId: "01J6FSPD0S1N7M4HP2Y7Z1B5GE",
        providerPublicId: "aBcD1234xyz",
        providerStatus: "ready",
        status: "ready",
        processing: false,
        progress: 100,
        metadata: { title: "My Trip", description: "A clip.", tags: ["mature"], source: "ai" },
        metadataSource: "ai",
        video: { slug: "my-trip-abc12345" },
      });
    }
    if (url.includes("/api/videos/status")) {
      return json({ providerState: "ready", note: "UFOLOAD confirmed this video is ready.", video: {}, job: {} });
    }
    if (url.includes("/api/gemini/suggest")) {
      return json({
        suggestion: { title: "My Trip", description: "A prepared description for the clip.", tags: ["mature"], category: "Mature" },
      });
    }
    return json({ error: `unexpected request to ${url}` }, 500);
  };
}

function findRequest(fragment: string) {
  return requests.find((request) => request.url.includes(fragment));
}

beforeEach(() => {
  requests = [];
  chunks = [];
  vi.clearAllMocks();
  (URL as any).createObjectURL = () => "blob:mock-preview";
  (URL as any).revokeObjectURL = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --------------------------------------------------------------------------

describe("admin publish videos page", () => {
  it("offers the three publishing methods", async () => {
    render(<UploadPage />);
    expect(await screen.findByText("Publish videos")).toBeTruthy();
    expect(screen.getByText("Upload videos")).toBeTruthy();
    expect(screen.getByText("Embed by iframe")).toBeTruthy();
    expect(screen.getByText("Upload by link")).toBeTruthy();
  });

  it("gives every pasted iframe its own thumbnail control", async () => {
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));

    const textarea = screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/);
    fireEvent.change(textarea, {
      target: {
        value: '<iframe src="https://a.example/1"></iframe>\n<iframe src="https://a.example/2"></iframe>',
      },
    });
    fireEvent.click(screen.getByText("Add embed"));

    const entries = screen.getAllByLabelText(/^Iframe URL or embed code$/);
    expect(entries).toHaveLength(2);

    expect(screen.getAllByText("Thumbnail")).toHaveLength(2);
    expect(screen.getAllByText("Add image")).toHaveLength(2);

    expect((entries[0] as HTMLInputElement).value).toContain("a.example/1");
    fireEvent.change(entries[1], { target: { value: "https://a.example/edited" } });
    expect((screen.getAllByLabelText(/^Iframe URL or embed code$/)[1] as HTMLInputElement).value).toBe(
      "https://a.example/edited"
    );
  });

  it("gives every pasted link its own thumbnail control", async () => {
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));

    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn/1.mp4\nhttps://cdn/2.mp4\nhttps://cdn/3.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));

    expect(screen.getAllByLabelText(/^Direct video URL$/)).toHaveLength(3);
    expect(screen.getAllByText("Add image")).toHaveLength(3);
  });

  it("requires a category before publishing", async () => {
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));
    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn/1.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));

    submitForm();
    expect(await screen.findByText("Choose a category before publishing.")).toBeTruthy();
  });

  it("keeps the category link working", async () => {
    render(<UploadPage />);
    const link = (await screen.findByText("Manage categories")).closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/categories");
    expect(Link).toBeTruthy();
  });

  it("reports a non-JSON host error as a readable message, not a parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Request Entity Too Large", { status: 413, headers: { "content-type": "text/plain" } }))
    );

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), {
      target: { value: "https://a.example/1" },
    });
    fireEvent.click(screen.getByText("Add embed"));
    fireEvent.change(await screen.findByLabelText("Category *"), { target: { value: "cat-1" } });

    submitForm();

    const message = await screen.findByText(/4\.5 MB/);
    expect(message.textContent).not.toContain("Unexpected token");
  });
});

describe("direct UFOLOAD upload from the browser", () => {
  it("asks for a session, PUTs the chunks to the node URL, and completes with the session id", async () => {
    stubFetch(uploadRoutes());
    stubChunkXhr();

    render(<UploadPage />);
    addVideoFiles([videoFile("my trip.mp4", 10)]);
    expect(await screen.findByText("my trip.mp4")).toBeTruthy();
    await chooseCategory();
    submitForm();

    expect(await screen.findByText("Published · UFOLOAD has the video ready to play")).toBeTruthy();

    // 1. The server hands out an upload-scoped session.
    const session = findRequest("/api/videos/ufoload-session");
    expect(session?.body).toEqual({ fileName: "my trip.mp4", fileSize: 10, mimeType: "video/mp4" });

    // 2. Ten bytes travel as 4 + 4 + 2, straight to the node URL, in order.
    expect(chunks.map((chunk) => [chunk.method, chunk.offset, chunk.length])).toEqual([
      ["PUT", 0, 4],
      ["PUT", 4, 4],
      ["PUT", 8, 2],
    ]);
    for (const chunk of chunks) {
      expect(chunk.url.startsWith(NODE_URL)).toBe(true);
      expect(chunk.headers.Authorization).toBe(GRANT_HEADER);
      expect(chunk.headers["Content-Length"]).toBeUndefined();
      expect(chunk.withCredentials).toBe(false);
    }

    // 3. Completion carries the session id — and never a provider file id.
    const completion = findRequest("/api/videos/upload");
    expect(completion?.body).toMatchObject({
      uploadId: "upl_1",
      jobId: "job-1",
      categoryId: "cat-1",
      fileName: "my trip.mp4",
    });
    expect(completion?.body.providerFileId).toBeUndefined();
    expect(completion?.body.filecode).toBeUndefined();
    // Metadata was prepared while the bytes travelled, so it is reused.
    expect(completion?.body.metadata).toEqual({
      title: "My Trip",
      description: "A prepared description for the clip.",
      tags: ["mature"],
      source: "ai",
    });

    // No secret ever reaches the browser-facing requests.
    for (const request of requests) {
      expect(JSON.stringify(request.body ?? {})).not.toMatch(/ufo_[A-Za-z0-9]{8,}/);
    }
  });

  it("sends several videos at the same time and shows the batch", async () => {
    stubFetch(uploadRoutes());
    stubChunkXhr({ settle: false });

    render(<UploadPage />);
    addVideoFiles([videoFile("one.mp4", 4), videoFile("two.mp4", 4), videoFile("three.mp4", 4)]);
    await chooseCategory();
    submitForm();

    // All three requests for a session are issued without waiting for each other.
    await waitFor(() => expect(requests.filter((request) => request.url.includes("ufoload-session"))).toHaveLength(3));
    await waitFor(() => expect(chunks.length).toBe(3));

    const panel = await screen.findByRole("status");
    expect(within(panel).getByText(/3 uploading/)).toBeTruthy();
    expect(within(panel).getByText(/0 of 3 finished/)).toBeTruthy();
    // No invented speed or ETA in the batch summary.
    expect(within(panel).queryByText(/MB\/s|KB\/s/)).toBeNull();
  });

  it("starts the first chunk before the thumbnail has finished uploading", async () => {
    stubFetch(
      uploadRoutes({
        "storage-token": () => new Promise(() => {}) as unknown as Response,
      })
    );
    stubChunkXhr({ settle: false });

    const { container } = render(<UploadPage />);
    addVideoFiles([videoFile("with-cover.mp4", 4)]);
    const thumbnail = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement;
    fireEvent.change(thumbnail, { target: { files: [new File([new Uint8Array(64)], "cover.jpg", { type: "image/jpeg" })] } });
    await chooseCategory();
    submitForm();

    await waitFor(() => expect(chunks.length).toBeGreaterThan(0), { timeout: 4000 });
  });

  it("keeps a row that is still encoding and lets the admin re-check it", async () => {
    // The page polls a still-encoding video every few seconds for many minutes;
    // fake timers let the whole window pass without a real wait.
    stubFetch(
      uploadRoutes({
        "/api/videos/upload": () =>
          json({
            videoId: "video-1",
            jobId: "job-1",
            providerStatus: "processing",
            status: "processing",
            processing: true,
            progress: 12,
            metadata: { title: "My Trip", description: "A clip.", tags: ["mature"], source: "ai" },
            metadataSource: "ai",
            video: { slug: "my-trip-abc12345" },
          }),
        "/api/videos/status": (_url, init) => json({ providerState: "processing", note: "UFOLOAD is still processing this video." }),
      })
    );
    stubChunkXhr();

    render(<UploadPage />);
    addVideoFiles([videoFile("slow.mp4", 4)]);
    await chooseCategory();

    vi.useFakeTimers();
    await act(async () => {
      submitForm();
      // Past the whole polling window (24 checks, 5 s apart).
      await vi.advanceTimersByTimeAsync(24 * 5000 + 5000);
    });

    const terminal = screen.getByText(/still encoding — this row publishes itself/);
    expect(terminal).toBeTruthy();
    // The row was polled with the job id the server returned.
    const polls = requests.filter((request) => request.url.includes("/api/videos/status"));
    expect(polls.length).toBeGreaterThan(1);
    expect(polls[0].url).toContain("jobId=job-1");
    // It is actionable: a re-check is offered instead of an endless spinner.
    const recheck = screen.getByText("Re-check status");

    stubFetch(uploadRoutes());
    await act(async () => {
      fireEvent.click(recheck);
      await vi.advanceTimersByTimeAsync(5000 + 500);
    });
    expect(screen.getByText("Published · UFOLOAD has the video ready to play")).toBeTruthy();
  });

  it("shows the provider's failure reason on the row", async () => {
    stubFetch(
      uploadRoutes({
        "/api/videos/upload": () =>
          json({
            videoId: "video-1",
            jobId: "job-1",
            providerStatus: "failed",
            status: "failed",
            processing: false,
            providerError: "unsupported codec",
            metadata: { title: "My Trip", description: "A clip.", tags: ["mature"], source: "ai" },
            metadataSource: "ai",
            video: { slug: "my-trip-abc12345" },
          }),
      })
    );
    stubChunkXhr();

    render(<UploadPage />);
    addVideoFiles([videoFile("broken.mkv", 4)]);
    await chooseCategory();
    submitForm();

    expect(await screen.findByText("unsupported codec")).toBeTruthy();
    expect((await screen.findByText(/could not be published/)).textContent).toMatch(/1 item/);
  });

  it("surfaces file-name metadata as something the admin must review", async () => {
    stubFetch(
      uploadRoutes({
        "/api/videos/upload": () =>
          json({
            videoId: "video-1",
            jobId: "job-1",
            providerStatus: "ready",
            status: "ready",
            processing: false,
            metadata: { title: "my trip", description: "From the file name.", tags: ["mature"], source: "fallback" },
            metadataSource: "fallback",
            metadataWarning: "AI metadata unavailable. File-name metadata was used instead — review the title.",
            video: { slug: "my-trip-abc12345" },
          }),
      })
    );
    stubChunkXhr();

    render(<UploadPage />);
    addVideoFiles([videoFile("my trip.mp4", 4)]);
    await chooseCategory();
    submitForm();

    expect(
      await screen.findByText("Published · AI metadata unavailable — file-name metadata used, please review")
    ).toBeTruthy();
    expect(screen.getByText(/review the title/)).toBeTruthy();
    expect((await screen.findByText(/All videos were published/)).textContent).toMatch(/file-name metadata/);
  });

  it("cancels the transfer and frees the provider's slot", async () => {
    stubFetch(uploadRoutes());
    stubChunkXhr({ settle: false });

    render(<UploadPage />);
    addVideoFiles([videoFile("one.mp4", 4), videoFile("two.mp4", 4)]);
    await chooseCategory();
    submitForm();

    await waitFor(() => expect(chunks.length).toBe(2));
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.getByText("Publishing cancelled. Finished items were kept.")).toBeTruthy());
    // Every in-flight upload is cancelled provider-side…
    const cancels = requests.filter((request) => request.url.includes("/api/videos/ufoload-cancel"));
    expect(cancels.map((request) => request.body)).toEqual([{ uploadId: "upl_1" }, { uploadId: "upl_1" }]);
    // …and the rows go back to a state the admin can decide about.
    expect(screen.getAllByText("Cancelled — ready to publish")).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.aborted)).toBe(true);
  });
});

describe("URL imports", () => {
  it("reports an import as queued, never as published before the provider is ready", async () => {
    const seen: string[] = [];
    stubFetch((url, init) => {
      if (url.includes("/api/videos/upload-url")) {
        return json({
          results: [
            {
              remoteUrl: "https://cdn.example.com/a.mp4",
              videoId: "video-9",
              jobId: "job-9",
              importId: "imp_9",
              title: "Imported clip",
              status: "queued",
              providerStatus: "queued",
              processing: true,
            },
          ],
          queued: 1,
          succeeded: 1,
          failed: 0,
          note: "UFOLOAD downloads and encodes in the background.",
        });
      }
      if (url.includes("/api/videos/status")) {
        seen.push(url);
        return json({ providerState: "ready", note: "UFOLOAD confirmed this video is ready." });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));
    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn.example.com/a.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));
    await chooseCategory();
    submitForm();

    // The first poll only happens after the page's settle delay, and the row is
    // "queued" at the provider until that poll reports ready.
    expect(await screen.findByText(/Import started — UFOLOAD is downloading the link/)).toBeTruthy();
    expect(await screen.findByText("Published · UFOLOAD has the video ready to play", {}, { timeout: 8000 })).toBeTruthy();

    const start = findRequest("/api/videos/upload-url");
    expect(start?.body).toEqual({
      categoryId: "cat-1",
      entries: [{ url: "https://cdn.example.com/a.mp4", thumbnailPath: null }],
    });
    // The row polls the job the import created…
    expect(seen[0]).toContain("jobId=job-9");
  }, 15000);

  it("shows the provider reason when metadata fell back to file-name suggestions", async () => {
    const warning = "AI metadata unavailable (Gemini API key was rejected). File-name metadata was used instead.";
    stubFetch(() =>
      json({
        results: [
          {
            remoteUrl: "https://cdn.example/video.mp4",
            videoId: "video-3",
            jobId: "job-3",
            importId: "imp_3",
            title: "video",
            status: "queued",
            providerStatus: "queued",
            processing: true,
            metadataSource: "fallback",
            metadataWarning: warning,
          },
        ],
        queued: 1,
        succeeded: 1,
        failed: 0,
      })
    );

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));
    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn.example/video.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));
    await chooseCategory();
    submitForm();

    expect(await screen.findByText(warning)).toBeTruthy();
  });

  it("reports a refused import inline", async () => {
    stubFetch(() =>
      json({
        results: [{ remoteUrl: "https://cdn.example/video.mp4", status: "failed", error: "The source server refused the download." }],
        queued: 0,
        succeeded: 0,
        failed: 1,
      })
    );

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));
    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn.example/video.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));
    await chooseCategory();
    submitForm();

    expect(await screen.findByText("The source server refused the download.")).toBeTruthy();
  });
});

describe("iframe embeds", () => {
  it("publishes an iframe entry through the generic embed route", async () => {
    stubFetch((url) => {
      if (url.includes("/api/videos/embed")) {
        return json({
          results: [
            {
              source: "https://player.example.com/embed/abc",
              videoId: "video-7",
              title: "Embedded",
              status: "published",
              metadataSource: "ai",
            },
          ],
          succeeded: 1,
          failed: 0,
        });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), {
      target: { value: "https://player.example.com/embed/abc" },
    });
    fireEvent.click(screen.getByText("Add embed"));
    await chooseCategory();
    submitForm();

    expect(await screen.findByText("Published")).toBeTruthy();
    const embed = findRequest("/api/videos/embed");
    expect(embed?.body).toEqual({
      categoryId: "cat-1",
      entries: [{ source: "https://player.example.com/embed/abc", thumbnailPath: null }],
    });
    // An iframe source is live immediately: no provider polling for it.
    expect(requests.some((request) => request.url.includes("/api/videos/status"))).toBe(false);
  });
});
