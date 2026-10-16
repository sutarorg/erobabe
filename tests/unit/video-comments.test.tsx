import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VideoComments from "@/src/components/VideoComments";
import { anonymousProfile, saveAnonymousUsername } from "@/src/utils/anonymousProfile";

const AI_NAME = "Mischievous Waffle 1A2B3C4D5E6F";
const POST_AI_NAME = "Baffled Turnip 6F5E4D3C2B1A";
const comment = (id: number) => ({
  id: String(id),
  profile_name: AI_NAME,
  body: `Comment ${id}`,
  created_at: "2026-10-15T00:00:00Z",
});

afterEach(() => vi.unstubAllGlobals());

describe("anonymous comments", () => {
  it("stores the funny AI username locally after the first comment", () => {
    const visitor = anonymousProfile();
    expect(visitor.name).toBeUndefined();
    expect(anonymousProfile()).toEqual(visitor);
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual({ id: visitor.id });

    const named = saveAnonymousUsername(AI_NAME);
    expect(named).toEqual({ id: visitor.id, name: AI_NAME });
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual(named);
  });

  it("starts with two comments and loads five more", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment(1), comment(2)], hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [3, 4, 5, 6, 7].map(comment), hasMore: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Comment 2");
    expect(screen.queryByText("Comment 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View more/ }));
    await screen.findByText("Comment 7");
    expect(fetch.mock.calls[1][0]).toContain("offset=2");
    expect(screen.queryByRole("button", { name: /View more/ })).toBeNull();
  });

  it("posts without a client-chosen name, saves the AI name, and refreshes comments", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [], hasMore: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, name: POST_AI_NAME }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment(1)], hasMore: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Be the first to comment.");
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Comment anonymously as Baffled Turnip 6F5E4D3C2B1A");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      videoId: "video",
      visitorId: anonymousProfile().id,
      body: "Hello there",
    });
    expect(JSON.parse(localStorage.getItem("erobabe-anonymous-profile")!)).toEqual({
      id: anonymousProfile().id,
      name: POST_AI_NAME,
    });
  });

  it("puts the comment composer after the list and hides the list scrollbar", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [comment(1)], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<VideoComments videoId="video" />);

    await screen.findByText("Comment 1");
    const list = screen.getByLabelText("Comment list");
    const composer = screen.getByRole("form", { name: "Post a comment" });
    expect(list.className).toContain("no-scrollbar");
    expect(list.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
