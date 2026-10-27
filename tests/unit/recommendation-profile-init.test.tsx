import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import RecommendationProfileInit from "@/src/components/RecommendationProfileInit";

/**
 * Personalization is on by default and there is no control to turn it on, so
 * the public layout asks the server for the opaque profile cookie once per
 * session — from the browser, which keeps the public document cacheable.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("default-on recommendation profile", () => {
  it("requests a profile from the server on the first page of a session", async () => {
    render(<RecommendationProfileInit />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/recommendations/preferences");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("does not ask again for the rest of the session", async () => {
    render(<RecommendationProfileInit />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    render(<RecommendationProfileInit />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
