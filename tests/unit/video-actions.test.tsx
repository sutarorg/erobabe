import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VideoActions from "@/src/components/VideoActions";
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it("persists likes through remounts even when community sync fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const { unmount } = render(<VideoActions title="A video" videoId="one" />);
  fireEvent.click(screen.getByRole("button", { name: "Like" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Liked" }).getAttribute("aria-pressed")).toBe("true"));
  expect(localStorage.getItem("video-like:one")).toBe("true");
  unmount();
  render(<VideoActions title="A video" videoId="one" />);
  expect(screen.getByRole("button", { name: "Liked" })).toBeTruthy();
});
it("keeps preferences per video and persists explicit unlikes", async () => {
  localStorage.setItem("video-like:one", "true");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  const { rerender } = render(<VideoActions title="One" videoId="one" />);
  fireEvent.click(screen.getByRole("button", { name: "Liked" }));
  await waitFor(() => expect(localStorage.getItem("video-like:one")).toBe("false"));
  rerender(<VideoActions title="Two" videoId="two" />);
  expect(screen.getByRole("button", { name: "Like" }).getAttribute("aria-pressed")).toBe("false");
});
