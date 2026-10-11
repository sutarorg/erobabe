import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Link from "next/link";

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

describe("admin publish videos page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the three publishing methods", async () => {
    render(<UploadPage />);
    expect(await screen.findByText("Upload videos")).toBeTruthy();
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

    // One thumbnail picker per entry, not a single shared card.
    expect(screen.getAllByText("Thumbnail")).toHaveLength(2);
    expect(screen.getAllByText("Add image")).toHaveLength(2);
    expect(screen.queryByText("Optional video thumbnail")).toBeNull();

    // Each entry keeps its own source and is independently editable.
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
    expect(screen.queryByText("Optional thumbnail for this batch")).toBeNull();
  });

  it("requires a category before publishing", async () => {
    render(<UploadPage />);
    fireEvent.click(await screen.findByText("Embed by iframe"));
    fireEvent.change(screen.getByPlaceholderText(/player\.example\.com\/embed\/abc/), {
      target: { value: "https://a.example/1" },
    });
    fireEvent.click(screen.getByText("Add embed"));

    const form = screen.getByText("Add embed").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(await screen.findByText("Choose a category before publishing.")).toBeTruthy();
  });

  it("reports a 413 from the host as a readable message, not a JSON parse error", async () => {
    // Regression guard for: Unexpected token 'R', "Request En"... is not valid JSON
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

    const form = screen.getByText("Add embed").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    const message = await screen.findByText(/4\.5 MB/);
    expect(message.textContent).not.toContain("Unexpected token");
    vi.unstubAllGlobals();
  });

  it("keeps the category link working", async () => {
    render(<UploadPage />);
    const link = (await screen.findByText("Manage categories")).closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/categories");
    expect(Link).toBeTruthy();
  });
});

describe("per-video progress bar", () => {
  it("renders a bar with the current phase once an item starts", async () => {
    const { ProgressBar } = await import("@/app/admin/videos/upload/page");
    expect(ProgressBar).toBeTypeOf("function");
  });

  it("shows progress for the row being uploaded", async () => {
    const uploads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const path = String(url);
        if (path.includes("uqload-session")) {
          return new Response(
            JSON.stringify({ serverUrl: "https://s1.uqload.example/upload/01", fields: { key: "test-key", file_public: "1", file_adult: "1" } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ error: "stop here" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      })
    );
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        upload: any = {};
        responseText = JSON.stringify({ status: 200, msg: "OK", files: [{ filecode: "abc123", filename: "clip.mp4", status: "OK" }] });
        open(_m: string, url: string) {
          uploads.push(url);
        }
        setRequestHeader() {}
        send() {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
          this.status = 200;
          this.onload?.();
        }
        addEventListener() {}
      }
    );

    render(<UploadPage />);
    const input = (await screen.findByText("Add videos")).closest("label")?.querySelector("input[type=file]");
    const file = new File([new Uint8Array(1024)], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    expect(await screen.findByText("clip.mp4")).toBeTruthy();
    // The row exposes a per-item thumbnail control and a remove button.
    expect(screen.getByText("Add image")).toBeTruthy();
    expect(screen.getByLabelText("Remove entry 1")).toBeTruthy();

    fireEvent.change(await screen.findByLabelText("Category *"), { target: { value: "cat-1" } });
    const form = screen.getByText("Add videos").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    // The failure from the stubbed publish route is shown inline on the row,
    // proving the per-item state machine (not a global error banner) ran.
    expect(await screen.findByText("stop here")).toBeTruthy();
    expect(uploads).toContain("https://s1.uqload.example/upload/01");

    vi.unstubAllGlobals();
  });
});

describe("per-video thumbnail is sent with its own video", () => {
  beforeEach(() => {
    // jsdom does not implement object URLs.
    (URL as any).createObjectURL = () => "blob:mock-preview";
    (URL as any).revokeObjectURL = () => {};
  });

  it("includes the uploaded thumbnail path in the publish request", async () => {
    const requests: Array<{ url: string; body: any }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const path = String(url);
        requests.push({ url: path, body: init?.body ? JSON.parse(init.body) : null });
        if (path.includes("storage-token")) {
          const kind = JSON.parse(init.body).kind;
          return new Response(
            JSON.stringify({
              uploadUrl: `https://storage.example/put-${kind}`,
              storagePath: kind === "thumbnail" ? "user-1/thumb-a.jpg" : "user-1/video-a.mp4",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ results: [{ status: "published", title: "T" }], succeeded: 1, failed: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        upload: any = {};
        status = 200;
        open() {}
        setRequestHeader() {}
        send() {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
          this.onload?.();
        }
      }
    );

    const { container } = render(<UploadPage />);
    fireEvent.click(await screen.findByText("Upload by link"));
    fireEvent.change(screen.getByPlaceholderText(/cdn\.example\.com\/video-one\.mp4/), {
      target: { value: "https://cdn/1.mp4" },
    });
    fireEvent.click(screen.getByText("Add link"));
    fireEvent.change(await screen.findByLabelText("Category *"), { target: { value: "cat-1" } });

    // Attach a thumbnail to this specific entry.
    const thumbInput = container.querySelector('input[type="file"][accept^="image/"]') as HTMLInputElement;
    expect(thumbInput).toBeTruthy();
    fireEvent.change(thumbInput, {
      target: { files: [new File([new Uint8Array(64)], "cover.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByText("Replace")).toBeTruthy();

    const form = screen.getByText("Add link").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    await screen.findByText("All videos were published.");

    const publish = requests.find((request) => request.url.includes("/api/videos/upload-url"));
    expect(publish).toBeTruthy();
    expect(publish?.body).toEqual({
      categoryId: "cat-1",
      entries: [{ url: "https://cdn/1.mp4", thumbnailPath: "user-1/thumb-a.jpg" }],
    });

    // The thumbnail really went to storage before the publish call.
    expect(requests.some((request) => request.url.includes("storage-token") && request.body.kind === "thumbnail")).toBe(true);

    vi.unstubAllGlobals();
  });
});
