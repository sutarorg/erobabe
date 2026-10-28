import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement } from "react";
import { getRecommendationFeed } from "@/lib/recommendations/service";
import { clearPageMediaCache } from "@/lib/video/page-media";
import { SHELF_VIDEO_LIMIT } from "@/lib/public/shelf";

const DAY = 86_400_000;

const VIDEO_ROW = {
  id: "vid-1",
  slug: "midnight-velvet",
  title: "Midnight Velvet",
  description: "A hand-picked premium scene.",
  thumbnail_url: "https://cdn.example.com/thumb.jpg",
  playable_url: "https://cdn.example.com/media.mp4",
  embed_url: null,
  provider: "damplips",
  provider_file_id: "67284",
  source_name: "damplips",
  source_url: "https://www.damplips.com/p/67284/",
  duration_seconds: 512,
  quality: "4K",
  view_count: 12_480,
  published_at: new Date(Date.now() - 2 * DAY).toISOString(),
  category: { label: "Mature", slug: "mature" },
};

/** Chainable stand-in for the supabase server client used by the watch page. */
function fakeSupabase(row: Record<string, any>) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    not: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: row, error: null }),
    insert: async () => ({ data: null, error: null }),
    // Awaiting the chain directly (the related-videos query) yields a list.
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: Array.from({ length: 20 }, (_, index) => ({ ...row, id: `related-${index}`, slug: `related-${index}` })), error: null }).then(resolve),
  };
  return { from: () => builder };
}

/** The row the fake client returns; individual tests swap it out. */
const rowState = vi.hoisted(() => ({ row: null as null | Record<string, any> }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase(rowState.row as Record<string, any>),
}));

vi.mock("@/lib/public/catalog", () => ({ getPublicCategories: async () => [] }));

/**
 * One feed item per surface. Built by a hoisted helper because `vi.mock` runs
 * above the fixtures in this file.
 */
const feedFactory = vi.hoisted(() => (surface: string) => ({
  videos: [
    {
      id: `${surface}-1`,
      slug: `${surface}-1`,
      title: `${surface} video`,
      description: null,
      thumbnail_url: null,
      duration_seconds: null,
      view_count: 0,
      published_at: null,
      quality: null,
      category_label: null,
      category_slug: null,
    },
  ],
  cursor: null,
  personalized: false,
  correlationId: `${surface}-correlation`,
  algorithmVersion: "erobabe-rec-v1",
}));

vi.mock("@/lib/recommendations/service", () => ({
  latestRecommendations: vi.fn(async () => ({ videos: [], cursor: null })),
  getRecommendationFeed: vi.fn(async ({ surface }: { surface: string }) => feedFactory(surface)),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

const watchPage = await import("@/app/(public)/video/[slug]/page");
const VideoPage = watchPage.default;

async function renderPage() {
  return renderToStaticMarkup(
    await (VideoPage as any)({ params: Promise.resolve({ slug: "midnight-velvet" }) })
  );
}

async function renderSuggestions() {
  const section = await watchPage.WatchSuggestions({
    video: { ...VIDEO_ROW, id: "vid-1", category_id: "category-1" },
  });
  return renderToStaticMarkup(section);
}

/** Titles of the Suspense boundaries a page tree streams in. */
function suspenseFallbackTitles(node: unknown, titles: string[] = []): string[] {
  if (!isValidElement(node)) return titles;
  const element = node as { type?: unknown; props?: Record<string, any> };
  if (element.type === Symbol.for("react.suspense")) {
    const title = element.props?.fallback?.props?.title;
    if (typeof title === "string") titles.push(title);
  }
  Children.forEach(element.props?.children, (child) =>
    suspenseFallbackTitles(child, titles),
  );
  return titles;
}

beforeEach(() => {
  rowState.row = VIDEO_ROW;
  // Post-page → file answers are cached in-process for half an hour.
  clearPageMediaCache();
  vi.mocked(getRecommendationFeed).mockReset();
  vi.mocked(getRecommendationFeed).mockImplementation(
    async ({ surface }: { surface: string }) => feedFactory(surface) as any,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/video/[slug] watch page", () => {
  it("shows a views icon next to the view count", async () => {
    const html = await renderPage();
    expect(html).toContain("lucide-eye");
    expect(html).toContain("12,480 views");
  });

  it("shows the publication age instead of the upload date", async () => {
    const html = await renderPage();
    expect(html).toContain("2 days ago");
    expect(html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    expect(html).not.toContain("published_at");
  });

  it("uses the shared four-row grid for More like this, with no five-column layout", async () => {
    const html = await renderSuggestions();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const grid = doc.querySelector("[data-grid-rows='4']") as HTMLElement;
    expect(html).toContain("More like this");
    expect(grid).toBeTruthy();
    expect(grid.className).not.toContain("grid-cols-5");
    // The no-JS/SSR layout starts at two columns, therefore eight cards.
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(grid.children).toHaveLength(8);
  });

  it("renders recommendation sections in order", async () => {
    const html = await renderSuggestions();
    const headings = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("h2")).map(h => h.textContent);
    expect(headings).toEqual(["More like this", "Discover videos", "Most Liked", "Top Categories"]);
  });

  it("does not render an Up Next section", async () => {
    const html = await renderPage();
    expect(html).not.toContain("Up Next");
    expect(html).not.toContain('aria-label="Up Next"');
  });

  it("shares the homepage five-card mobile category strip without horizontal scrolling", async () => {
    const html = await renderSuggestions();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const grid = doc.querySelector(".category-grid") as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.className).toContain("grid-cols-5");
    expect(grid.className).toContain("sm:grid-cols-8");
    expect(grid.className).not.toMatch(/overflow-x-auto|snap-x/);
    expect(grid.children).toHaveLength(8);

    const cards = Array.from(grid.children) as HTMLElement[];
    const mobileCards = cards.filter((card) => !card.className.includes("hidden"));
    expect(mobileCards.map((card) => card.textContent?.trim())).toEqual([
      "Amateur",
      "Lesbian",
      "MILF",
      "Japanese",
      "More",
    ]);
    expect(mobileCards.at(-1)?.getAttribute("href")).toBe("/categories");
    expect(html).not.toContain("overflow-x-auto");
  });

  it("renders the buffering player before any recommendation shelf", async () => {
    const html = await renderPage();
    const player = html.indexOf("<video");
    expect(player).toBeGreaterThan(-1);
    // Native buffering starts from the server-rendered markup.
    expect(html).toContain('preload="auto"');
    // Each shelf is streamed behind its own skeleton, and all of them come
    // after the player.
    for (const shelf of ["More like this", "Recommended for you", "Most Liked", "Top Categories"]) {
      expect(html).toContain(`aria-label=\"Loading ${shelf}\"`);
      expect(html.indexOf(`Loading ${shelf}`)).toBeGreaterThan(player);
    }
  });

  it("streams every watch-page shelf behind its own Suspense boundary", async () => {
    const element = await (VideoPage as any)({
      params: Promise.resolve({ slug: "midnight-velvet" }),
    });
    expect(suspenseFallbackTitles(element)).toEqual([
      "More like this",
      "Recommended for you",
      "Most Liked",
      "Top Categories",
    ]);
  });

  it("lets one shelf render while another feed is still loading", async () => {
    vi.mocked(getRecommendationFeed).mockImplementation(
      async ({ surface }: { surface: string }) =>
        (surface === "recommended"
          ? new Promise(() => undefined)
          : feedFactory(surface)) as any,
    );

    // The Recommended feed never resolves; Most Liked still renders alone.
    const section = await watchPage.MostLiked({
      video: { ...VIDEO_ROW, id: "vid-1", category_id: "category-1" },
    });
    const html = renderToStaticMarkup(section);
    expect(html).toContain("Most Liked");
    expect(html).not.toContain("Discover videos");
    expect(getRecommendationFeed).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "most_liked", limit: SHELF_VIDEO_LIMIT }),
    );
  });

  it("asks every watch-page feed for a full wide shelf", async () => {
    await renderSuggestions();
    const calls = vi.mocked(getRecommendationFeed).mock.calls.map((call) => call[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "recommended",
          currentVideoId: "vid-1",
          limit: SHELF_VIDEO_LIMIT,
        }),
        expect.objectContaining({
          surface: "most_liked",
          currentVideoId: "vid-1",
          limit: SHELF_VIDEO_LIMIT,
        }),
      ]),
    );
  });

  it("renders Like and Share buttons", async () => {
    const html = await renderPage();
    expect(html).toContain(">Like<");
    expect(html).toContain(">Share<");
  });

  it("gives every related card a view count and a publication age, like the home page", async () => {
    const html = await renderSuggestions();
    const grid = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("[data-grid-rows='4']") as HTMLElement;

    const cards = Array.from(grid.children) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      expect(card.textContent).toMatch(/[\d,]+ views/);
      expect(card.querySelector("time")).toBeTruthy();
      expect(card.querySelector("time")?.textContent).toBe("2 days ago");
      // The same card component the homepage grid uses.
      expect(card.getAttribute("href")).toMatch(/^\/video\//);
      expect(card.querySelector("img")).toBeTruthy();
    }
  });

  it("does not fetch damplips HTML on the watch page to discover a file", async () => {
    // Discovery belongs at import. The watch page streams whatever file URL
    // is already stored — it must not wait on a post-page fetch.
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const html = await renderPage();
    const src = new DOMParser().parseFromString(html, "text/html").querySelector("video")?.getAttribute("src") || "";

    expect(src).toBe(VIDEO_ROW.playable_url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the poster connection before the video is requested", async () => {
    const html = await renderPage();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const hints = Array.from(doc.querySelectorAll("link[rel='preconnect']")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hints).toContain("https://cdn.example.com");
    expect(doc.querySelector("link[rel='preload'][as='image']")).toBeTruthy();
    const videoPreload = doc.querySelector("link[rel='preload'][as='video']");
    expect(videoPreload?.getAttribute("href")).toBe(VIDEO_ROW.playable_url);
  });

  it("does not resolve a post page for an ordinary media file", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const VideoActions = (await import("@/src/components/VideoActions")).default;

describe("watch page actions", () => {
  it("copies even when a native share sheet is available and dismissed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new Error("Dismissed"));
    Object.assign(navigator, { clipboard: { writeText }, share });
    render(<VideoActions title="Preview" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await screen.findByRole("button", { name: /copied/i });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(share).toHaveBeenCalled();
  });
  it("toggles Like and copies the link on Share", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText }, share: undefined });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    render(<VideoActions title="Midnight Velvet" videoId="vid-1" />);

    const like = screen.getByRole("button", { name: /like/i });
    expect(like).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(like);
    expect(await screen.findByRole("button", { name: /liked/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await screen.findByRole("button", { name: /copied/i });
  });
});
