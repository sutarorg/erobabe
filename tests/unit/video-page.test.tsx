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
  playable_url: null as string | null,
  embed_url: null as string | null,
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

describe("/video/[slug] player", () => {
  const original = { embed_url: VIDEO_ROW.embed_url, playable_url: VIDEO_ROW.playable_url };
  afterEach(() => {
    VIDEO_ROW.embed_url = original.embed_url;
    VIDEO_ROW.playable_url = original.playable_url;
  });

  it("plays a UFOLOAD video in an iframe pointing at its stable embed URL", async () => {
    VIDEO_ROW.embed_url = "https://ufoload.com/e/abcDEF12345";
    const html = await renderPage();

    const iframe = html.match(/<iframe[^>]*>/)?.[0] ?? "";
    expect(iframe).toContain('src="https://ufoload.com/e/abcDEF12345"');
    expect(iframe).toContain('title="Midnight Velvet"');
    expect(iframe).toContain('loading="lazy"');
    expect(iframe).toMatch(/allowfullscreen/i);
    expect(iframe).toContain("autoplay");
    // The embed is what plays: no <video> element, no processing overlay.
    expect(html).not.toContain("<video");
    expect(html).not.toContain("Video processing");
    expect(html).not.toMatch(/uqload/i);
    // Structured data points at the same stable URL.
    expect(html).toContain('"embedUrl":"https://ufoload.com/e/abcDEF12345"');
  });

  it("never carries an expiring signed URL: the iframe is the only player source", async () => {
    VIDEO_ROW.embed_url = "https://ufoload.com/e/abcDEF12345";
    VIDEO_ROW.playable_url = null;
    const html = await renderPage();
    expect(html).not.toMatch(/sig=|master\.m3u8|\.mp4/);
  });

  it("keeps playing a historical Uqload video from its stored embed URL", async () => {
    VIDEO_ROW.embed_url = "https://uqload.vc/embed-u9150wqzvhxj.html";
    const html = await renderPage();
    expect(html).toContain('src="https://uqload.vc/embed-u9150wqzvhxj.html"');
    expect(html).not.toContain("Video processing");
  });

  it("falls back to the processing overlay only when there is nothing to play", async () => {
    VIDEO_ROW.embed_url = null;
    VIDEO_ROW.playable_url = null;
    const html = await renderPage();
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Video processing");
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
