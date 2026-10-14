import { afterEach, describe, it, expect, vi } from "vitest";
import { uploadWithProgress } from "@/src/utils/uploadFile";
afterEach(() => vi.unstubAllGlobals());
describe("direct byte transport", () => {
  it("PUTs the original File to the provider host with real byte progress and no bearer key", async () => {
    const xhr = {
      upload: {} as { onprogress: (e: unknown) => void },
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      addEventListener: vi.fn(),
      status: 200,
      onload: () => {},
    };
    vi.stubGlobal("XMLHttpRequest", function () {
      return xhr;
    });
    const file = new File(["video bytes"], "test.mp4", { type: "video/mp4" });
    const progress = vi.fn();
    const promise = uploadWithProgress(
      "https://storage.example.com/presigned",
      file,
      { contentType: "", onProgress: progress },
    );
    expect(xhr.open).toHaveBeenCalledWith(
      "PUT",
      "https://storage.example.com/presigned",
      true,
    );
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith(
      "Authorization",
      expect.anything(),
    );
    xhr.upload.onprogress({ lengthComputable: true, loaded: 4, total: 10 });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ loaded: 4, percent: 40 }),
    );
    xhr.onload();
    await promise;
  });
  it("never sends an already-cancelled transfer", async () => {
    const xhr = {
      upload: {},
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("XMLHttpRequest", function () {
      return xhr;
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadWithProgress(
        "https://storage.example.com/presigned",
        new Blob(["media"]),
        { signal: controller.signal },
      ),
    ).rejects.toThrow("cancelled");
    expect(xhr.send).not.toHaveBeenCalled();
  });
});
