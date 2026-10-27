import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import LatestVideoFeed from "@/src/components/LatestVideoFeed";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  else delete (window as any).matchMedia;
});

it("shows a spinner rather than visible loading text while the Latest feed auto-loads", async () => {
  let resolveRequest!: (response: unknown) => void;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const fetch = vi.fn(() => request);
  vi.stubGlobal("fetch", fetch);
  let observerRootMargin = "";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.stubGlobal("IntersectionObserver", class {
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      observerRootMargin = options?.rootMargin || "";
    }
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
  });

  render(<LatestVideoFeed videoId="video-id" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("limit=10"));
  expect(observerRootMargin).toBe("1200px 0px");
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Fetching more videos" })).toBeInTheDocument();

  await act(async () => {
    resolveRequest({
      ok: true,
      json: async () => ({ videos: [], cursor: null }),
    });
    await request;
  });
});
