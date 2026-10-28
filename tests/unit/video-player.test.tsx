import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import VideoPlayer, {
  STALL_TIMEOUT_MS,
  mediaHostReachable,
  playbackCandidates,
} from "@/src/components/VideoPlayer";

const props = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Test clip",
  poster: "https://cdn.example.com/poster.jpg",
};
const damplipsFile = "https://video.damplips.com/videos/67284.mp4";
/**
 * The fallback for a damplips *file* is the edge proxy — the only runtime that
 * can fetch the host (the Node one is challenged on every attempt).
 */
const damplipsProxy = `/api/videos/stream-edge?src=${encodeURIComponent(damplipsFile)}`;
/** A post page has no file to frame: the proxy is the only destination. */
const damplipsPostPage = "https://www.damplips.com/p/67284/";

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
  it("plays a direct host file immediately, with nothing to prepare", () => {
    // damplips publishes its mp4s on a public host, exactly like the `<source>`
    // tag on its own post page. The element must stream that URL itself; the
    // proxy is only the fallback. Routing it through the proxy first is what
    // left the player on "Preparing video…".
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", damplipsFile);
    expect(video).toHaveAttribute("preload", "auto");
    // Hotlink protection rejects a foreign referer but allows none.
    expect(video).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back 10 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward 10 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playback speed" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    // The proxy is still there, second — it is not the first request.
    expect(playbackCandidates(damplipsFile)).toEqual([damplipsFile, damplipsProxy]);
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

    expect(container.querySelector("video")).toBe(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(video).not.toHaveAttribute("controls");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    // A file is never "prepared": the element streams it and shows its own
    // progress, so no overlay may claim otherwise.
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.canPlay(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("restarts native playback on retry", async () => {
    const { container } = render(
      <VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />,
    );
    const first = container.querySelector("video")!;
    fireEvent.error(first);
    // The last resort asks the host whether a copy is worth fetching; the panel
    // follows that answer.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded"),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(container.querySelector("video")).not.toBe(first);
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://cdn.example.com/a.mp4",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never shows a preparation screen over a direct file", () => {
    // The reported bug: a direct host mp4 sat on "Preparing video…" instead of
    // playing. Nothing may be drawn over a file while it buffers.
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;

    fireEvent.waiting(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Preparing video/i)).toBeNull();

    // It still plays in place once the bytes arrive.
    fireEvent.canPlay(video);
    expect(container.querySelector("video")).toBe(video);
  });

  it("says what it is doing for a destination that must be resolved first", () => {
    // A post page is HTML: the proxy has to turn it into media, and that is
    // worth a status line.
    render(<VideoPlayer {...props} provider="damplips" embedUrl="https://www.damplips.com/p/67284/" />);
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
  });

  it("leaves a file that is downloading alone even past the stall deadline", () => {
    // A 100+ MB file on a slow line is not stuck. The deadline only exists for
    // an attempt that has produced nothing, so a source with metadata must not
    // be cut over to the (slower) proxy.
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
      );
      const video = container.querySelector("video")!;
      Object.defineProperty(video, "readyState", { value: 1, configurable: true });

      act(() => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1_000);
      });

      expect(container.querySelector("video")).toBe(video);
      expect(video).toHaveAttribute("src", damplipsFile);
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches to the proxy at once when the media host cannot be reached", async () => {
    // An ISP filter, a DNS block or an ad-blocker drops the host entirely. The
    // element would sit there; the probe settles it in a moment and the video
    // plays through our own origin instead.
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === damplipsFile) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    });

    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );

    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src", damplipsProxy),
    );
    expect(container.querySelector("video")).not.toHaveAttribute("referrerpolicy");
  });

  it("keeps playing the direct file when the host answers the probe", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));

    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );

    // Give the probe a turn; the element must keep the fast direct source.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);
  });

  it("probes the host once, not on every render", async () => {
    // Regression guard: `urls` is rebuilt by the caller on each render, so an
    // effect keyed on the array would hammer the media host forever.
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    const { rerender } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    rerender(<VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />);
    rerender(<VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("probes with a HEAD request that needs no CORS grant", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    await mediaHostReachable(damplipsFile);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(damplipsFile);
    expect(init.method).toBe("HEAD");
    expect(init.mode).toBe("no-cors");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("retries the same file in CORS mode before giving up on the host", async () => {
    // The host publishes `Access-Control-Allow-Origin: *`, so a file it refuses
    // as a plain media request can still be allowed as a CORS request. That is
    // a different request, so it is worth one attempt.
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const first = container.querySelector("video")!;
    expect(first).not.toHaveAttribute("crossorigin");

    fireEvent.error(first);

    const retried = container.querySelector("video")!;
    expect(retried).not.toBe(first);
    expect(retried).toHaveAttribute("src", damplipsFile);
    expect(retried).toHaveAttribute("crossorigin", "anonymous");
  });

  it("tries the proxy when the CORS request is refused too", () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    fireEvent.error(container.querySelector("video")!);
    fireEvent.error(container.querySelector("video")!);

    const proxied = container.querySelector("video")!;
    expect(proxied).toHaveAttribute("src", damplipsProxy);
    expect(proxied).not.toHaveAttribute("crossorigin");
  });

  it("plays a copy the browser fetched itself when the element cannot take the file", async () => {
    // Last resort: the element is refused, but the page may still read the
    // bytes. A blob URL has no origin and no headers to refuse.
    const objectUrl = "blob:erobabe/1";
    const createObjectURL = vi.fn(() => objectUrl);
    const original = URL.createObjectURL;
    // jsdom has no object-URL support; the player checks before using it.
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/videos/stream")) throw new TypeError("Failed to fetch");
      return new Response("x", { status: 200, headers: { "content-type": "video/mp4" } });
    });
    try {
      const { container } = render(
        <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
      );
      fireEvent.error(container.querySelector("video")!); // CORS retry
      fireEvent.error(container.querySelector("video")!); // proxy
      fireEvent.error(container.querySelector("video")!); // own copy

      await waitFor(() =>
        expect(container.querySelector("video")).toHaveAttribute("src", objectUrl),
      );
      expect(createObjectURL).toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      Object.defineProperty(URL, "createObjectURL", { value: original, configurable: true });
    }
  });

  it("still explains a dead end when there is no frame to fall back to", () => {
    // A proxied-only destination is our own route: there is nothing to frame,
    // so the panel has to carry the diagnosis.
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsPostPage} />,
    );
    const fail = (element: HTMLVideoElement) => {
      Object.defineProperty(element, "error", { value: { code: 2 }, configurable: true });
      fireEvent.error(element);
    };
    fail(container.querySelector("video")!);

    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(container.textContent).toContain(
      `/api/videos/stream?src=${encodeURIComponent(damplipsPostPage)}`,
    );
    expect(container.textContent).toMatch(/media error 2 \(network\)/);
    expect(screen.getByText("Technical details")).toBeInTheDocument();
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
    expect(container.querySelector("video")).not.toHaveAttribute("controls");

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
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("falls back to the stream proxy when the host refuses the direct file", async () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", damplipsFile);

    fireEvent.error(video);

    // First the same file in CORS mode, then the proxy; the visitor sees no
    // error while anything is still being tried.
    fireEvent.error(container.querySelector("video")!);

    const retried = container.querySelector("video")!;
    expect(retried).not.toBe(video);
    expect(retried).toHaveAttribute("src", damplipsProxy);
    expect(retried).not.toHaveAttribute("referrerpolicy");
    expect(screen.queryByRole("alert")).toBeNull();

    // Both destinations failed, and no copy could be fetched: the visitor is
    // told, with the one action that can still work for a challenged host.
    fireEvent.error(retried);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded"),
    );
    // The one action that can still work for a challenged host is offered.
    expect(screen.getByRole("link", { name: /open the video directly/i })).toHaveAttribute(
      "href",
      damplipsFile,
    );
  });

  it("returns to the first destination when the visitor retries", async () => {
    const { container } = render(
      <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
    );
    fireEvent.error(container.querySelector("video")!);
    fireEvent.error(container.querySelector("video")!);
    fireEvent.error(container.querySelector("video")!);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry playback" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);
    // The CORS attempt is not remembered as the starting point.
    expect(container.querySelector("video")).not.toHaveAttribute("crossorigin");
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

    // No HLS attempt (the content was never the problem) — the same file is
    // tried in CORS mode first, then the proxy.
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toHaveAttribute("src", damplipsProxy);
  });

  it("offers exactly one destination for a non-damplips file", () => {
    expect(playbackCandidates("https://cdn.example.com/a.mp4")).toEqual([
      "https://cdn.example.com/a.mp4",
    ]);
    // A damplips file plays straight from its host, with the edge proxy behind
    // it — the Node proxy cannot fetch this host at all.
    expect(playbackCandidates(damplipsFile)).toEqual([damplipsFile, damplipsProxy]);
    // A playlist is a document: it has to be rewritten before a frame can play.
    const playlist = "https://video.damplips.com/video7/717/79.m3u8";
    expect(playbackCandidates(playlist)).toEqual([
      `/api/videos/stream?src=${encodeURIComponent(playlist)}`,
      playlist,
    ]);
    // A post page is HTML; only the proxy can turn it into media.
    const post = "https://www.damplips.com/p/67284/";
    expect(playbackCandidates(post)).toEqual([
      `/api/videos/stream?src=${encodeURIComponent(post)}`,
    ]);
  });

  it("gives up on a destination that never delivers a byte", () => {
    // A host that accepts the connection and then says nothing fires no error:
    // the element just waits. Without a deadline the visitor would sit on
    // "Preparing video…" forever.
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
      );
      expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);

      // Nothing arrives at all: no error, no byte, no metadata.
      act(() => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 100);
      });

      // The deadline moves on to the next attempt rather than waiting forever.
      expect(container.querySelector("video")).toHaveAttribute("src", damplipsFile);
      expect(container.querySelector("video")).toHaveAttribute("crossorigin", "anonymous");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trying a destination that is actually buffering", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VideoPlayer {...props} provider="damplips" playableUrl={damplipsFile} />,
      );
      const video = container.querySelector("video")!;
      fireEvent.progress(video);

      act(() => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 100);
      });

      expect(container.querySelector("video")).toBe(video);
      expect(video).toHaveAttribute("src", damplipsFile);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams an HLS playlist with the element itself when the browser can, so buffering starts at once", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const playlist = "https://cdn.example.com/master.m3u8";
    const { container } = render(
      <VideoPlayer {...props} playableUrl={playlist} />,
    );

    // No hls.js chunk to wait for: the same server-rendered element gets the
    // playlist address and buffers immediately.
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src", playlist),
    );
    expect(container.querySelector("video")).toHaveAttribute("preload", "auto");
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
