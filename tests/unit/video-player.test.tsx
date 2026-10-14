import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import VideoPlayer from "@/src/components/VideoPlayer";

const props = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Test clip",
  poster: "https://cdn.example.com/poster.jpg",
};
const embed = "https://streamtape.com/e/abc123";

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
  vi.restoreAllMocks();
});

/** The warm-up endpoint the player calls, ignoring the media element's own requests. */
function warmCalls() {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).endsWith("/prepare"),
  );
}

describe("video player", () => {
  it("shows Bunny poster before mounting validated playback", () => {
    const guid = "44444444-4444-4444-8444-444444444444";
    const url = `https://iframe.mediadelivery.net/embed/123/${guid}`;
    const { container } = render(
      <VideoPlayer
        {...props}
        provider="bunny"
        libraryId="123"
        videoId={guid}
        embedUrl={url}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", props.poster);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute(
      "src",
      `${url}?autoplay=true&responsive=true`,
    );
    expect(frame).toHaveAttribute("allowfullscreen");
    fireEvent.load(frame);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("shows unsupported historic records without calling an API", () => {
    render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(screen.getByText(/legacy video provider/)).toBeInTheDocument();
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
    // A direct file needs no server-side preparation at all.
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("starts buffering ahead on plain intent, before the click", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "metadata");

    fireEvent.pointerEnter(video.parentElement!);

    expect(video).toHaveAttribute("preload", "auto");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(warmCalls()).toHaveLength(0);
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
    expect(screen.getByText(/legacy video provider/)).toBeInTheDocument();
  });

  it("can retry a failed direct source without opening an iframe", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    const first = container.querySelector("video")!;
    fireEvent.error(first);
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("video")).not.toBe(first);
    expect(container.querySelector("iframe")).toBeNull();
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

    // A fresh page state: poster and play control, nothing playing.
    expect(container.querySelector("video")).not.toHaveAttribute("controls");
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.mp4",
    );
    expect(
      screen.getByRole("button", { name: "Play video" }),
    ).toBeInTheDocument();
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
