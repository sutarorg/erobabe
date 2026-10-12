import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

/**
 * Admin upload page tests.
 *
 * The page now supports only one publishing method: "Upload by link" —
 * the admin pastes direct MP4 URLs. File uploads and iframe embeds are
 * not available.
 */

// Mock supabase client
const mockCategories = [
  { id: "cat-1", label: "Mature" },
  { id: "cat-2", label: "Amateur" },
];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: mockCategories, error: null }),
      }),
    }),
  }),
}));

vi.mock("@/src/utils/api", () => ({
  postJson: vi.fn(),
  getJson: vi.fn(),
}));

vi.mock("@/src/utils/uploadFile", () => ({
  uploadWithProgress: vi.fn().mockResolvedValue(undefined),
}));

// Import the component after mocks are set up.
import UploadPage from "@/app/admin/videos/upload/page";
import { postJson } from "@/src/utils/api";

const mockPostJson = postJson as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(<UploadPage />);
}

describe("admin upload page — mode", () => {
  it("renders only the 'Upload by link' publishing method", async () => {
    renderPage();
    expect(screen.getByText("Publish videos by link")).toBeTruthy();
    expect(screen.queryByText("Upload videos")).toBeNull();
    expect(screen.queryByText("Embed by iframe")).toBeNull();
  });

  it("does not show mode-selection cards", async () => {
    renderPage();
    // The old three-card selector should be gone.
    expect(screen.queryByText("Upload videos")).toBeNull();
    expect(screen.queryByText("Embed by iframe")).toBeNull();
    // Only the URL link mode description should appear.
    expect(screen.getByText(/How it works/)).toBeTruthy();
  });

  it("shows a URL text area", () => {
    renderPage();
    expect(screen.getByPlaceholderText(/https:\/\/video\.example\.com/)).toBeTruthy();
  });

  it("shows the category selector", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Mature")).toBeTruthy();
    });
  });
});

describe("admin upload page — URL input", () => {
  it("validates URLs client-side and shows invalid entries", async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "https://example.com/page" } });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByText(/invalid/)).toBeTruthy();
    });
  });

  it("adds valid URLs to the queue", async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy();
    });
  });

  it("allows removing items from the queue", async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove entry 1"));
    });

    await waitFor(() => {
      expect(screen.queryByDisplayValue("https://cdn.example.com/video1.mp4")).toBeNull();
    });
  });

  it("deduplicates entries pasted in the same batch", async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    // splitUrlEntries deduplicates at the parsing level, so identical URLs
    // pasted on separate lines yield only one entry.
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: "https://cdn.example.com/video1.mp4\nhttps://cdn.example.com/video1.mp4",
        },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    // Only one entry should be added (deduplicated by the entries module).
    await waitFor(() => {
      const inputs = screen.getAllByDisplayValue("https://cdn.example.com/video1.mp4");
      expect(inputs).toHaveLength(1);
    });
  });
});

describe("admin upload page — publishing", () => {
  it("requires a category before publishing", async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy();
    });

    // Click publish without selecting a category.
    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => {
      expect(screen.getByText(/Choose a category/)).toBeTruthy();
    });
  });

  it("shows success state after publishing", async () => {
    mockPostJson.mockResolvedValue({
      results: [
        {
          url: "https://cdn.example.com/video1.mp4",
          videoId: "vid-1",
          slug: "video-1",
          title: "Test Video",
          status: "published",
          metadataSource: "ai",
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Mature")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });

    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => {
      expect(screen.getByText(/Published/)).toBeTruthy();
      expect(screen.getByText(/View/)).toBeTruthy();
    });
  });

  it("shows error state when publishing fails", async () => {
    mockPostJson.mockResolvedValue({
      results: [
        {
          url: "https://cdn.example.com/video1.mp4",
          status: "failed",
          error: "Invalid category",
        },
      ],
      succeeded: 0,
      failed: 1,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Mature")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });

    const textarea = screen.getByPlaceholderText(/https:\/\/video\.example\.com/);

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    // The component renders the per-item error message and a batch summary.
    await waitFor(() => {
      expect(screen.getByText(/could not be published/)).toBeTruthy();
    });
  });
});

describe("admin upload page — no file upload or embed", () => {
  it("does not render file input for video files", () => {
    renderPage();
    // There should be no file input accepting video/*.
    const videoInputs = document.querySelectorAll('input[accept="video/*"]');
    expect(videoInputs).toHaveLength(0);
  });

  it("does not have embed/iframe-related UI", () => {
    renderPage();
    expect(screen.queryByText("Embed by iframe")).toBeNull();
    expect(screen.queryByText("iframe URL or embed code")).toBeNull();
  });

  it("does not show upload progress or Streamtape polling", () => {
    renderPage();
    expect(screen.queryByText(/Streamtape/)).toBeNull();
    expect(screen.queryByText(/relay/)).toBeNull();
    expect(screen.queryByText(/converting/)).toBeNull();
  });
});