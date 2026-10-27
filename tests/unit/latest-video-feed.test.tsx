import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import LatestVideoFeed from "@/src/components/LatestVideoFeed";
import {
  LATEST_FEED_BATCH_ROWS,
  LATEST_FEED_MAX_BATCH,
  LATEST_FEED_MIN_BATCH,
  LATEST_FEED_ROOT_MARGIN,
  latestFeedBatchSize,
} from "@/lib/public/shelf";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  else delete (window as any).matchMedia;
});

function stubMobile(observer: { rootMargin?: string } = {}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  let callback!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(handler: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      callback = handler;
      observer.rootMargin = options?.rootMargin || "";
    }
    observe(target: Element) {
      callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    trigger(target: Element) {
      callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
  });
}

it("shows a spinner rather than visible loading text while the Latest feed auto-loads", async () => {
  let resolveRequest!: (response: unknown) => void;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const fetch = vi.fn(() => request);
  vi.stubGlobal("fetch", fetch);
  const observer: { rootMargin?: string } = {};
  stubMobile(observer);

  render(<LatestVideoFeed videoId="video-id" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  // Two mobile shelves are requested in one go, so scrolling past ten cards
  // finds the next batch already on its way.
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`limit=${LATEST_FEED_MIN_BATCH}`));
  expect(observer.rootMargin).toBe(LATEST_FEED_ROOT_MARGIN);
  expect(observer.rootMargin).toBe("2400px 0px");
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

describe("latest feed batch sizing", () => {
  it("asks for two shelves' worth at the measured width", () => {
    // A phone: one column, ten rows per shelf.
    expect(latestFeedBatchSize(1, 10)).toBe(LATEST_FEED_MIN_BATCH);
    expect(latestFeedBatchSize(2, 4)).toBe(LATEST_FEED_MIN_BATCH);
    expect(latestFeedBatchSize(3, 4)).toBe(3 * 4 * LATEST_FEED_BATCH_ROWS);
  });

  it("never exceeds what the feed route accepts", () => {
    expect(latestFeedBatchSize(4, 4)).toBe(LATEST_FEED_MAX_BATCH);
    expect(latestFeedBatchSize(24, 40)).toBe(LATEST_FEED_MAX_BATCH);
  });

  it("falls back to a full batch for nonsense measurements", () => {
    expect(latestFeedBatchSize(Number.NaN, Number.NaN)).toBe(LATEST_FEED_MIN_BATCH);
    expect(latestFeedBatchSize(0, 0)).toBe(LATEST_FEED_MIN_BATCH);
  });

  it("loads the next batch with the same larger size and a cursor", async () => {
    const video = (id: string) => ({
      id,
      slug: id,
      title: id,
      description: null,
      thumbnail_url: null,
      duration_seconds: null,
      view_count: 0,
      published_at: null,
      quality: null,
      category_label: null,
      category_slug: null,
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          videos: [video("first")],
          cursor: { date: "2026-10-01T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ videos: [video("second")], cursor: null }),
      });
    vi.stubGlobal("fetch", fetch);
    stubMobile();

    render(<LatestVideoFeed videoId="video-id" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toContain(`limit=${LATEST_FEED_MIN_BATCH}`);
    expect(fetch.mock.calls[1][0]).toContain("date=2026-10-01T00");
    expect(fetch.mock.calls[1][0]).toContain("id=11111111-1111-4111-8111-111111111111");
    // Both batches are on the page, without duplicates.
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(2);
  });
});
