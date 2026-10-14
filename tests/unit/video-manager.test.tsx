import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";

/**
 * Admin videos page: delete a video, and change or remove its thumbnail.
 * Fetch and the storage upload are stubbed, so the tests assert the requests
 * that reach the API — including the destructive ones.
 */

vi.mock("@/src/utils/api", () => ({ postJson: vi.fn(), getJson: vi.fn() }));
vi.mock("@/src/utils/uploadFile", () => ({
  uploadWithProgress: vi.fn().mockResolvedValue(undefined),
}));

import VideoManager, {
  type AdminVideo,
} from "@/app/admin/(dashboard)/videos/VideoManager";
import { postJson } from "@/src/utils/api";

const mockPostJson = postJson as unknown as ReturnType<typeof vi.fn>;

const VIDEO: AdminVideo = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "evening-in-velvet",
  title: "Evening in Velvet",
  status: "published",
  visibility: "public",
  provider: "direct_url",
  thumbnail_url: "https://cdn.example.com/video-thumbnails/admin-1/thumb.jpg",
  playable_url: "https://cdn.example.com/clip.mp4",
  embed_url: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockPostJson.mockResolvedValue({
    uploadUrl: "https://storage.example/signed",
    storagePath: "admin-1/new.png",
    publicUrl:
      "https://storage.example/public/video-thumbnails/admin-1/new.png",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VideoManager", () => {
  it("lists the video with its thumbnail, category, and provider", () => {
    render(<VideoManager initialVideos={[VIDEO]} />);
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
    expect(screen.getByText(/Boudoir ·/)).toBeTruthy();
    expect(screen.getByText(/Direct link/)).toBeTruthy();
    expect(
      document.querySelector(
        'img[src="https://cdn.example.com/video-thumbnails/admin-1/thumb.jpg"]',
      ),
    ).toBeTruthy();
  });

  it("shows Bunny uploads as Encoding and checks status outside the upload worker", async () => {
    const encoding: AdminVideo = {
      ...VIDEO,
      id: "33333333-3333-4333-8333-333333333333",
      slug: "clip-33333333",
      title: "Encoding clip",
      status: "processing",
      provider: "bunny",
      provider_progress: 24,
      playable_url: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { processing: true, progress: 30, providerStatus: "Transcoding" },
          true,
          202,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[encoding]} />);

    expect(screen.getByText("Encoding", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Available after encoding")).toBeTruthy();
    expect(screen.getByLabelText(`Select ${encoding.title}`)).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/videos/bunny/confirm");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      sessionId: encoding.id,
    });
  });

  it("changes an Encoding row to pending review after Bunny reports Finished", async () => {
    const encoding: AdminVideo = {
      ...VIDEO,
      id: "44444444-4444-4444-8444-444444444444",
      slug: "clip-44444444",
      title: "Just finished",
      status: "processing",
      provider: "bunny",
      playable_url: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ slug: "just-finished", videoId: encoding.id }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[encoding]} />);

    await waitFor(() =>
      expect(
        screen.getByText("pending_review", { selector: "span" }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/video/just-finished",
    );
  });

  it("uploads a replacement thumbnail and saves its public URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        video: {
          id: VIDEO.id,
          thumbnail_url:
            "https://storage.example/public/video-thumbnails/admin-1/new.png",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    const input = document.querySelector(
      'input[type="file"][accept*="image/png"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["x"], "new.png", { type: "image/png" })] },
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      thumbnail_url:
        "https://storage.example/public/video-thumbnails/admin-1/new.png",
    });
    await waitFor(() =>
      expect(screen.getByText("Thumbnail updated.")).toBeTruthy(),
    );
  });

  it("removes a thumbnail after confirmation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ video: { id: VIDEO.id, thumbnail_url: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Remove thumb"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(confirmMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      thumbnail_url: null,
    });
    await waitFor(() =>
      expect(screen.getByText("Thumbnail removed.")).toBeTruthy(),
    );
  });

  it("deletes the video after confirmation and drops the row", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ deleted: true, id: VIDEO.id }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() =>
      expect(screen.queryByText("Evening in Velvet")).toBeNull(),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ id: VIDEO.id });
  });

  it("keeps the row when the confirmation is dismissed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
  });

  it("surfaces a failed delete instead of pretending it worked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "Video not found" }, false, 404),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() =>
      expect(screen.getByText("Video not found")).toBeTruthy(),
    );
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
  });

  it("filters the table by title, slug, or category", () => {
    render(
      <VideoManager
        initialVideos={[
          VIDEO,
          {
            ...VIDEO,
            id: "other",
            slug: "solo-night",
            title: "Solo Night",
            category_label: "Solo",
          },
        ]}
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ video: { id: VIDEO.id, carousel_position: 2 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} categories={CATS} />);
    fireEvent.change(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
      { target: { value: "2" } },
    );

    await waitFor(() =>
      expect(
        screen.getByText("Placed in homepage carousel slot 2."),
      ).toBeTruthy(),
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
      <VideoManager
        initialVideos={[{ ...VIDEO, carousel_position: 1 }]}
        categories={CATS}
      />,
    );
    expect(
      screen.getByText("1 of 3 slots filled.", { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(`Homepage carousel slot for ${VIDEO.title}`),
    ).toHaveProperty("value", "1");
  });

  it("generates a frame thumbnail for a selected direct-link video without one", async () => {
    const bare = {
      ...VIDEO,
      id: "44444444-4444-4444-8444-444444444444",
      thumbnail_url: null,
      title: "Bare Clip",
    };
    mockPostJson.mockResolvedValue({
      results: [
        {
          id: bare.id,
          status: "generated",
          thumbnailUrl: "https://cdn.example.com/video-thumbnails/auto.jpg",
        },
      ],
      generated: 1,
    });
    render(<VideoManager initialVideos={[bare]} categories={CATS} />);
    fireEvent.click(screen.getByText("Generate thumb"));
    await waitFor(() =>
      expect(
        screen.getByText("Thumbnail generated from a video frame."),
      ).toBeTruthy(),
    );
    expect(mockPostJson).toHaveBeenCalledWith("/api/admin/videos/thumbnails", {
      ids: [bare.id],
    });
  });
});
