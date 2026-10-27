import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const DAY = 86_400_000;

const VIDEO_ROW = {
  id: "vid-1",
  slug: "midnight-velvet",
  title: "Midnight Velvet",
  description: "A hand-picked premium scene.",
  thumbnail_url: "https://cdn.example.com/thumb.jpg",
  playable_url: null,
  embed_url: null,
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase(VIDEO_ROW),
}));

vi.mock("@/lib/public/catalog", () => ({ getPublicCategories: async () => [] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

const VideoPage = (await import("@/app/(public)/video/[slug]/page")).default;

async function renderPage() {
  return renderToStaticMarkup(
    await (VideoPage as any)({ params: Promise.resolve({ slug: "midnight-velvet" }) })
  );
}

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
    const html = await renderPage();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const grid = doc.querySelector("[data-grid-rows='4']") as HTMLElement;
    expect(html).toContain("More like this");
    expect(grid).toBeTruthy();
    expect(grid.className).not.toContain("grid-cols-5");
    // The no-JS/SSR layout starts at two columns, therefore eight cards.
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(grid.children).toHaveLength(8);
  });

  it("renders the requested sections in order", async () => {
    const html = await renderPage();
    const headings = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("h2")).map(h => h.textContent);
    // Recommendations are on by default; the old opt-in controls are gone.
    expect(headings).toEqual(["Comments", "More like this", "Discover videos", "Most Liked", "Top Categories", "Latest"]);
  });

  it("does not render an Up Next section", async () => {
    const html = await renderPage();
    expect(html).not.toContain("Up Next");
    expect(html).not.toContain('aria-label="Up Next"');
  });

  it("shares the homepage five-card mobile category strip without horizontal scrolling", async () => {
    const html = await renderPage();
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

  it("renders Like and Share buttons", async () => {
    const html = await renderPage();
    expect(html).toContain(">Like<");
    expect(html).toContain(">Share<");
  });

  it("gives every related card a view count and a publication age, like the home page", async () => {
    const html = await renderPage();
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
