import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VideoComments from "@/src/components/VideoComments";
import { anonymousProfile, saveAnonymousUsername } from "@/src/utils/anonymousProfile";

const LOCAL_NAME = "Mischievous Waffle";
const POST_LOCAL_NAME = "Baffled Turnip";
const comment = (id: number, body = `Comment ${id}`, created_at = new Date(Date.now() - 5 * 3600 * 1000).toISOString()) => ({
  id: String(id),
  profile_name: LOCAL_NAME,
  body,
  created_at,
});

afterEach(() => vi.unstubAllGlobals());

describe("anonymous comments", () => {
  it("stores the two-word funny username locally after the first comment", () => {
    const visitor = anonymousProfile();
    expect(visitor.name).toBeUndefined();
    expect(anonymousProfile()).toEqual(visitor);
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual({ id: visitor.id });

    const named = saveAnonymousUsername(LOCAL_NAME);
    expect(named).toEqual({ id: visitor.id, name: LOCAL_NAME });
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual(named);
  });

  it("starts with two comments and loads five more", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment(1), comment(2)], hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [3, 4, 5, 6, 7].map((i) => comment(i)), hasMore: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Comment 2");
    expect(screen.queryByText("Comment 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.queryByRole("button", { name: "View more" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading comments");
    await screen.findByText("Comment 7");
    expect(fetch.mock.calls[1][0]).toContain("offset=2");
    expect(screen.queryByRole("button", { name: /View more/ })).toBeNull();
  });

  it("posts without a client-chosen name, saves the two-word name, and refreshes comments", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [], hasMore: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, name: POST_LOCAL_NAME, id: "new-comment-1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment(1)], hasMore: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Be the first to comment.");
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByText("Comment anonymously as Baffled Turnip");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      videoId: "video",
      visitorId: anonymousProfile().id,
      body: "Hello there",
    });
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual({
      id: anonymousProfile().id,
      name: POST_LOCAL_NAME,
    });
  });

  it("formats comment time as relative age like '5 hours ago'", async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [comment(1, "Great clip", fiveHoursAgo)], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Great clip");
    expect(screen.getByText("5 hours ago")).toBeTruthy();
    // Must not show raw date format like 16/10/2026
    expect(screen.queryByText(/\d{1,2}\/\d{1,2}\/\d{4}/)).toBeNull();
  });

  it("enforces 100 characters max limit on input and shows character counter", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    const input = (await screen.findByLabelText("Your comment")) as HTMLTextAreaElement;
    expect(input.maxLength).toBe(100);
    expect(screen.getByText("0/100")).toBeTruthy();

    fireEvent.change(input, { target: { value: "Short comment" } });
    expect(screen.getByText("13/100")).toBeTruthy();
  });

  it("filters out comments containing links with an error message", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    const input = await screen.findByLabelText("Your comment");
    fireEvent.change(input, { target: { value: "Check out https://mysite.com for free stuff" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await screen.findByText("Links are not allowed in comments.");
    // No POST request made when link is detected
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows Read more option with reduced opacity for comments longer than 3 lines", async () => {
    const multiLineComment = comment(
      1,
      "Line 1 of comment\nLine 2 of comment\nLine 3 of comment\nLine 4 of comment is long"
    );
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [multiLineComment], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText(/Line 1 of comment/);
    const readMoreBtn = screen.getByRole("button", { name: "Read more" });
    expect(readMoreBtn).toBeTruthy();
    // Must have reduced opacity styling
    expect(readMoreBtn.className).toMatch(/opacity-60|opacity-70/);

    fireEvent.click(readMoreBtn);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("allows user to delete their own comment", async () => {
    saveAnonymousUsername(LOCAL_NAME);
    const myComment = comment(1, "I made this comment");
    const otherComment = {
      id: "2",
      profile_name: "Someone Else",
      body: "Another user comment",
      created_at: new Date().toISOString(),
    };

    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [myComment, otherComment], hasMore: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("I made this comment");
    // Delete button visible on user's own comment
    const deleteBtn = screen.getByRole("button", { name: "Delete your comment" });
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.textContent).toBe("");
    expect(deleteBtn.querySelector("svg")).not.toBeNull();

    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(screen.queryByText("I made this comment")).toBeNull();
    });
    expect(screen.getByText("Another user comment")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/community",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("displays a scrollable comment list with its scrollbar hidden", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [comment(1)], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Comment 1");
    const list = screen.getByLabelText("Comment list");
    const composer = screen.getByRole("form", { name: "Post a comment" });

    // Comments flow with the page instead of a nested scroll area.
    expect(list.className).toContain("no-scrollbar");
    expect(list.className).not.toMatch(/overflow-y|max-h-/);

    const input = screen.getByRole("textbox", { name: "Your comment" });
    expect(input).toHaveAttribute("placeholder", "Add a comment...");
    expect(input.className).toContain("overflow-y-auto");
    expect(input.className).toContain("max-h-32");
    expect(input.className).toContain("no-scrollbar");
    expect(input.className).toContain("resize-none");
    const submit = screen.getByRole("button", { name: "Post comment" });
    expect(submit.textContent).toBe("");
    expect(submit.querySelector("svg")).not.toBeNull();
    expect(list.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
