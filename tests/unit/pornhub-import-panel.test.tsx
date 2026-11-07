import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PornhubImportPanel from "@/app/admin/(dashboard)/videos/PornhubImportPanel";
import type { CategoryCount } from "@/lib/catalog/counts";

/**
 * The panel is the operator's whole interface to the import. What matters:
 *
 *  - it offers the categories, with their real published counts;
 *  - one press starts a run that keeps going until the server says the search
 *    is exhausted — there is no number to type and no ceiling to bump into;
 *  - Stop ends the run without losing what was already imported.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const COUNTS: CategoryCount[] = [
  { id: "cat-amateur", slug: "amateur", label: "Amateur", published: 42, total: 45 },
  { id: "cat-pov", slug: "pov", label: "POV", published: 0, total: 0 },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    report: {
      category: "amateur",
      imported: 10,
      duplicates: 5,
      pagesRead: 4,
      cursor: { source: 0, page: 5 },
      exhausted: false,
      errors: [],
      skipped: { notHd: 0, unknownQuality: 0, short: 0, noThumbnail: 0, failed: 0 },
      ...overrides,
    },
  };
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PornhubImportPanel", () => {
  it("lists every category with its published count and no quota field", () => {
    render(<PornhubImportPanel counts={COUNTS} />);
    expect(screen.getByText("Amateur")).toBeTruthy();
    expect(screen.getByText("POV")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    // The old panel asked "new videos per category"; an unlimited import has no
    // such thing to ask for.
    expect(screen.queryByLabelText(/videos per category/i)).toBeNull();
    expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy();
  });

  it("keeps requesting slices until the search is exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 10 })))
      .mockResolvedValueOnce(jsonResponse(report({ imported: 4, cursor: { source: 0, page: 9 } })))
      .mockResolvedValueOnce(
        jsonResponse(report({ imported: 1, exhausted: true, cursor: { source: 2, page: 1 } })),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PornhubImportPanel counts={[COUNTS[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() =>
      expect(screen.getByText(/search exhausted/i)).toBeTruthy(),
    );
    // One initial request per category, then three slices for it.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    // The cursor of each call is the one the previous call returned.
    expect(bodies[0].cursor).toEqual({ source: 0, page: 1 });
    expect(bodies[1].cursor).toEqual({ source: 0, page: 5 });
    expect(bodies[2].cursor).toEqual({ source: 0, page: 9 });
    // Nothing in the payload asks for a capped number of videos.
    expect(bodies[0]).not.toHaveProperty("perCategory");
    expect(bodies[0]).not.toHaveProperty("limit");

    // The running total is printed once in the summary and once per category.
    await waitFor(() => expect(screen.getAllByText(/\+15 new/).length).toBeGreaterThan(0));
    expect(refresh).toHaveBeenCalled();
  });

  it("stops when the operator presses Stop", async () => {
    let released: (value: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => {
          released = resolve;
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PornhubImportPanel counts={[COUNTS[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const stop = await screen.findByRole("button", { name: /stop/i });
    // Wait until the second slice is actually in flight, then stop it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(stop);
    released(jsonResponse(report({ exhausted: true })));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy(),
    );
    // Stop ends the loop; it never issues another request after the in-flight one.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a server error and stops the run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error:
              "Pornhub refused the request from this server (HTTP 403). The import needs an egress address Pornhub serves to browsers.",
          },
          false,
          503,
        ),
      ),
    );

    render(<PornhubImportPanel counts={[COUNTS[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("HTTP 403");
    expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy();
  });

  it("stages imports as drafts when the operator asks for review", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report({ exhausted: true })));
    vi.stubGlobal("fetch", fetchMock);

    render(<PornhubImportPanel counts={[COUNTS[0]]} />);
    fireEvent.click(screen.getByLabelText(/stage as private drafts/i));
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rightsStatus).toBe("pending");
  });

  it("explains what to apply when the counts could not be read", () => {
    render(<PornhubImportPanel counts={[]} />);
    expect(screen.getByText(/00000000000029_pornhub_embeds\.sql/)).toBeTruthy();
  });
});
