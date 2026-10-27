import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

  it("plays a damplips post page in our own player instead of framing it", () => {
    // damplips refuses to be framed and its post page is not media; the proxy
    // resolves the page to the file it advertises, so the visitor stays here.
    const post = "https://www.damplips.com/p/67284/";
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" embedUrl={post} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      `/api/videos/stream?src=${encodeURIComponent(post)}`,
    );
    expect(playbackCandidates(post)).toEqual([
      `/api/videos/stream?src=${encodeURIComponent(post)}`,
    ]);
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

  it("starts buffering as soon as the player opens", () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    expect(container.querySelector("video")).toHaveAttribute("preload", "auto");
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
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

  it("retries a source the element cannot decode as an HLS playlist", async () => {
    // Playlists are not always named `.m3u8`. When the element says the source
    // is undecodable, hls.js gets a turn at the very same URL before the
    // destination is abandoned.
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/playlist" />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "error", { value: { code: 4 }, configurable: true });

    fireEvent.error(video);

    const retried = container.querySelector("video")!;
    expect(retried).not.toBe(video);
    // hls.js feeds the element a MediaSource, so it carries no src of its own.
    expect(retried).not.toHaveAttribute("src");
    expect(screen.queryByRole("alert")).toBeNull();

    // jsdom has no Media Source Extensions, so nothing can play this source and
    // the visitor is told once everything has been tried.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry playback" })).toBeInTheDocument();
  });

  it("does not spend an HLS attempt on a plain network failure", () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "error", { value: { code: 2 }, configurable: true });

    fireEvent.error(video);

    // Straight to the next destination, still with a src.
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);
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
