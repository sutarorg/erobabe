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

// The AI request runs in the browser through the OpenRouter client — mocked
// here so no request is ever made and no API credits are spent.
const aiState = vi.hoisted(() => ({
  calls: 0,
  lastParams: null as null | { fileName?: string; category?: string },
  suggest: null as null | ((params: { fileName?: string; category?: string }) => Promise<any>),
}));

vi.mock("@/lib/openrouter/browser-client", () => ({
  suggestVideoMetadata: async (params: { fileName?: string; category?: string }) => {
    aiState.calls += 1;
    aiState.lastParams = params;
    if (!aiState.suggest) throw new Error("suggestVideoMetadata not stubbed");
    return aiState.suggest(params);
  },
  OPENROUTER_MODEL: "deepseek/deepseek-v3.2",
}));

// Import the component after mocks are set up.
import UploadPage from "@/app/admin/videos/upload/page";
import { postJson } from "@/src/utils/api";

const mockPostJson = postJson as unknown as ReturnType<typeof vi.fn>;

function aiSuggestion() {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Mature",
    reasoning: "AI-generated suggestion, requires human review",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  aiState.calls = 0;
  aiState.lastParams = null;
  aiState.suggest = async () => aiSuggestion();
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

  it("does not show upload progress or provider-side conversion polling", () => {
    renderPage();
    // Streaming uploads, relay hops, and provider "converting" polling are gone —
    // the only Streamtape mention left is the player-page link support.
    expect(screen.queryByText(/relay/)).toBeNull();
    expect(screen.queryByText(/converting/)).toBeNull();
    expect(screen.queryByText(/Streamtape upload/i)).toBeNull();
  });
});

describe("admin upload page — link formats and routing", () => {
  it("unwraps a Markdown Streamtape player link and routes it to the embed publisher", async () => {
    mockPostJson.mockResolvedValue({
      results: [
        {
          source: "https://streamtape.com/e/m9XLJGmaJOcbPr2",
          videoId: "vid-1",
          slug: "hands-only-ab12cd34",
          title: "Hands Only",
          status: "published",
          metadataSource: "ai",
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Mature")).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });

    const markdownLink =
      "[https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4](https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4)";

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/https:\/\/video\.example\.com/), { target: { value: markdownLink } });
      fireEvent.click(screen.getByText(/Add link/));
    });

    // The Markdown wrapper is stripped and the watch page is converted to the
    // host's frameable player URL.
    await waitFor(() => {
      expect(screen.getByDisplayValue("https://streamtape.com/e/m9XLJGmaJOcbPr2")).toBeTruthy();
    });
    expect(screen.getByText(/Player page detected on streamtape\.com/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => {
      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/videos/embed",
        expect.objectContaining({
          categoryId: "cat-1",
          entries: [
            {
              source: "https://streamtape.com/e/m9XLJGmaJOcbPr2",
              thumbnailPath: null,
              metadata: expect.objectContaining({
                source: "ai",
                title: "Evening in Velvet",
                tags: ["mature", "boudoir", "4k"],
              }),
            },
          ],
        })
      );
    });
    // Metadata was generated in the browser from the source filename.
    expect(aiState.calls).toBe(1);
    expect(aiState.lastParams).toMatchObject({ fileName: "m9XLJGmaJOcbPr2", category: "Mature" });
  });

  it("still publishes a direct video file through the direct-URL route", async () => {
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
    await waitFor(() => expect(screen.getByText("Mature")).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/https:\/\/video\.example\.com/), {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });

    await waitFor(() => expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy());
    expect(screen.getByText(/Direct video file on cdn\.example\.com/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => {
      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/videos/upload-url",
        expect.objectContaining({
          categoryId: "cat-1",
          entries: [
            {
              url: "https://cdn.example.com/video1.mp4",
              thumbnailPath: null,
              metadata: expect.objectContaining({
                source: "ai",
                title: "Evening in Velvet",
                tags: ["mature", "boudoir", "4k"],
              }),
            },
          ],
        })
      );
    });
    expect(aiState.calls).toBe(1);
    expect(aiState.lastParams).toMatchObject({ fileName: "video1.mp4", category: "Mature" });
  });
});
describe("admin upload page — browser-side AI generation", () => {
  it("shows a loading state while metadata is generated in the browser", async () => {
    let resolveAI: (value: any) => void = () => {};
    aiState.suggest = () => new Promise((resolve) => { resolveAI = resolve; });
    mockPostJson.mockResolvedValue({
      results: [
        {
          url: "https://cdn.example.com/video1.mp4",
          videoId: "vid-1",
          slug: "video-1",
          title: "Evening in Velvet",
          status: "published",
          metadataSource: "ai",
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Mature")).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/https:\/\/video\.example\.com/), {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });
    await waitFor(() => expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => expect(screen.getByText(/Generating AI metadata in the browser/)).toBeTruthy());
    // The publishing request must not go out before the metadata is ready.
    expect(mockPostJson).not.toHaveBeenCalled();

    await act(async () => {
      resolveAI(aiSuggestion());
    });

    await waitFor(() => expect(screen.getByText(/Published/)).toBeTruthy());
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    expect(aiState.calls).toBe(1);
  });

  it("sends deterministic fallback metadata marked for human review when the AI request fails", async () => {
    aiState.suggest = async () => {
      throw new Error("OpenRouter rejected the API key (HTTP 401). Create or rotate a key at https://openrouter.ai/keys.");
    };
    mockPostJson.mockResolvedValue({
      results: [
        {
          url: "https://cdn.example.com/video1.mp4",
          videoId: "vid-1",
          slug: "video-1",
          title: "Video1",
          status: "published",
          metadataSource: "fallback",
          metadataWarning: "AI metadata unavailable — deterministic file-name metadata was used instead.",
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Mature")).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/https:\/\/video\.example\.com/), {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });
    await waitFor(() => expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });

    await waitFor(() => expect(mockPostJson).toHaveBeenCalledTimes(1));
    const [, payload] = mockPostJson.mock.calls[0];
    expect(payload.entries[0].metadata).toMatchObject({
      source: "fallback",
      title: "Video1",
      warning: expect.stringMatching(/AI metadata unavailable/),
    });
    expect(payload.entries[0].metadata.warning).not.toMatch(/sk-or-/);

    // Publishing continues and the result is flagged for review — no AI success claim.
    await waitFor(() => expect(screen.getByText(/file-name metadata used, please review/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/review those titles and descriptions/)).toBeTruthy());
  });

  it("does not issue a second request when the entry is already published", async () => {
    mockPostJson.mockResolvedValue({
      results: [
        { url: "https://cdn.example.com/video1.mp4", videoId: "vid-1", slug: "video-1", title: "T", status: "published", metadataSource: "ai" },
      ],
      succeeded: 1,
      failed: 0,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Mature")).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-1" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/https:\/\/video\.example\.com/), {
        target: { value: "https://cdn.example.com/video1.mp4" },
      });
      fireEvent.click(screen.getByText(/Add link/));
    });
    await waitFor(() => expect(screen.getByDisplayValue("https://cdn.example.com/video1.mp4")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });
    await waitFor(() => expect(screen.getByText(/Published/)).toBeTruthy());

    // Re-submitting skips published entries: no extra AI call, no extra POST.
    await act(async () => {
      fireEvent.click(screen.getByText(/Generate AI metadata & publish/));
    });
    expect(aiState.calls).toBe(1);
    expect(mockPostJson).toHaveBeenCalledTimes(1);
  });
});
