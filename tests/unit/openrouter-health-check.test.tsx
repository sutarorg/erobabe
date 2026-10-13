import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

/**
 * Admin System Health — OpenRouter panel.
 *
 * The probe runs directly in the browser (mocked fetch here — no credits are
 * spent). The panel must surface loading, success, quota/rate-limit,
 * configuration and connection-error states; never display or log the API
 * key; never claim the provider is verified merely because a key is present.
 */

const TEST_KEY = "sk-or-v1-health-check-key-material-abcdef123456";

function successResponse(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

import OpenRouterCheck from "@/app/admin/system-health/OpenRouterCheck";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.NEXT_PUBLIC_OPENROUTER_API_KEY = TEST_KEY;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouterCheck", () => {
  it("identifies the provider and the configured model without claiming it is verified", () => {
    render(<OpenRouterCheck />);

    expect(screen.getByText(/OpenRouter — metadata suggestions/)).toBeTruthy();
    expect(screen.getAllByText("deepseek/deepseek-v3.2").length).toBeGreaterThan(0);
    expect(screen.getByText(/Key present in this build — not yet verified/)).toBeTruthy();
    // Presence of a key is never reported as a verified/operational provider.
    expect(screen.queryByText(/live connectivity confirmed/)).toBeNull();
    expect(screen.queryByText(/answered with/)).toBeNull();
    // No backend health endpoint is consulted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs a direct browser-side connectivity test and reports success", async () => {
    fetchMock.mockResolvedValue(successResponse("ok"));
    render(<OpenRouterCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/OpenRouter answered with deepseek\/deepseek-v3\.2 in \d+ ms/)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TEST_KEY}`,
      "X-Title": "Erobabe",
    });
    // The key never renders in the UI.
    expect(screen.queryByText(new RegExp(TEST_KEY))).toBeNull();
    expect(document.body.textContent).not.toContain(TEST_KEY);
  });

  it("shows the loading state while the test runs", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    render(<OpenRouterCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    expect(screen.getByRole("button", { name: /Test OpenRouter/ })).toBeDisabled();
    expect(document.body.textContent).toContain("Test OpenRouter");

    await act(async () => {
      resolveFetch(successResponse("ok"));
    });
    await waitFor(() => expect(screen.getByText(/answered with/)).toBeTruthy());
  });

  it("reports an invalid key with an actionable hint and no key material", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "Incorrect API key provided"));
    render(<OpenRouterCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/OpenRouter test failed/)).toBeTruthy();
    });
    expect(screen.getAllByText(/NEXT_PUBLIC_OPENROUTER_API_KEY|openrouter\.ai\/keys/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(TEST_KEY);
  });

  it("reports quota and rate-limit failures distinctly", async () => {
    fetchMock.mockResolvedValue(errorResponse(429, "Rate limit exceeded"));
    render(<OpenRouterCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/rate limit or credit quota exhausted/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/add credits|rate-limit window/i).length).toBeGreaterThan(0);
  });

  it("reports connection failures distinctly", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OpenRouterCheck />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Could not reach OpenRouter/).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/connectivity|CORS/i).length).toBeGreaterThan(0);
  });

  it("shows the configuration state when the key is missing and still allows the test", async () => {
    delete process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    fetchMock.mockResolvedValue(errorResponse(401, "no key"));
    render(<OpenRouterCheck />);

    expect(screen.getByText(/No key in this build/)).toBeTruthy();
    expect(screen.getByText(/NEXT_PUBLIC_OPENROUTER_API_KEY/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Test OpenRouter/ }));
    });

    // The probe reports the configuration problem honestly without a request.
    await waitFor(() => {
      expect(screen.getByText(/NEXT_PUBLIC_OPENROUTER_API_KEY is not set in this build/)).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/answered with/)).toBeNull();
  });
});
