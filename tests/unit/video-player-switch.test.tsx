import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import VideoPlayer, { mediaHostReachable, probeDirectSource } from "@/src/components/VideoPlayer";

const damplipsFile = "https://video.damplips.com/videos/67284.mp4";
const otherFile = "https://video.damplips.com/videos/90001.mp4";

const first = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "First clip",
  poster: "https://cdn.example.com/first.jpg",
};
const second = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Second clip",
  poster: "https://cdn.example.com/second.jpg",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("switching videos while one is still loading", () => {
  it("replaces the element instead of reusing the in-flight one", () => {
    const { container, rerender } = render(
      <VideoPlayer {...first} provider="damplips" playableUrl={damplipsFile} />,
    );
    const originalElement = container.querySelector("video")!;

    rerender(<VideoPlayer {...second} provider="damplips" playableUrl={otherFile} />);
    const replacement = container.querySelector("video")!;

    // A fresh element is what actually abandons the first request; reusing the
    // node would keep the old download alive behind the new title.
    expect(replacement).not.toBe(originalElement);
    expect(replacement.getAttribute("src")).toContain("90001.mp4");
  });

  it("cancels the download and the decoder when the viewer moves on", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const load = vi.spyOn(HTMLMediaElement.prototype, "load");

    const { container, unmount } = render(
      <VideoPlayer {...first} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;
    pause.mockClear();
    load.mockClear();

    unmount();

    expect(pause).toHaveBeenCalled();
    // Dropping the source before reloading is what tells the network stack to
    // abort rather than finish a file nobody is watching any more.
    expect(video.hasAttribute("src")).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it("starts the new video at once, without waiting for the old one", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const { rerender } = render(<VideoPlayer {...first} provider="damplips" playableUrl={damplipsFile} />);
    play.mockClear();

    rerender(<VideoPlayer {...second} provider="damplips" playableUrl={otherFile} />);

    // The replacement element is asked to play on its own first effect run; no
    // state from the previous video gates it.
    expect(play).toHaveBeenCalled();
  });
});

describe("cancellable media probes", () => {
  it("aborts a reachability probe through the supplied signal", async () => {
    const controller = new AbortController();
    const seen: { signal: AbortSignal | null } = { signal: null };
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      seen.signal = init.signal as AbortSignal;
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const reachable = await mediaHostReachable(damplipsFile, 5_000, controller.signal);
    expect(reachable).toBe(false);
    expect(seen.signal?.aborted).toBe(true);
  });

  it("aborts a CORS probe through the supplied signal", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      controller.abort();
      expect((init.signal as AbortSignal).aborted).toBe(true);
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    await expect(probeDirectSource(damplipsFile, 5_000, controller.signal)).resolves.toBeNull();
  });

  it("still answers normally when nothing cancels the probe", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "video/mp4" } }));
    await expect(probeDirectSource(damplipsFile)).resolves.toEqual({
      status: 200,
      contentType: "video/mp4",
    });
    expect(await mediaHostReachable(damplipsFile)).toBe(true);
  });
});
