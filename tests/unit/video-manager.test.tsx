import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

/**
 * Admin videos page: delete a video, and change or remove its thumbnail.
 * Fetch and the storage upload are stubbed, so the tests assert the requests
 * that reach the API — including the destructive ones.
 */

vi.mock("@/src/utils/api", () => ({ postJson: vi.fn(), getJson: vi.fn() }));
vi.mock("@/src/utils/uploadFile", () => ({ uploadWithProgress: vi.fn().mockResolvedValue(undefined) }));

import VideoManager, { type AdminVideo } from "@/app/admin/videos/VideoManager";
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
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPostJson.mockResolvedValue({
    uploadUrl: "https://storage.example/signed",
    storagePath: "admin-1/new.png",
    publicUrl: "https://storage.example/public/video-thumbnails/admin-1/new.png",
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
    expect(document.querySelector('img[src="https://cdn.example.com/video-thumbnails/admin-1/thumb.jpg"]')).toBeTruthy();
  });

  it("uploads a replacement thumbnail and saves its public URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ video: { id: VIDEO.id, thumbnail_url: "https://storage.example/public/video-thumbnails/admin-1/new.png" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    const input = document.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "new.png", { type: "image/png" })] } });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      id: VIDEO.id,
      thumbnail_url: "https://storage.example/public/video-thumbnails/admin-1/new.png",
    });
    await waitFor(() => expect(screen.getByText("Thumbnail updated.")).toBeTruthy());
  });

  it("removes a thumbnail after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ video: { id: VIDEO.id, thumbnail_url: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Remove thumb"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(confirmMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ id: VIDEO.id, thumbnail_url: null });
    await waitFor(() => expect(screen.getByText("Thumbnail removed.")).toBeTruthy());
  });

  it("deletes the video after confirmation and drops the row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: true, id: VIDEO.id }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.queryByText("Evening in Velvet")).toBeNull());
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Video not found" }, false, 404));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<VideoManager initialVideos={[VIDEO]} />);
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.getByText("Video not found")).toBeTruthy());
    expect(screen.getByText("Evening in Velvet")).toBeTruthy();
  });

  it("filters the table by title, slug, or category", () => {
    render(<VideoManager initialVideos={[VIDEO, { ...VIDEO, id: "other", slug: "solo-night", title: "Solo Night", category_label: "Solo" }]} />);
    fireEvent.change(screen.getByLabelText("Search videos"), { target: { value: "solo" } });
    expect(screen.getByText("Solo Night")).toBeTruthy();
    expect(screen.queryByText("Evening in Velvet")).toBeNull();
    expect(screen.getByText("1 of 2 shown")).toBeTruthy();
  });
});
