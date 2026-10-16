import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import LatestVideoFeed from "@/src/components/LatestVideoFeed";

afterEach(() => vi.unstubAllGlobals());

it("shows a spinner rather than visible loading text while the Latest feed auto-loads", async () => {
  let resolveRequest!: (response: unknown) => void;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const fetch = vi.fn(() => request);
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("IntersectionObserver", class {
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
  });

  render(<LatestVideoFeed videoId="video-id" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Fetching more videos" })).toBeInTheDocument();

  await act(async () => {
    resolveRequest({
      ok: true,
      json: async () => ({ videos: [], cursor: null }),
    });
    await request;
  });
});
