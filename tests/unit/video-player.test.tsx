import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import VideoPlayer, { playbackCandidates } from "@/src/components/VideoPlayer";

const props = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Test clip",
  poster: "https://cdn.example.com/poster.jpg",
};
const damplipsFile = "https://video.damplips.com/videos/67284.mp4";
const damplipsProxy = `/api/videos/stream?src=${encodeURIComponent(damplipsFile)}`;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no media stack; the player only needs these calls to happen.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
    Promise.resolve(),
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("video player", () => {
  it("plays a damplips file through the same-origin stream proxy", () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsProxy);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });

  it("frames a damplips embed page in the restrictive sandbox", () => {
    const { container } = render(
      <VideoPlayer
        {...props}
        provider="damplips"
        embedUrl="https://www.damplips.com/p/67284/"
      />,
    );
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute("src", "https://www.damplips.com/p/67284/");
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-presentation",
    );
    expect(frame).toHaveAttribute("allowfullscreen");
    expect(container.querySelector("video")).toBeNull();
  });

  it("shows a message instead of a player for retired sources", () => {
    render(
      <VideoPlayer
        {...props}
        provider="bunny"
        embedUrl="https://iframe.mediadelivery.net/embed/123/44444444-4444-4444-8444-444444444444"
      />,
    );
    expect(screen.getByText(/no longer supported/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers native video over any advertising iframe", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.mp4",
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("buffers ahead behind the poster so the first frame is instant", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
      );
      const video = container.querySelector("video")!;
      expect(video).toHaveAttribute("preload", "metadata");

      act(() => {
        vi.advanceTimersByTime(1200);
      });

      expect(video).toHaveAttribute("preload", "auto");
      expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
      // Nothing was restarted: the same element keeps its buffered data.
      expect(container.querySelector("video")).toBe(video);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the element that is already buffering instead of mounting a new one", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    const video = container.querySelector("video")!;

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));

    expect(container.querySelector("video")).toBe(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(video).toHaveAttribute("controls");
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");

    fireEvent.canPlay(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe, a")).toBeNull();
  });

  it("restarts native playback on retry", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const first = container.querySelector("video")!;
    fireEvent.error(first);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe, a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(container.querySelector("video")).not.toBe(first);
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.mp4",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not mount untrusted generic iframe URLs", () => {
    const { container } = render(
      <VideoPlayer {...props} embedUrl="https://example.com/embed/abc" />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/no longer supported/)).toBeInTheDocument();
  });

  it("resets native playback when navigating to another video", () => {
    const { container, rerender } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(container.querySelector("video")).toHaveAttribute("controls");

    rerender(
      <VideoPlayer
        {...props}
        id="another-video"
        playableUrl="https://cdn.example.com/a.mp4"
      />,
    );

    expect(container.querySelector("video")).not.toHaveAttribute("controls");
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.mp4",
    );
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });

  it("falls back to the direct damplips file when the proxy cannot deliver it", () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", damplipsProxy);

    fireEvent.error(video);

    // The proxy is gone from the element and the visitor sees no error yet:
    // the second destination is tried first.
    const retried = container.querySelector("video")!;
    expect(retried).not.toBe(video);
    expect(retried).toHaveAttribute("src", damplipsFile);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.error(retried);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByRole("button", { name: "Retry playback" })).toBeInTheDocument();
  });

  it("returns to the proxy first when the visitor retries", () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    fireEvent.error(container.querySelector("video")!);
    fireEvent.error(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsProxy);
  });

  it("offers exactly one destination for a non-damplips file", () => {
    expect(playbackCandidates("https://cdn.example.com/a.mp4")).toEqual([
      "https://cdn.example.com/a.mp4",
    ]);
    expect(playbackCandidates(damplipsFile)).toEqual([damplipsProxy, damplipsFile]);
  });

  it("keeps trusted historical players in their restrictive sandbox", () => {
    const { container } = render(
      <VideoPlayer
        {...props}
        provider="embed"
        embedUrl="https://www.youtube-nocookie.com/embed/abc123"
      />,
    );
    expect(container.querySelector("iframe")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-presentation",
    );
  });
});
