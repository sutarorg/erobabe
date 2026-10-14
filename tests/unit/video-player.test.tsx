import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VideoPlayer from "@/src/components/VideoPlayer";

const props = { id: "22222222-2222-4222-8222-222222222222", title: "Test clip", poster: "https://cdn.example.com/poster.jpg" };
const embed = "https://streamtape.com/e/abc123";
const media = "https://node.tapecontent.net/video.mp4?token=abc";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("video player", () => {
  it("prefers native video over any advertising iframe", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" embedUrl={embed} />);
    expect(container.querySelector("video")).toHaveAttribute("src", "https://cdn.example.com/a.mp4");
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves Streamtape only on demand and never inserts its iframe", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: media }) });
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    await waitFor(() => expect(container.querySelector("video")).toHaveAttribute("src", media));
    expect(fetch).toHaveBeenCalledWith(`/api/videos/${props.id}/playback`, expect.objectContaining({ cache: "no-store" }));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
  it("shows a retry rather than an ad-enabled fallback when resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ad-free playback is unavailable");
    expect(screen.getByRole("button", { name: "Retry playback" })).toBeInTheDocument();
    expect(container.querySelector("iframe, a")).toBeNull();
  });
  it("requests a fresh ticket when native playback fails (e.g. expired link)", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: media }) });
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not upgrade popup or navigation permissions for other embeds", () => {
    const { container } = render(<VideoPlayer {...props} embedUrl="https://example.com/embed/abc" />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
    expect(iframe.getAttribute("sandbox")).not.toMatch(/allow-popups|allow-top-navigation/);
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
  it("aborts pending resolution when leaving the page", () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<VideoPlayer {...props} embedUrl={embed} />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
