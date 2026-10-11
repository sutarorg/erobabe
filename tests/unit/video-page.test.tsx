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
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: row, error: null }),
    insert: async () => ({ data: null, error: null }),
    // Awaiting the chain directly (the related-videos query) yields a list.
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [row], error: null }).then(resolve),
  };
  return { from: () => builder };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase(VIDEO_ROW),
}));

vi.mock("next/navigation", () => ({
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

  it("renders Like and Share buttons", async () => {
    const html = await renderPage();
    expect(html).toContain(">Like<");
    expect(html).toContain(">Share<");
  });
});

const VideoActions = (await import("@/src/components/VideoActions")).default;

describe("watch page actions", () => {
  it("toggles Like and copies the link on Share", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText }, share: undefined });

    render(<VideoActions title="Midnight Velvet" />);

    const like = screen.getByRole("button", { name: /like/i });
    expect(like).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(like);
    expect(screen.getByRole("button", { name: /liked/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await screen.findByRole("button", { name: /copied/i });
  });
});
