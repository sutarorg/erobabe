import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import VideoPlayer from "@/src/components/VideoPlayer";

const props = { id: "22222222-2222-4222-8222-222222222222", title: "Test clip", poster: "https://cdn.example.com/poster.jpg" };
const embed = "https://streamtape.com/e/abc123";
const media = `/api/videos/${props.id}/playback`;
const prepare = `/api/videos/${props.id}/prepare`;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no media stack; the player only needs these calls to happen.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** The warm-up endpoint the player calls, ignoring the media element's own requests. */
function warmCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/prepare"));
}

describe("video player", () => {
  it("prefers native video over any advertising iframe", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" embedUrl={embed} />);
    expect(container.querySelector("video")).toHaveAttribute("src", "https://cdn.example.com/a.mp4");
    expect(container.querySelector("iframe")).toBeNull();
    // A direct file needs no server-side preparation at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mounts the same-origin media element on load so playback is ready before the click", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", media);
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    // The poster is on screen with the site's own play control; no provider UI.
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
    expect(container.querySelector("iframe, a")).toBeNull();
    expect(container.innerHTML).not.toMatch(/streamtape\.(com|net|to)\/(e|v)\//i);
  });

  it("warms the media link before the click, and never fetches a signed URL", async () => {
    render(<VideoPlayer {...props} embedUrl={embed} />);
    await act(async () => { await Promise.resolve(); });
    expect(warmCalls()).toHaveLength(1);
    expect(warmCalls()[0][1]).toMatchObject({ method: "POST" });
    // Only the warm-up JSON call: the media itself is requested by the element.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("buffers ahead behind the poster so the first frame is instant", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
      const video = container.querySelector("video")!;
      expect(video).toHaveAttribute("preload", "metadata");

      act(() => { vi.advanceTimersByTime(1200); });

      expect(video).toHaveAttribute("preload", "auto");
      expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
      // Nothing was restarted: the same element keeps its buffered data.
      expect(container.querySelector("video")).toBe(video);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the element that is already buffering instead of mounting a new one", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
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
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "metadata");

    fireEvent.pointerEnter(video.parentElement!);

    expect(video).toHaveAttribute("preload", "auto");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(warmCalls()).toHaveLength(1);
  });

  it("restarts the media request on retry so the server obtains a fresh ticket", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const first = container.querySelector("video")!;
    fireEvent.error(first);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe, a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(container.querySelector("video")).not.toBe(first);
    expect(container.querySelector("video")).toHaveAttribute("src", media);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not upgrade popup or navigation permissions for other embeds", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl="https://example.com/embed/abc" />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
    expect(iframe.getAttribute("sandbox")).not.toMatch(/allow-popups|allow-top-navigation/);
    expect(warmCalls()).toHaveLength(0);
  });

  it("can retry a failed direct source without opening an iframe", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const first = container.querySelector("video")!;
    fireEvent.error(first);
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("video")).not.toBe(first);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("resets the player when navigating to another Streamtape video", () => {
    const { container, rerender } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(container.querySelector("video")).toHaveAttribute("controls");

    rerender(<VideoPlayer {...props} id="another-video" embedUrl={embed} />);

    // A fresh page state: poster and play control, nothing playing.
    expect(container.querySelector("video")).not.toHaveAttribute("controls");
    expect(container.querySelector("video")).toHaveAttribute("src", "/api/videos/another-video/playback");
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });
});
