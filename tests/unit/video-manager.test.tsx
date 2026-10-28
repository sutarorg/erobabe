import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import VideoManager, {
  type AdminVideo,
} from "@/app/admin/(dashboard)/videos/VideoManager";

/**
 * Admin videos page: the library is embedded from damplips, so there is no
 * upload path here. These tests cover curation only — poster edits, carousel
 * placement, publishing and deletion, including the destructive requests.
 */

const VIDEO: AdminVideo = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "evening-in-velvet",
  title: "Evening in Velvet",
  status: "published",
  visibility: "public",
  provider: "damplips",
  thumbnail_url: "https://video.damplips.com/pics/thumb.jpg",
  playable_url: "https://video.damplips.com/videos/1.mp4",
  embed_url: null,
  source_url: "https://www.damplips.com/p/1/",
  view_count: 12,
  created_at: new Date().toISOString(),
  category_label: "Boudoir",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VideoManager", () => {
  it("lists the video with its thumbnail, category, and source", () => {
    render(<VideoManager initialVideos={[VIDEO]} />);
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
    expect(screen.getByText(/Boudoir · damplips/)).toBeTruthy();
    expect(
      document.querySelector(
        'img[src="https://video.damplips.com/pics/thumb.jpg"]',
      ),
    ).toBeTruthy();
  });

  it("links to the source post without leaving an upload control", () => {
    render(<VideoManager initialVideos={[VIDEO]} />);
    expect(screen.getByRole("link", { name: "source" })).toHaveAttribute(
      "href",
      "https://www.damplips.com/p/1/",
    );
    expect(screen.queryByText(/^Upload$/)).toBeNull();
  });

  it("shows the media destination that was imported for the row", () => {
    render(
      <VideoManager
        initialVideos={[
          { ...VIDEO, playable_url: "https://video.damplips.com/video7/717/79.mp4" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "media" })).toHaveAttribute(
      "href",
      "https://video.damplips.com/video7/717/79.mp4",
    );
  });

  it("saves a replacement thumbnail URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ video: { id: VIDEO.id, thumbnail_url: "https://video.damplips.com/new.jpg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Edit thumb"));
    fireEvent.change(screen.getByLabelText(`Thumbnail URL for ${VIDEO.title}`), {
      target: { value: "https://video.damplips.com/new.jpg" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Thumbnail updated.")).toBeTruthy());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      thumbnail_url: "https://video.damplips.com/new.jpg",
    });
  });

  it("removes a thumbnail after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ video: { id: VIDEO.id, thumbnail_url: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Remove thumb"));

    await waitFor(() => expect(screen.getByText("Thumbnail removed.")).toBeTruthy());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      id: VIDEO.id,
      thumbnail_url: null,
    });
  });

  it("unpublishes a published video through PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ video: { id: VIDEO.id, status: "unpublished", visibility: "private" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Unpublish"));

    await waitFor(() => expect(screen.getByText("unpublished")).toBeTruthy());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      id: VIDEO.id,
      action: "unpublish",
    });
  });

  it("deletes the video after confirmation and drops the row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: true, id: VIDEO.id }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.queryByText("Evening in Velvet")).toBeNull());
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/admin/videos?id=${encodeURIComponent(VIDEO.id)}`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("keeps the row when the confirmation is dismissed", () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
  });

  it("surfaces a failed delete instead of pretending it worked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Video not found" }, false, 404)),
    );
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.getByText("Video not found")).toBeTruthy());
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
  });

  it("filters the table by title, slug, or category", () => {
    render(
      <VideoManager
        initialVideos={[VIDEO, { ...VIDEO, id: "other", slug: "solo-night", title: "Solo Night", category_label: "Solo" }]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search videos"), {
      target: { value: "solo" },
    });
    expect(screen.getByText("Solo Night")).toBeTruthy();
    expect(screen.queryByText("Evening in Velvet")).toBeNull();
    expect(screen.getByText("1 of 2 shown")).toBeTruthy();
  });
});

describe("VideoManager — categories, select all, carousel, bulk actions", () => {
  const CATS = [
    { id: "cat-boudoir", label: "Boudoir" },
    { id: "cat-solo", label: "Solo" },
  ];
  const SOLO = {
    ...VIDEO,
    id: "33333333-3333-4333-8333-333333333333",
    slug: "solo-night",
    title: "Solo Night",
    category_id: "cat-solo",
    category_label: "Solo",
  };
  const BOUDOIR = { ...VIDEO, category_id: "cat-boudoir" };

  it("filters the table by category", () => {
    render(<VideoManager initialVideos={[BOUDOIR, SOLO]} categories={CATS} />);
    fireEvent.change(screen.getByLabelText("Filter by category"), {
      target: { value: "cat-solo" },
    });
    expect(screen.getByText("Solo Night")).toBeTruthy();
    expect(screen.queryByText("Evening in Velvet")).toBeNull();
    expect(screen.getByText("1 of 2 shown")).toBeTruthy();
  });

  it("selects every shown video with one checkbox and clears it again", () => {
    render(<VideoManager initialVideos={[BOUDOIR, SOLO]} categories={CATS} />);
    fireEvent.click(screen.getByLabelText("Select all shown videos"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(
      (screen.getByLabelText("Select Solo Night") as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Select all shown videos"));
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("select all respects the active filter", () => {
    render(<VideoManager initialVideos={[BOUDOIR, SOLO]} categories={CATS} />);
    fireEvent.change(screen.getByLabelText("Filter by category"), {
      target: { value: "cat-solo" },
    });
    fireEvent.click(screen.getByLabelText("Select all shown videos"));
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk-deletes the selection after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: [VIDEO.id, SOLO.id], missing: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO, SOLO]} categories={CATS} />);
    fireEvent.click(screen.getByLabelText("Select all shown videos"));
    fireEvent.click(screen.getByText("Delete selected"));

    await waitFor(() => expect(screen.queryByText("Solo Night")).toBeNull());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/videos");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ ids: [VIDEO.id, SOLO.id] });
  });

  it("places a video in a carousel slot through PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ video: { id: VIDEO.id, carousel_position: 2 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} categories={CATS} />);
    fireEvent.change(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
      { target: { value: "2" } },
    );

    await waitFor(() =>
      expect(screen.getByText("Placed in homepage carousel slot 2.")).toBeTruthy(),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      carousel_position: 2,
    });
  });

  it("shows the carousel slot holders from the initial data", () => {
    render(
      <VideoManager initialVideos={[{ ...VIDEO, carousel_position: 1 }]} categories={CATS} />,
    );
    expect(screen.getByText("1 of 3 slots filled.", { exact: false })).toBeTruthy();
    expect(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
    ).toHaveProperty("value", "1");
  });

  it("shows the short AI card copy stored with a carousel slot", () => {
    render(
      <VideoManager
        initialVideos={[
          {
            ...VIDEO,
            carousel_position: 1,
            carousel_title: "Seduced By The Neighbour",
            carousel_description: "She never expected him to knock tonight",
          },
        ]}
        categories={CATS}
      />,
    );
    // Both the slot card and the table row print the copy the homepage shows.
    expect(screen.getAllByText("Seduced By The Neighbour")).toHaveLength(2);
    expect(screen.getAllByText("She never expected him to knock tonight")).toHaveLength(2);
  });

  it("reports the AI carousel copy that came back with the slot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        video: {
          id: VIDEO.id,
          carousel_position: 3,
          carousel_title: "Seduced By The Neighbour",
          carousel_description: "She never expected him to knock tonight",
        },
        carouselCopy: { source: "ai", trimmed: false, stored: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} categories={CATS} />);
    fireEvent.change(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
      { target: { value: "3" } },
    );

    await waitFor(() => expect(screen.getByText(/AI carousel copy generated\./)).toBeTruthy());
    expect(screen.getAllByText("Seduced By The Neighbour")).toHaveLength(2);
  });

  it("warns when the copy had to fall back to the listing text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        video: {
          id: VIDEO.id,
          carousel_position: 1,
          carousel_title: "Evening In Velvet",
          carousel_description: "A hand picked premium scene",
        },
        carouselCopy: {
          source: "fallback",
          stored: true,
          warning: "OpenRouter is not configured",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} categories={CATS} />);
    fireEvent.change(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
      { target: { value: "1" } },
    );

    await waitFor(() =>
      expect(
        screen.getByText("AI carousel copy unavailable: OpenRouter is not configured"),
      ).toBeTruthy(),
    );
  });

  it("regenerates the card copy for a video already in a slot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        video: {
          id: VIDEO.id,
          carousel_position: 2,
          carousel_title: "Fresh Hook",
          carousel_description: "A brand new teaser",
        },
        carouselCopy: { source: "ai", trimmed: true, stored: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <VideoManager
        initialVideos={[
          {
            ...VIDEO,
            carousel_position: 2,
            carousel_title: "Old Hook",
            carousel_description: "Old teaser",
          },
        ]}
        categories={CATS}
      />,
    );
    const [slotButton] = screen.getAllByRole("button", { name: /Regenerate copy/i });
    fireEvent.click(slotButton);

    await waitFor(() =>
      expect(
        screen.getByText("AI carousel copy generated and trimmed to the card limits."),
      ).toBeTruthy(),
    );
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      action: "regenerate_carousel_copy",
    });
    expect(screen.queryByText("Old Hook")).toBeNull();
    expect(screen.getAllByText("Fresh Hook")).toHaveLength(2);
  });
});
