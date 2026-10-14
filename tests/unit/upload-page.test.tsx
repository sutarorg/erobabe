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
beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(uploadWithProgress).mockResolvedValue();
  saveFails = false;
  encodingPending = false;
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
    if (url.endsWith("confirm")) {
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
    expect(screen.getByText(/no application-level video size limit/i)).toBeInTheDocument();
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
      expect.objectContaining({ title: "clip" }),
    );
    const postBodies = fetchMock.mock.calls
      .filter(([, o]) => o?.body)
      .map(([, o]) => o.body);
    expect(postBodies.every((b: unknown) => typeof b === "string")).toBe(true);
    expect(screen.getByText("View published video")).toHaveAttribute(
      "href",
      "/video/saved-video",
    );
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
    expect(screen.getByText(/Uploads continue while Bunny encodes/)).toBeInTheDocument();
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
});
