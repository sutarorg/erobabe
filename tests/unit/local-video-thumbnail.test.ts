import { afterEach, describe, it, expect, vi } from "vitest";
import { localVideoThumbnail } from "@/src/utils/localVideoThumbnail";
afterEach(() => vi.restoreAllMocks());
describe("local frame capture", () => {
  it("draws an actual decoded video frame and releases media resources", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      duration: { value: 10 },
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      currentTime: {
        get: () => 1.5,
        set: () => {
          queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
        },
      },
    });
    Object.defineProperty(video, "src", {
      set: () => {
        queueMicrotask(() => video.dispatchEvent(new Event("loadeddata")));
      },
    });
    const drawImage = vi.fn();
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray(64).fill(100) }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) =>
      callback(new Blob(["actual encoded test frame"], { type: "image/jpeg" })),
    );
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "video"
        ? video
        : tag === "canvas"
          ? canvas
          : original(tag)) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:local-video");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "load").mockImplementation(() => {});
    const result = await localVideoThumbnail(new File(["media"], "test.mp4"));
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540);
    expect(result.thumbnail?.type).toBe("image/jpeg");
    expect(result.duration).toBe(10);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-video");
    expect(canvas.width).toBe(0);
  });
});
