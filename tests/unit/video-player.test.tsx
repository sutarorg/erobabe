import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import VideoPlayer, { earlyPrepareScript, formatClock } from "@/src/components/VideoPlayer";

const props = { id: "22222222-2222-4222-8222-222222222222", title: "Test clip", poster: "https://cdn.example.com/poster.jpg" };
const embed = "https://streamtape.com/e/abc123";
const media = `/api/videos/${props.id}/playback`;

// jsdom has no PointerEvent; React reads `pointerType` from the native event.
class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
    this.pointerId = init.pointerId ?? 1;
  }
}

let play: MockInstance;
let pause: MockInstance;
let load: MockInstance;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom does not implement media playback.
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as Window & { __erobabePrepared?: unknown }).__erobabePrepared;
});

/** Runs the inline script the way the browser does while parsing the server's HTML. */
const runInlineScript = (source: string) => new Function(source)();

const videoOf = (container: HTMLElement) => container.querySelector("video")!;
const playerOf = () => screen.getByRole("region", { name: /Video player/ });
/** Make the element report that it is playing, as a browser would after play(). */
function startPlaying(video: HTMLVideoElement) {
  Object.defineProperty(video, "paused", { configurable: true, get: () => false });
  fireEvent.play(video);
  fireEvent.playing(video);
}

describe("video player sources and security", () => {
  it("prefers native video over any advertising iframe", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" embedUrl={embed} />);
    expect(videoOf(container)).toHaveAttribute("src", "https://cdn.example.com/a.mp4");
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams Streamtape through the same-origin relay, never a ticket, link or iframe", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    const video = videoOf(container);
    expect(video).toHaveAttribute("src", media);
    expect(video).toHaveAttribute("playsinline");
    expect(container.querySelector("iframe, a")).toBeNull();
    // The only request the page makes itself asks the server to prepare its
    // own link; nothing comes back to the browser except a status code.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(media, expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(video).toHaveAttribute("src", media);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not upgrade popup or navigation permissions for other embeds", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl="https://example.com/embed/abc" />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
    expect(iframe.getAttribute("sandbox")).not.toMatch(/allow-popups|allow-top-navigation/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains when no playable source exists yet", () => {
    const { container } = render(<VideoPlayer {...props} />);
    expect(screen.getByText("Video processing — check back soon")).toBeInTheDocument();
    expect(container.querySelector("video, iframe")).toBeNull();
  });
});

describe("instant start", () => {
  it("has the video element ready before Play instead of creating it on click", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    expect(video).toHaveAttribute("preload", "metadata");
    expect(screen.queryByRole("status")).toBeNull(); // no "Preparing video…" before the visitor asks
  });

  it("asks the relay to prepare from the server-rendered HTML, before hydration", () => {
    const html = renderToString(<VideoPlayer {...props} embedUrl={embed} />);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBe(earlyPrepareScript(media));
    // Emitted ahead of the player markup, so it runs as soon as the parser gets there.
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<video"));
    // Direct files have no handshake, and other embeds are never prepared.
    expect(renderToString(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" embedUrl={embed} />)).not.toContain("<script");
    expect(renderToString(<VideoPlayer {...props} embedUrl="https://example.com/embed/abc" />)).not.toContain("<script");
  });

  it("sends one prepare request from the inline script and the player does not repeat it", () => {
    runInlineScript(earlyPrepareScript(media));
    runInlineScript(earlyPrepareScript(media)); // a repeated script must not ask twice
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(media, { method: "POST", cache: "no-store", credentials: "same-origin" });

    render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The marker is consumed: coming back to the video later in the tab asks again.
    cleanup();
    render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still prepares on client-side navigation, where inline scripts never run", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(container.querySelector("script")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(media, expect.objectContaining({ method: "POST" }));
  });

  it("keeps a crafted URL from closing the inline script", () => {
    const hostile = "/api/videos/x</script><script>alert(1)</script>/playback";
    const source = earlyPrepareScript(hostile);
    expect(source).not.toMatch(/<\/?script/i);
    runInlineScript(source);
    expect(fetchMock).toHaveBeenCalledWith(hostile, expect.objectContaining({ method: "POST" }));
  });

  it("never lets the inline script break the page, and falls back to the player's request", async () => {
    fetchMock.mockImplementationOnce(() => { throw new Error("blocked"); });
    expect(() => runInlineScript(earlyPrepareScript(media))).not.toThrow();
    // Nothing was sent, so the player must not assume it was.
    render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(media, expect.objectContaining({ method: "POST" }));

    // A request that fails on the network is swallowed instead of surfacing as an error.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    fetchMock.mockImplementationOnce(async () => { throw new TypeError("Failed to fetch"); });
    expect(() => runInlineScript(earlyPrepareScript(`${media}?again`))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("fetches no relayed media bytes until the visitor shows intent", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    const video = videoOf(container);
    expect(video).toHaveAttribute("preload", "none");
    fireEvent.pointerEnter(playerOf());
    expect(video).toHaveAttribute("preload", "metadata");
  });

  it("buffers more of a direct file once the visitor points at the player", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.pointerEnter(playerOf());
    expect(videoOf(container)).toHaveAttribute("preload", "auto");
  });

  it("calls play() inside the click so the browser allows sound, and shows progress at once", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    const video = videoOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.contexts[0]).toBe(video);
    expect(screen.getByRole("status")).toHaveTextContent("Loading video");
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
    startPlaying(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("starts immediately without a spinner when enough is already buffered", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    Object.defineProperty(video, "readyState", { configurable: true, get: () => 4 });
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the spinner while buffering mid-playback and hides it when frames resume", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(video);
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.playing(video);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers Play again if the browser refuses to start", async () => {
    play.mockImplementation(() => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })));
    render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(await screen.findByRole("button", { name: "Play video" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("picks up media state that arrived before hydration", () => {
    const duration = vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(754);
    render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    expect(screen.getByText(/12:34/)).toBeInTheDocument();
    duration.mockRestore();
  });
});

describe("site-designed controls", () => {
  it("uses the website's controls instead of the browser's", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" quality="4K" durationSeconds={512} />);
    expect(videoOf(container)).not.toHaveAttribute("controls");
    for (const name of ["Play video", "Play", "Mute", "Playback speed", "Full screen"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Volume" })).toBeInTheDocument();
    expect(screen.getByText("4K")).toBeInTheDocument();
    // Catalogue duration until the media's own metadata arrives.
    expect(screen.getByText(/0:00/).textContent).toMatch(/0:00\s*\/\s*8:32/);
  });

  it("toggles play and pause from the control bar", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledTimes(1);
    startPlaying(video);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("clicking the picture toggles playback for mouse users", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const surface = screen.getByTestId("player-surface");
    fireEvent.pointerDown(surface, { pointerType: "mouse" });
    fireEvent.click(surface);
    expect(play).toHaveBeenCalledTimes(1);
    startPlaying(videoOf(container));
    fireEvent.pointerDown(surface, { pointerType: "mouse" });
    fireEvent.click(surface);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("a tap shows the controls during playback instead of pausing", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(videoOf(container));
    const surface = screen.getByTestId("player-surface");
    fireEvent.pointerDown(surface, { pointerType: "touch" });
    fireEvent.click(surface);
    expect(pause).not.toHaveBeenCalled();
  });

  it("never lets the control bar's gradient swallow taps meant for the Play button", () => {
    // Found with a real phone-sized browser: the bar's transparent gradient
    // reached over the lower half of the big Play button and ate those taps.
    render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const bigPlay = screen.getByRole("button", { name: "Play video" });
    const barPlay = screen.getByRole("button", { name: "Play" });
    const bar = barPlay.closest("div.absolute")!;
    expect(bar).toHaveClass("pointer-events-none"); // the gradient is click-through
    expect(barPlay.parentElement).toHaveClass("pointer-events-auto"); // only the controls take input
    // Same stacking context, later in the DOM: the centre button paints above the gradient.
    expect(bar.compareDocumentPosition(bigPlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the controls while playing and brings them back on mouse movement", () => {
    vi.useFakeTimers();
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const bar = () => screen.getByRole("button", { name: /^(Play|Pause)$/ }).closest("div.absolute")!;
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(videoOf(container));
    expect(bar()).toHaveClass("opacity-100");
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(bar()).toHaveClass("opacity-0");
    fireEvent.pointerMove(playerOf(), { pointerType: "mouse" });
    expect(bar()).toHaveClass("opacity-100");
  });

  it("keeps the controls visible while a keyboard user is inside them", () => {
    vi.useFakeTimers();
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(videoOf(container));
    fireEvent.keyDown(document.body, { key: "Tab" });
    const pauseButton = screen.getByRole("button", { name: "Pause" });
    act(() => { pauseButton.focus(); });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(pauseButton.closest("div.absolute")).toHaveClass("opacity-100");
  });

  it("seeks with the progress slider's keyboard controls", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" durationSeconds={600} />);
    const video = videoOf(container);
    const seek = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(video.currentTime).toBe(5);
    expect(seek).toHaveAttribute("aria-valuetext", "0:05 of 10:00");
    fireEvent.keyDown(seek, { key: "End" });
    expect(video.currentTime).toBe(600);
    fireEvent.keyDown(seek, { key: "Home" });
    expect(video.currentTime).toBe(0);
  });

  it("seeks to where the progress bar is clicked", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" durationSeconds={600} />);
    const seek = screen.getByRole("slider", { name: "Seek" });
    const track = seek.firstElementChild as HTMLElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 100, width: 400, top: 0, height: 4, right: 500, bottom: 4, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(seek, { pointerType: "mouse", button: 0, clientX: 200 });
    fireEvent.pointerMove(seek, { pointerType: "mouse", clientX: 300 });
    // Dragging previews the position without spamming seeks.
    expect(videoOf(container).currentTime).toBe(0);
    expect(seek).toHaveAttribute("aria-valuetext", "5:00 of 10:00");
    fireEvent.pointerUp(seek, { pointerType: "mouse", clientX: 300 });
    expect(videoOf(container).currentTime).toBe(300);
  });

  it("supports the usual keyboard shortcuts once the player has focus", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" durationSeconds={600} />);
    const video = videoOf(container);
    const player = playerOf();
    fireEvent.keyDown(player, { key: "k" });
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(player, { key: "l" });
    expect(video.currentTime).toBe(10);
    fireEvent.keyDown(player, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(player, { key: "5" });
    expect(video.currentTime).toBe(300);
    fireEvent.keyDown(player, { key: "m" });
    expect(video.muted).toBe(true);
    fireEvent.keyDown(player, { key: "ArrowDown" });
    expect(video.volume).toBeCloseTo(0.9);
    expect(video.muted).toBe(false);
  });

  it("leaves Space to a focused button so it is not activated twice", () => {
    render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Mute" }), { key: " " });
    expect(play).not.toHaveBeenCalled();
  });

  it("mutes, unmutes and remembers the visitor's volume", () => {
    const { container, unmount } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(videoOf(container).muted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
    unmount();
    const next = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/b.mp4" />);
    expect(videoOf(next.container).muted).toBe(true);
  });

  it("changes playback speed from the settings menu", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const settings = screen.getByRole("button", { name: "Playback speed" });
    fireEvent.click(settings);
    expect(settings).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Playback speed" });
    expect(within(menu).getByRole("menuitemradio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "1.5×" }));
    expect(videoOf(container).playbackRate).toBe(1.5);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(settings);
    expect(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "1.5×" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closing the menu by clicking the picture does not also pause the video", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(videoOf(container));
    fireEvent.click(screen.getByRole("button", { name: "Playback speed" }));
    const surface = screen.getByTestId("player-surface");
    fireEvent.pointerDown(surface, { pointerType: "mouse" });
    fireEvent.click(surface);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(pause).not.toHaveBeenCalled();
  });

  it("offers a replay when the video ends", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    startPlaying(video);
    fireEvent.ended(video);
    fireEvent.click(screen.getByRole("button", { name: "Replay video" }));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("enters full screen on the player itself, so the site's controls stay visible", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const player = playerOf();
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(player, "requestFullscreen", { configurable: true, value: request });
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(videoOf(container)).not.toHaveAttribute("controls");
  });
});

describe("recovering from errors", () => {
  it("restarts the media request on retry so the server obtains a fresh ticket", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const video = videoOf(container);
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("iframe, a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(videoOf(container)).toHaveAttribute("src", media);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can retry a failed direct source without opening an iframe", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    fireEvent.error(videoOf(container));
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("resumes where it stopped after a retry", () => {
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" />);
    const video = videoOf(container);
    video.currentTime = 42;
    fireEvent.error(video);
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    video.currentTime = 0; // what load() does in a browser
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(42);
  });

  it("resets the player when navigating to another Streamtape video", () => {
    const { container, rerender } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    const other = "33333333-3333-4333-8333-333333333333";
    rerender(<VideoPlayer {...props} id={other} embedUrl={embed} />);
    expect(videoOf(container)).toHaveAttribute("src", `/api/videos/${other}/playback`);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/videos/${other}/playback`, expect.objectContaining({ method: "POST" }));
  });
});

describe("formatClock", () => {
  it.each([[0, "0:00"], [5.9, "0:05"], [75, "1:15"], [600, "10:00"], [3725, "1:02:05"], [Number.NaN, "0:00"], [-3, "0:00"]])(
    "%s → %s",
    (input, output) => expect(formatClock(input)).toBe(output),
  );
});
