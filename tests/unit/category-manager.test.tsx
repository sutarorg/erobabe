import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

/**
 * Admin category manager: the card thumbnail control.
 *
 * The image goes straight to Supabase Storage with a signed URL, and the save
 * call carries the public URL (or null when the thumbnail is removed).
 */

vi.mock("@/src/utils/api", () => ({ postJson: vi.fn(), getJson: vi.fn() }));
vi.mock("@/src/utils/uploadFile", () => ({ uploadWithProgress: vi.fn().mockResolvedValue(undefined) }));

import CategoryManager from "@/app/admin/(dashboard)/categories/CategoryManager";
import { postJson } from "@/src/utils/api";
import { uploadWithProgress } from "@/src/utils/uploadFile";

const mockPostJson = postJson as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadWithProgress as unknown as ReturnType<typeof vi.fn>;

const CATEGORY = {
  id: "cat-1",
  label: "Boudoir",
  slug: "boudoir",
  icon: "sparkles",
  description: "Soft light.",
  image_url: null as string | null,
  video_count: 3,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function imageFile() {
  return new File(["bytes"], "card.png", { type: "image/png" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPostJson.mockResolvedValue({
    uploadUrl: "https://storage.example/signed",
    storagePath: "admin-1/card.png",
    publicUrl: "https://storage.example/public/video-thumbnails/admin-1/card.png",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CategoryManager — thumbnails", () => {
  it("shows the stored thumbnail on the category card", () => {
    render(<CategoryManager initialCategories={[{ ...CATEGORY, image_url: "https://cdn.example.com/thumb.png" }]} />);
    const image = document.querySelector('img[src="https://cdn.example.com/thumb.png"]');
    expect(image).toBeTruthy();
    expect(screen.getByText("Thumbnail: set")).toBeTruthy();
  });

  it("uploads a chosen image and saves its public URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ category: { ...CATEGORY, image_url: "https://storage.example/public/video-thumbnails/admin-1/card.png" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager initialCategories={[CATEGORY]} />);
    fireEvent.click(screen.getByText("Edit"));

    const input = document.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [imageFile()] } });
    });

    await waitFor(() => {
      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/videos/storage-token",
        expect.objectContaining({ kind: "thumbnail", fileName: "card.png", mimeType: "image/png" })
      );
    });
    expect(mockUpload).toHaveBeenCalledWith("https://storage.example/signed", expect.any(File), {
      contentType: "image/png",
    });
    await waitFor(() => {
      expect(document.querySelector('img[src="https://storage.example/public/video-thumbnails/admin-1/card.png"]')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save changes"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      id: "cat-1",
      image_url: "https://storage.example/public/video-thumbnails/admin-1/card.png",
    });
  });

  it("sends null when the thumbnail is removed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ category: { ...CATEGORY, image_url: null } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager initialCategories={[{ ...CATEGORY, image_url: "https://cdn.example.com/thumb.png" }]} />);
    fireEvent.click(screen.getByText("Edit"));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove category thumbnail"));
    });
    // The form preview is gone (the list card keeps the saved image until save).
    expect(screen.getByText("Upload image")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Save changes"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({ id: "cat-1", image_url: null });
  });

  it("rejects a file that is not an image", async () => {
    render(<CategoryManager initialCategories={[CATEGORY]} />);
    fireEvent.click(screen.getByText("Edit"));

    const input = document.querySelector('input[type="file"][accept*="image/png"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "clip.mp4", { type: "video/mp4" })] } });
    });

    expect(screen.getByText(/must be JPG, PNG, GIF, or WebP/)).toBeTruthy();
    expect(mockPostJson).not.toHaveBeenCalled();
  });
});
