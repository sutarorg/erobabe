import { afterEach, describe, it, expect, vi } from "vitest";
import { localVideoThumbnail } from "@/src/utils/localVideoThumbnail";
afterEach(() => vi.restoreAllMocks());
describe("local actual-frame pipeline", () => {
  it("scores multiple decoded frames, renders a 1280x720 JPEG and cleans up", async () => {
    const video = document.createElement("video");
    let time = 0;
    Object.defineProperties(video, {
      duration: { value: 100 },
      videoWidth: { value: 1080 },
      videoHeight: { value: 1920 },
      currentTime: {
        get: () => time,
        set: (t) => {
          time = t;
          queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
        },
      },
    });
    Object.defineProperty(video, "src", {
      set: () =>
        queueMicrotask(() => video.dispatchEvent(new Event("loadeddata"))),
    });
    const canvases: HTMLCanvasElement[] = [];
    const draws = vi.fn();
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "video") return video;
      const element = original(tag);
      if (tag === "canvas") {
        const canvas = element as HTMLCanvasElement;
        canvases.push(canvas);
        vi.spyOn(canvas, "getContext").mockReturnValue({
          drawImage: draws,
          filter: "",
          putImageData: vi.fn(),
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < w * h; i++) {
              const v = time < 10 ? 0 : i % 2 ? 180 : 60;
              data.set([v, v, Math.min(255, v + 10), 255], i * 4);
            }
            return { data, width: w, height: h };
          },
        } as unknown as CanvasRenderingContext2D);
        vi.spyOn(canvas, "toBlob").mockImplementation((cb) =>
          cb(new Blob(["encoded"], { type: "image/jpeg" })),
        );
      }
      return element;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:source");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "load").mockImplementation(() => {});
    const result = await localVideoThumbnail(new File(["media"], "clip.mp4"));
    expect(draws.mock.calls.length).toBeGreaterThan(10);
    expect(result.thumbnail?.type).toBe("image/jpeg");
    expect(result.duration).toBe(100);
    expect(canvases[0].toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.92,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(canvases[0].width).toBe(0);
  });
});
