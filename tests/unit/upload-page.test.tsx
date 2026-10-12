import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Link from "next/link";
import { createFakeNode, type FakeNodeOptions } from "./helpers/fake-node";
import { uploadTiming } from "@/src/utils/uploadTiming";
import { MAX_VIDEO_SIZE } from "@/lib/video/limits";

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

/**
 * The admin publishing page. The network is stubbed: our API routes with a
 * request recorder, UFOLOAD's upload node with the scripted mock from
 * helpers/fake-node.ts (which follows the documented chunk protocol). These
 * tests prove the page drives that contract correctly — they are not evidence
 * of a real upload; that needs the live smoke test in DEPLOYMENT.md.
 */

const timingDefaults = JSON.parse(JSON.stringify(uploadTiming));

beforeEach(() => {
  vi.clearAllMocks();
  // Short delays so retry / polling paths run in milliseconds.
  Object.assign(uploadTiming, {
    initialDelayMs: 5,
    intervalMs: 5,
    maxIntervalMs: 20,
    registerRetryDelaysMs: [5, 5],
    importSlotRetryMs: 5,
    chunkMaxAttempts: 2,
    chunkRetryDelaysMs: [1],
    stallTimeoutMs: 120_000,
  });
  // jsdom does not implement object URLs.
  (URL as any).createObjectURL = () => "blob:mock-preview";
  (URL as any).revokeObjectURL = () => {};
});

afterEach(() => {
  Object.assign(uploadTiming, timingDefaults);
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A stubbed world for the page
// ---------------------------------------------------------------------------

interface Req {
  method: string;
  url: string;
  path: string;
  search: string;
  body: any;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function createEnv(nodeOptions: FakeNodeOptions = {}) {
  const requests: Req[] = [];
  const node = createFakeNode({ nodeHost: "upload.ufoload.com", ...nodeOptions });
  const routes: Array<{ match: (req: Req) => boolean; respond: (req: Req) => Response | Promise<Response> }> = [];
  let sessions = 0;
  const sessionOverrides: Array<Record<string, unknown>> = [];

  const newSession = () => {
    sessions += 1;
    return {
      jobId: `job-${sessions}`,
      uploadId: `upl_${sessions}`,
      uploadUrl: `https://upload.ufoload.com/07/_node/v1/ingest/upl_${sessions}`,
      authorization: node.node.authorization,
      chunkSize: 4096,
      maxBytes: 5 * 1024 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      ...(sessionOverrides.shift() || {}),
    };
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const parsed = new URL(url, "http://localhost");
    const method = (init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : null;
    const req: Req = { method, url, path: parsed.pathname, search: parsed.search, body };
    requests.push(req);

    // A GET to the node's own URL (asking where to resume).
    if (parsed.host === "upload.ufoload.com") return node.fetch(input, init);

    for (const route of routes) if (route.match(req)) return route.respond(req);

    if (req.path === "/api/gemini/suggest") {
      return json({ suggestion: { title: "Velvet Evening", description: "A calm portrait in soft light.", tags: ["mature", "portrait"] } });
    }
    if (req.path === "/api/videos/reconcile") return json({ ok: true, checked: 0 });
    if (req.path === "/api/videos/storage-token") {
      return json({ uploadUrl: "https://project.supabase.co/storage/v1/object/upload/sign/video-thumbnails/user-1/thumb.jpg?token=t", storagePath: "user-1/thumb.jpg" });
    }
    if (req.path === "/api/videos/ufoload-session") {
      if (method === "POST") return json(newSession());
      if (method === "GET") return json({ state: "pending", jobStatus: "uploading" });
      if (method === "DELETE") return json({ cancelled: true, jobStatus: "cancelled" });
    }
    return json({ error: `unhandled ${method} ${req.path}` }, 500);
  });

  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", node.Xhr);

  return {
    requests,
    node,
    fetchMock,
    /** Later registrations win. */
    on(match: (req: Req) => boolean, respond: (req: Req) => Response | Promise<Response>) {
      routes.unshift({ match, respond });
    },
    onPath(method: string, path: string, respond: (req: Req) => Response | Promise<Response>) {
      routes.unshift({ match: (req) => req.method === method && req.path === path, respond });
    },
    /** Alter the next session the server hands out. */
    nextSession(overrides: Record<string, unknown>) {
      sessionOverrides.push(overrides);
    },
    all: (method: string, path: string) => requests.filter((req) => req.method === method && req.path === path),
  };
}

type Env = ReturnType<typeof createEnv>;

function statusView(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    videoId: "vid-1",
    slug: "velvet-evening-1",
    title: "Velvet Evening",
    phase: "processing",
    jobStatus: "processing",
    providerStatus: "processing",
    progress: 0,
    published: false,
    embedUrl: null,
    error: null,
    warning: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function registeredResponse(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    videoId: "vid-1",
    status: "processing",
    progress: 0,
    providerStatus: "queued",
    published: false,
    processing: true,
    video: { id: "vid-1", slug: "velvet-evening-1", title: "Velvet Evening", status: "processing" },
    metadata: { title: "Velvet Evening", description: "A calm portrait.", tags: ["mature"], source: "ai" },
    metadataSource: "ai",
    ...overrides,
  };
}

const videoFile = (name = "my trip.mp4", bytes = 10 * 1024) => new File([new Uint8Array(bytes)], name, { type: "video/mp4" });

function fileInput() {
  return document.querySelector('label input[type="file"][accept="video/*"]') as HTMLInputElement;
}

async function addVideoFile(file = videoFile()) {
  await screen.findByText("Add videos");
  fireEvent.change(fileInput(), { target: { files: [file] } });
  expect(await screen.findByText(file.name)).toBeTruthy();
}

async function chooseCategoryAndSubmit(anchor = "Add videos") {
  fireEvent.change(await screen.findByLabelText("Category *"), { target: { value: "cat-1" } });
  fireEvent.submit(screen.getByText(anchor).closest("form") as HTMLFormElement);
}

async function addLink(url = "https://cdn.example.com/trip.mp4") {
  fireEvent.click(await screen.findByText("Upload by link"));
  fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), { target: { value: url } });
  fireEvent.click(screen.getByText("Add link"));
}

// ---------------------------------------------------------------------------
// Unchanged behaviour: modes, thumbnails per entry, category, readable errors
// ---------------------------------------------------------------------------

describe("admin publish videos page", () => {
  it("offers the three publishing methods", async () => {
    createEnv();
    render(<UploadPage />);
    expect(await screen.findByText("Upload videos")).toBeTruthy();
    expect(screen.getByText("Embed by iframe")).toBeTruthy();
    expect(screen.getByText("Upload by link")).toBeTruthy();
  });

  it("describes the UFOLOAD path, not the retired provider", async () => {
    createEnv();
    const { container } = render(<UploadPage />);
    await screen.findByText("Upload videos");
    const text = container.textContent || "";
    expect(text).toMatch(/UFOLOAD/);
    expect(text).not.toMatch(/uqload/i);
    expect(text).not.toMatch(/re-check library/i);
  });

  it("gives every pasted iframe its own thumbnail control", async () => {
    createEnv();
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

    // One thumbnail picker per entry, not a single shared card.
    expect(screen.getAllByText("Thumbnail")).toHaveLength(2);
    expect(screen.getAllByText("Add image")).toHaveLength(2);
    expect(screen.queryByText("Optional video thumbnail")).toBeNull();

    // Each entry keeps its own source and is independently editable.
    expect((entries[0] as HTMLInputElement).value).toContain("a.example/1");
    fireEvent.change(entries[1], { target: { value: "https://a.example/edited" } });
    expect((screen.getAllByLabelText(/^Iframe URL or embed code$/)[1] as HTMLInputElement).value).toBe("https://a.example/edited");
  });

  it("gives every pasted link its own thumbnail control", async () => {
    createEnv();
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));

    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn/1.mp4\nhttps://cdn/2.mp4\nhttps://cdn/3.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));

    expect(screen.getAllByLabelText(/^Direct video URL$/)).toHaveLength(3);
    expect(screen.getAllByText("Add image")).toHaveLength(3);
    expect(screen.queryByText("Optional thumbnail for this batch")).toBeNull();
  });

  it("requires a category before publishing", async () => {
    const env = createEnv();
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), { target: { value: "https://a.example/1" } });
    fireEvent.click(screen.getByText("Add embed"));

    fireEvent.submit(screen.getByText("Add embed").closest("form") as HTMLFormElement);

    expect(await screen.findByText("Choose a category before publishing.")).toBeTruthy();
    expect(env.requests.some((req) => req.path === "/api/videos/embed")).toBe(false);
  });

  it("reports a 413 from the host as a readable message, not a JSON parse error", async () => {
    // Regression guard for: Unexpected token 'R', "Request En"... is not valid JSON
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Request Entity Too Large", { status: 413, headers: { "content-type": "text/plain" } }))
    );

    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), { target: { value: "https://a.example/1" } });
    fireEvent.click(screen.getByText("Add embed"));
    fireEvent.change(await screen.findByLabelText("Category *"), { target: { value: "cat-1" } });
    fireEvent.submit(screen.getByText("Add embed").closest("form") as HTMLFormElement);

    const message = await screen.findByText(/4\.5 MB/);
    expect(message.textContent).not.toContain("Unexpected token");
  });

  it("shows the provider reason when metadata fell back to file-name suggestions", async () => {
    const warning = "AI metadata unavailable (Gemini API key was rejected). File-name metadata was used instead.";
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () =>
      json(
        {
          results: [
            {
              remoteUrl: "https://cdn.example/video.mp4",
              status: "processing",
              jobId: "job-1",
              videoId: "vid-1",
              importTaskId: "imp_1",
              providerStatus: "import:queued",
              progress: 0,
              title: "Clip",
              metadataSource: "fallback",
              metadataWarning: warning,
            },
          ],
          succeeded: 1,
          failed: 0,
        },
        202
      )
    );
    render(<UploadPage />);
    await addLink("https://cdn.example/video.mp4");
    await chooseCategoryAndSubmit("Add link");

    expect(await screen.findByText(warning)).toBeTruthy();
  });

  it("keeps the category link working", async () => {
    createEnv();
    render(<UploadPage />);
    const link = (await screen.findByText("Manage categories")).closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/categories");
    expect(Link).toBeTruthy();
  });
});

describe("per-video progress bar", () => {
  it("is exported and renders a determinate bar", async () => {
    const { ProgressBar } = await import("@/app/admin/videos/upload/page");
    expect(ProgressBar).toBeTypeOf("function");
    render(<ProgressBar percent={42} phase="uploading" waiting={false} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("pulses (no number) while there is nothing to count", async () => {
    const { ProgressBar } = await import("@/app/admin/videos/upload/page");
    render(<ProgressBar percent={0} phase="processing" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Local upload: chunked, direct to UFOLOAD
// ---------------------------------------------------------------------------

describe("local upload goes straight to UFOLOAD in chunks", () => {
  function wireHappyPath(env: Env, onRegister?: () => void) {
    env.onPath("POST", "/api/videos/upload", () => {
      onRegister?.();
      return json(registeredResponse());
    });
  }

  it("asks the server for a session, sends every chunk to the exact URL it returned, then registers — and follows processing to published", async () => {
    const env = createEnv();
    let acceptedWhenRegistered = -1;
    wireHappyPath(env, () => {
      acceptedWhenRegistered = env.node.node.accepted;
    });
    let published = false;
    env.onPath("GET", "/api/videos/status", () =>
      json({
        jobs: [
          published
            ? statusView({ phase: "published", jobStatus: "completed", providerStatus: "ready", progress: 100, published: true, embedUrl: "https://ufoload.com/e/abcDEF12345" })
            : statusView({ progress: 30 }),
        ],
      })
    );

    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    // The row follows UFOLOAD's own numbers, then flips to Published.
    expect(await screen.findByText(/Uploaded · UFOLOAD is encoding — 30%/)).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
    published = true;
    expect(await screen.findByText("Published")).toBeTruthy();
    expect(screen.getByText("View").closest("a")?.getAttribute("href")).toBe("/video/velvet-evening-1");

    // 1. A session was requested from OUR server — with the category and exact size.
    const sessions = env.all("POST", "/api/videos/ufoload-session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].body).toEqual({ fileName: "my trip.mp4", fileSize: 10 * 1024, mimeType: "video/mp4", categoryId: "cat-1" });

    // 2. Every chunk went to the exact URL UFOLOAD returned, at the node's offset, respecting chunk_size.
    const puts = env.node.puts();
    expect(puts.map((put) => [put.offsetParam, put.size])).toEqual([
      [0, 4096],
      [4096, 4096],
      [8192, 2048],
    ]);
    for (const put of puts) expect(put.url).toBe(`https://upload.ufoload.com/07/_node/v1/ingest/upl_1?offset=${put.offsetParam}`);

    // 3. Registration happened only after the node held every byte, and carries the job — not a provider file id.
    expect(acceptedWhenRegistered).toBe(10 * 1024);
    const register = env.all("POST", "/api/videos/upload");
    expect(register).toHaveLength(1);
    expect(register[0].body).toMatchObject({ jobId: "job-1", categoryId: "cat-1", fileName: "my trip.mp4", fileSize: 10 * 1024 });
    expect(register[0].body.thumbnailPath).toBeNull();
    expect(Object.keys(register[0].body)).not.toContain("providerFileId");
    expect(register[0].body.metadata).toMatchObject({ title: "Velvet Evening", source: "ai" });

    // 4. Processing was polled by job id.
    expect(env.requests.some((req) => req.path === "/api/videos/status" && req.search.includes("jobIds=job-1"))).toBe(true);
  });

  it("sets no forbidden browser headers and uses no credentials on the node request", async () => {
    const env = createEnv();
    wireHappyPath(env);
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Uploaded · /);

    const nodeXhrs = env.node.node.xhrInstances.filter((xhr: any) => xhr.url.includes("upload.ufoload.com"));
    expect(nodeXhrs).toHaveLength(3);
    for (const xhr of nodeXhrs) {
      expect(xhr.headersSet.map(([name]: [string, string]) => name.toLowerCase()).sort()).toEqual(["authorization", "content-type"]);
      expect(xhr.headers.authorization).toBe("UfoGrant test-grant");
      expect(xhr.withCredentials).toBe(false);
    }
  });

  it("never shows 100% until the node has accepted the last byte", async () => {
    const env = createEnv();
    // Chunks 1 and 2 are accepted; the last chunk's bytes are all sent but the node never answers.
    env.node.script({ type: "ok" }, { type: "ok" }, { type: "hang" });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    // 8192 bytes accepted + the whole 2048-byte last chunk in flight = 10240/10240 — shown as 99%, not 100%.
    expect(await screen.findByText(/Uploading to UFOLOAD — 99%/)).toBeTruthy();
    expect(screen.getAllByRole("progressbar")[0].getAttribute("aria-valuenow")).toBe("99");
    expect(screen.queryByText(/100%/)).toBeNull();
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(0);

    fireEvent.click(screen.getByText("Cancel"));
    await screen.findByText(/Publishing cancelled/);
  });

  it("shows live bytes-based progress text while a chunk is in flight", async () => {
    const env = createEnv();
    env.node.script({ type: "hang" });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    // progressSteps 2 → half of the first 4096-byte chunk is 2048 of 10240 bytes = 20%, the whole chunk 40%.
    expect(await screen.findByText(/Uploading to UFOLOAD — 40%/)).toBeTruthy();
    expect(screen.getAllByRole("progressbar")[0].getAttribute("aria-label")).toBe("40% complete");
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(0);

    fireEvent.click(screen.getByText("Cancel"));
    await screen.findByText(/Publishing cancelled/);
  });

  it("cancel aborts the transfer, releases the UFOLOAD session and registers nothing", async () => {
    const env = createEnv();
    env.node.script({ type: "hang" });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Uploading to UFOLOAD — \d+%/);

    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByText(/Publishing cancelled/)).toBeTruthy();
    expect(await screen.findByText("Cancelled — ready to publish")).toBeTruthy();

    await waitFor(() => expect(env.all("DELETE", "/api/videos/ufoload-session")).toHaveLength(1));
    expect(env.all("DELETE", "/api/videos/ufoload-session")[0].search).toBe("?jobId=job-1");
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(0);
    expect(env.node.node.xhrInstances[0].aborted).toBe(true);
  });

  it("keeps the upload session alive through our server, never with an API key", async () => {
    const env = createEnv();
    wireHappyPath(env);
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Uploaded · /);

    // The browser never called UFOLOAD's main API; it only ever talks to the node and to our routes.
    for (const req of env.requests) {
      expect(req.url).not.toMatch(/ufoload\.com\/api\//);
      expect(req.url).not.toMatch(/api\.ufoload\.com/);
    }
    expect(JSON.stringify(env.requests)).not.toMatch(/ufo_[A-Za-z0-9]{6,}|Bearer/);
  });

  it("does not register, and says so, when the grant is refused mid-upload — and Retry then starts a clean session", async () => {
    const env = createEnv();
    wireHappyPath(env);
    env.node.script({ type: "ok" }, { type: "status", status: 401 });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/The upload permission from UFOLOAD expired/)).toBeTruthy();
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(0);
    await waitFor(() => expect(env.all("DELETE", "/api/videos/ufoload-session")).toHaveLength(1));

    // The node starts over for the new session.
    env.node.node.accepted = 0;
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText(/Uploaded · /)).toBeTruthy();
    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(2);
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(1);
    expect(env.all("POST", "/api/videos/upload")[0].body.jobId).toBe("job-2");
  });

  it("Retry resumes a half-sent upload from the node's offset: no new session, no chunk sent twice", async () => {
    const env = createEnv();
    wireHappyPath(env);
    env.node.script({ type: "ok" }, { type: "status", status: 503 }, { type: "status", status: 503 });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/busy or unavailable \(HTTP 503\)/)).toBeTruthy();
    expect(screen.getByText(/Press Retry to resume from where it stopped/)).toBeTruthy();
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(0);
    expect(env.node.node.accepted).toBe(4096);
    // A resumable failure keeps the UFOLOAD session — it must not be cancelled.
    expect(env.all("DELETE", "/api/videos/ufoload-session")).toHaveLength(0);

    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText(/Uploaded · /)).toBeTruthy();

    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(1);
    expect(env.node.node.applied.map((chunk) => chunk.offset)).toEqual([0, 4096, 8192]);
    expect(env.node.node.accepted).toBe(10 * 1024);
    expect(env.all("POST", "/api/videos/upload")).toHaveLength(1);
    expect(env.all("POST", "/api/videos/upload")[0].body.jobId).toBe("job-1");
    // The retry began by asking the node where it stood.
    expect(env.node.gets().length).toBeGreaterThan(0);
  });

  it("does not reuse a kept session whose grant is about to expire", async () => {
    const env = createEnv();
    wireHappyPath(env);
    env.nextSession({ expiresAt: new Date(Date.now() + 20_000).toISOString() });
    env.node.script({ type: "status", status: 503 }, { type: "status", status: 503 });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Press Retry to resume/);

    env.node.node.accepted = 0;
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByText(/Uploaded · /);
    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(2);
    await waitFor(() => expect(env.all("DELETE", "/api/videos/ufoload-session")).toHaveLength(1));
  });

  it("retries completing the upload when UFOLOAD is briefly busy — without re-sending a byte", async () => {
    const env = createEnv();
    let attempts = 0;
    env.onPath("POST", "/api/videos/upload", () => {
      attempts += 1;
      if (attempts === 1) return json({ error: "UFOLOAD is still finalizing the previous request for this upload (409 upload_busy).", code: "upload_busy", retryable: true }, 409);
      return json(registeredResponse());
    });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/Uploaded · /)).toBeTruthy();
    expect(attempts).toBe(2);
    expect(env.node.puts()).toHaveLength(3);
    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(1);
  });

  it("shows a refusal that cannot pass (a duplicate file) once, and clears the spent session", async () => {
    const env = createEnv();
    let attempts = 0;
    env.onPath("POST", "/api/videos/upload", () => {
      attempts += 1;
      return json({ error: "This exact file was already uploaded as “Already There”.", code: "duplicate_upload" }, 409);
    });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/already uploaded as “Already There”/)).toBeTruthy();
    expect(attempts).toBe(1);
    // Retry starts a fresh session: the old one was consumed.
    env.node.node.accepted = 0;
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByText(/already uploaded as/);
    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(2);
  });

  it("explains 503 direct_upload_unavailable and never falls back to sending the file through us", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/ufoload-session", () =>
      json(
        {
          error: "UFOLOAD direct upload is temporarily unavailable (503 direct_upload_unavailable). The app does not fall back to sending the file through its own servers.",
          code: "direct_upload_unavailable",
          retryable: true,
        },
        503
      )
    );
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/direct upload is temporarily unavailable/)).toBeTruthy();
    expect(env.node.node.requests).toHaveLength(0);
    expect(env.requests.every((req) => req.path !== "/api/videos/upload")).toBe(true);
    // The file bytes were never posted to one of our own routes.
    expect(env.requests.every((req) => req.body === null || JSON.stringify(req.body).length < 5000)).toBe(true);
  });

  it("shows the server's blocker when UFOLOAD is not approved", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/ufoload-session", () =>
      json({ error: "UFOLOAD uploads are not enabled on this server.", code: "adult_content_not_approved", details: "Written approval from UFOLOAD is required.", retryable: false }, 503)
    );
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    expect(await screen.findByText("UFOLOAD uploads are not enabled on this server.")).toBeTruthy();
    expect(env.node.node.requests).toHaveLength(0);
  });

  it("keeps the 2 GB limit in the browser too, and refuses empty files", async () => {
    createEnv();
    render(<UploadPage />);
    await screen.findByText("Add videos");

    const tooBig = new File([], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(tooBig, "size", { value: MAX_VIDEO_SIZE + 1 });
    const exactly = new File([], "limit.mp4", { type: "video/mp4" });
    Object.defineProperty(exactly, "size", { value: MAX_VIDEO_SIZE });
    const empty = new File([], "empty.mp4", { type: "video/mp4" });

    fireEvent.change(fileInput(), { target: { files: [tooBig, exactly, empty] } });
    expect(await screen.findByText("limit.mp4")).toBeTruthy();
    expect(screen.queryByText("huge.mp4")).toBeNull();
    expect(screen.queryByText("empty.mp4")).toBeNull();
    const message = await screen.findByText(/larger than the 2 GB limit/);
    expect(message.textContent).toMatch(/“huge\.mp4” is larger than the 2 GB limit/);
    expect(message.textContent).toMatch(/“empty\.mp4” is empty/);
    expect(MAX_VIDEO_SIZE).toBe(2 * 1024 * 1024 * 1024);
  });

  it("ignores files that are not videos", async () => {
    createEnv();
    render(<UploadPage />);
    await screen.findByText("Add videos");
    fireEvent.change(fileInput(), { target: { files: [new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("No video files were selected.")).toBeTruthy();
  });

  it("uploads the thumbnail through the existing Supabase signed upload, before registering", async () => {
    const env = createEnv();
    const order: string[] = [];
    env.onPath("POST", "/api/videos/upload", () => {
      order.push(`register:${env.node.node.passthrough.length}`);
      return json(registeredResponse());
    });
    render(<UploadPage />);
    await addVideoFile();
    const thumbInput = document.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement;
    fireEvent.change(thumbInput, { target: { files: [new File([new Uint8Array(64)], "cover.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText("Replace")).toBeTruthy();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Uploaded · /);

    const tokenRequest = env.all("POST", "/api/videos/storage-token");
    expect(tokenRequest).toHaveLength(1);
    expect(tokenRequest[0].body).toMatchObject({ kind: "thumbnail", fileName: "cover.jpg", mimeType: "image/jpeg" });
    expect(env.node.node.passthrough.map((put) => put.url)).toEqual([
      "https://project.supabase.co/storage/v1/object/upload/sign/video-thumbnails/user-1/thumb.jpg?token=t",
    ]);
    expect(env.all("POST", "/api/videos/upload")[0].body.thumbnailPath).toBe("user-1/thumb.jpg");
    expect(order).toEqual(["register:1"]);
    // The thumbnail bytes did not go to UFOLOAD.
    expect(env.node.puts().every((put) => put.url.startsWith("https://upload.ufoload.com/"))).toBe(true);
  });

  it("shows UFOLOAD's reason when processing fails, and lets the admin retry", async () => {
    const env = createEnv();
    wireHappyPath(env);
    env.onPath("GET", "/api/videos/status", () =>
      json({ jobs: [statusView({ phase: "failed", jobStatus: "failed", progress: 12, error: "UFOLOAD could not process the video: unsupported audio codec. Upload it again, or try a different file or format." })] })
    );
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();

    expect(await screen.findByText(/unsupported audio codec/)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("surfaces a transient status-check problem without marking the video failed", async () => {
    const env = createEnv();
    wireHappyPath(env);
    env.onPath("GET", "/api/videos/status", () =>
      json({ jobs: [statusView({ progress: 55, warning: "UFOLOAD is rate limiting requests (429); retry in 3 seconds." })] })
    );
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    expect(await screen.findByText(/rate limiting requests/)).toBeTruthy();
    expect(screen.getByText(/Uploaded · UFOLOAD is encoding — 55%/)).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("stops polling and says why when the admin session has ended", async () => {
    const env = createEnv();
    wireHappyPath(env);
    let polls = 0;
    env.onPath("GET", "/api/videos/status", () => {
      polls += 1;
      return json({ error: "Unauthorized" }, 401);
    });
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    expect(await screen.findByText(/admin session ended/)).toBeTruthy();
    const seen = polls;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(polls).toBe(seen);
  });

  it("makes no request to Uqload anywhere in the local-upload flow", async () => {
    const env = createEnv();
    wireHappyPath(env);
    render(<UploadPage />);
    await addVideoFile();
    await chooseCategoryAndSubmit();
    await screen.findByText(/Uploaded · /);
    const urls = [...env.requests.map((req) => req.url), ...env.node.node.requests.map((req) => req.url), ...env.node.node.passthrough.map((req) => req.url)];
    expect(urls.length).toBeGreaterThan(5);
    expect(urls.filter((url) => /uqload/i.test(url))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Link upload: UFOLOAD imports the URL itself, asynchronously
// ---------------------------------------------------------------------------

describe("link upload is an asynchronous UFOLOAD import", () => {
  const accepted = (overrides: Record<string, unknown> = {}) =>
    json(
      {
        results: [
          {
            remoteUrl: "https://cdn.example.com/trip.mp4",
            videoId: "vid-1",
            jobId: "job-1",
            importTaskId: "imp_1",
            title: "Velvet Evening",
            slug: "velvet-evening-1",
            status: "processing",
            providerStatus: "import:queued",
            progress: 0,
            metadataSource: "ai",
            ...overrides,
          },
        ],
        succeeded: 1,
        failed: 0,
      },
      202
    );

  it("starts the import, returns immediately, then follows download → encoding → published by polling", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () => accepted());
    const script = [
      statusView({ phase: "uploading", jobStatus: "uploading", providerStatus: "import:running", progress: 40 }),
      statusView({ phase: "processing", providerStatus: "import:done", progress: 0 }),
      statusView({ phase: "processing", providerStatus: "processing", progress: 20 }),
      statusView({ phase: "published", jobStatus: "completed", providerStatus: "ready", progress: 100, published: true, embedUrl: "https://ufoload.com/e/abcDEF12345" }),
    ];
    // UFOLOAD's answer only moves on when the test says so, so no stage can be skipped by timing.
    let stage = -1;
    env.onPath("GET", "/api/videos/status", () =>
      json({ jobs: [stage < 0 ? statusView({ phase: "uploading", jobStatus: "uploading", providerStatus: "import:queued", progress: 0 }) : script[stage]] })
    );

    render(<UploadPage />);
    await addLink();
    await chooseCategoryAndSubmit("Add link");

    expect(await screen.findByText(/Import accepted — waiting for UFOLOAD to start downloading the link/)).toBeTruthy();
    stage = 0;
    expect(await screen.findByText(/UFOLOAD is downloading the link — 40%/)).toBeTruthy();
    stage = 1;
    expect(await screen.findByText(/Downloaded · waiting for UFOLOAD to start encoding/)).toBeTruthy();
    stage = 2;
    expect(await screen.findByText(/Uploaded · UFOLOAD is encoding — 20%/)).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
    stage = 3;
    expect(await screen.findByText("Published")).toBeTruthy();
    expect(screen.getByText("View").closest("a")?.getAttribute("href")).toBe("/video/velvet-evening-1");

    const imports = env.all("POST", "/api/videos/upload-url");
    expect(imports).toHaveLength(1);
    expect(imports[0].body).toEqual({ categoryId: "cat-1", entries: [{ url: "https://cdn.example.com/trip.mp4", thumbnailPath: null }] });
    expect(env.requests.some((req) => req.path === "/api/videos/status" && req.search.includes("jobIds=job-1"))).toBe(true);
    // The import is a server-side download: nothing was uploaded from the browser.
    expect(env.node.node.requests).toHaveLength(0);
    expect(env.all("POST", "/api/videos/ufoload-session")).toHaveLength(0);
  });

  it("does not claim the video is published when the import has only been accepted", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () => accepted());
    env.onPath("GET", "/api/videos/status", () => json({ jobs: [statusView({ phase: "uploading", jobStatus: "uploading", providerStatus: "import:queued", progress: 0 })] }));
    render(<UploadPage />);
    await addLink();
    await chooseCategoryAndSubmit("Add link");
    expect(await screen.findByText(/All uploads were sent to UFOLOAD\. 1 video is still processing there/)).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
    expect(screen.queryByText("All videos were published.")).toBeNull();
    expect(screen.getByText("0 of 1 published")).toBeTruthy();
  });

  it("waits for a free UFOLOAD import slot (it runs 10 at a time) and then starts the link", async () => {
    const env = createEnv();
    let calls = 0;
    env.onPath("POST", "/api/videos/upload-url", () => {
      calls += 1;
      if (calls === 1) {
        return json(
          {
            error: "UFOLOAD runs at most 10 URL imports at a time and they are all busy.",
            code: "import_slots_full",
            retryable: true,
            retryAfterSeconds: 30,
            results: [{ status: "failed", code: "import_slots_full", retryable: true, retryAfterSeconds: 30 }],
            succeeded: 0,
            failed: 1,
          },
          429,
          { "Retry-After": "30" }
        );
      }
      return accepted();
    });
    env.onPath("GET", "/api/videos/status", () => json({ jobs: [statusView({ phase: "uploading", jobStatus: "uploading", providerStatus: "import:queued", progress: 0 })] }));

    uploadTiming.importSlotRetryMs = 200;
    render(<UploadPage />);
    await addLink();
    await chooseCategoryAndSubmit("Add link");

    expect(await screen.findByText(/Waiting for a free UFOLOAD import slot \(it runs 10 at a time\)/)).toBeTruthy();
    expect(await screen.findByText(/All uploads were sent to UFOLOAD/)).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("gives up with a clear message when a link is refused for a reason that will not pass", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () =>
      json(
        {
          error: "UFOLOAD rejected the link (400). It must be a direct, public http(s) link to a file.",
          code: "bad_request",
          retryable: false,
          results: [{ status: "failed", error: "UFOLOAD rejected the link (400). It must be a direct, public http(s) link to a file.", code: "bad_request", retryable: false }],
          succeeded: 0,
          failed: 1,
        },
        422
      )
    );
    render(<UploadPage />);
    await addLink("https://cdn.example.com/page.html");
    await chooseCategoryAndSubmit("Add link");
    expect(await screen.findByText(/direct, public http\(s\) link/)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(env.all("POST", "/api/videos/upload-url")).toHaveLength(1);
  });

  it("sends the entry's own thumbnail path with its link", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () => accepted());
    env.onPath("POST", "/api/videos/storage-token", () => json({ uploadUrl: "https://storage.example/put-thumbnail", storagePath: "user-1/thumb-a.jpg" }));
    const { container } = render(<UploadPage />);
    await addLink("https://cdn/1.mp4");
    const thumbInput = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement;
    fireEvent.change(thumbInput, { target: { files: [new File([new Uint8Array(64)], "cover.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText("Replace")).toBeTruthy();
    await chooseCategoryAndSubmit("Add link");
    await screen.findByText(/All uploads were sent to UFOLOAD/);

    expect(env.all("POST", "/api/videos/upload-url")[0].body).toEqual({
      categoryId: "cat-1",
      entries: [{ url: "https://cdn/1.mp4", thumbnailPath: "user-1/thumb-a.jpg" }],
    });
    expect(env.all("POST", "/api/videos/storage-token").some((req) => req.body.kind === "thumbnail")).toBe(true);
  });

  it("makes no request to Uqload anywhere in the link flow", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/upload-url", () => accepted());
    env.onPath("GET", "/api/videos/status", () => json({ jobs: [statusView({ phase: "published", jobStatus: "completed", published: true, progress: 100 })] }));
    render(<UploadPage />);
    await addLink();
    await chooseCategoryAndSubmit("Add link");
    await screen.findByText("Published");
    expect(env.requests.filter((req) => /uqload/i.test(req.url))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Embed mode and the on-open reconcile
// ---------------------------------------------------------------------------

describe("iframe embeds are unchanged and never touch UFOLOAD", () => {
  it("publishes an iframe immediately through the generic embed route", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/embed", () =>
      json({ results: [{ status: "published", title: "Embedded", slug: "embedded-1", metadataSource: "ai" }], succeeded: 1, failed: 0 })
    );
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), { target: { value: '<iframe src="https://player.example.com/embed/abc"></iframe>' } });
    fireEvent.click(screen.getByText("Add embed"));
    await chooseCategoryAndSubmit("Add embed");

    expect(await screen.findByText("All videos were published.")).toBeTruthy();
    expect(env.all("POST", "/api/videos/embed")[0].body).toEqual({
      categoryId: "cat-1",
      // (the pasted markup is split per <iframe> exactly as before)
      entries: [{ source: '<iframe src="https://player.example.com/embed/abc">', thumbnailPath: null }],
    });
    const touched = env.requests.filter((req) => /ufoload|upload-url|status/.test(req.path) && req.path !== "/api/videos/reconcile");
    expect(touched).toEqual([]);
    expect(env.node.node.requests).toHaveLength(0);
  });
});

describe("opening the page", () => {
  it("asks the server once to finish anything left unfinished, without blocking the page", async () => {
    const env = createEnv();
    render(<UploadPage />);
    await screen.findByText("Upload videos");
    await waitFor(() => expect(env.all("POST", "/api/videos/reconcile")).toHaveLength(1));
    expect(env.all("POST", "/api/videos/reconcile")[0].body).toEqual({ limit: 10, budgetMs: 15000 });
  });

  it("still works when that reconcile request fails", async () => {
    const env = createEnv();
    env.onPath("POST", "/api/videos/reconcile", () => json({ error: "boom" }, 500));
    render(<UploadPage />);
    expect(await screen.findByText("Upload videos")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
  });
});
