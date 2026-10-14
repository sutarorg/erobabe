import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import VideoPlayer from "@/src/components/VideoPlayer";

const props = { id: "22222222-2222-4222-8222-222222222222", title: "Test clip", poster: "https://cdn.example.com/poster.jpg" };
const embed = "https://streamtape.com/e/abc123";
const media = `/api/videos/${props.id}/playback`;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("video player", () => {
  it("prefers native video over any advertising iframe", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { container } = render(<VideoPlayer {...props} playableUrl="https://cdn.example.com/a.mp4" embedUrl={embed} />);
    expect(container.querySelector("video")).toHaveAttribute("src", "https://cdn.example.com/a.mp4");
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("loads same-origin Streamtape media only after Play, without exposing tickets or an iframe", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { container } = render(<VideoPlayer {...props} embedUrl={embed} />);
    expect(container.querySelector("video, iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", media);
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    fireEvent.canPlay(video);
    expect(screen.queryByRole("status")).toBeNull();
    // The video element handles media requests, not a JSON fetch of a signed URL.
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector("iframe, a")).toBeNull();
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
    expect(container.querySelector("video")).not.toBeNull();
    rerender(<VideoPlayer {...props} id="another-video" embedUrl={embed} />);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });
});
