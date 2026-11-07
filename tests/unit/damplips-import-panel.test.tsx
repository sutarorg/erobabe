import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DamplipsImportPanel from "@/app/admin/(dashboard)/videos/DamplipsImportPanel";
import type { CategoryCount } from "@/lib/catalog/counts";

/**
 * The panel is the operator's whole interface to the import. What matters:
 *
 *  - it offers the categories, with their real published counts;
 *  - one press starts a run that only the Stop button ends: when a category has
 *    walked every listing, another pass begins instead of the run finishing;
 *  - Stop ends the run without losing what was already imported.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const COUNTS: CategoryCount[] = [
  { id: "cat-amateur", slug: "amateur", label: "Amateur", published: 42, total: 45 },
  { id: "cat-pov", slug: "pov", label: "POV", published: 0, total: 0 },
];

/** Short pauses so a "never stops" loop stays a fast test. */
const FAST = { slicePauseMs: 1, roundPauseMs: 1, maxRoundPauseMs: 4 };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    report: {
      category: "amateur",
      imported: 10,
      duplicates: 5,
      repaired: 0,
      pagesRead: 2,
      postsRead: 8,
      cursor: { source: 0, page: 2, skip: 0, url: "https://www.damplips.com/most-popular/page/2/" },
      exhausted: false,
      errors: [],
      skipped: { missingMedia: 0, missingThumbnail: 0, short: 0, failed: 0 },
      sources: [],
      samples: [],
      ...overrides,
    },
  };
}

/** Ends the run so a leaked endless loop cannot pollute the next test. */
async function stopRun() {
  fireEvent.click(screen.getByRole("button", { name: /stop/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy());
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DamplipsImportPanel", () => {
  it("lists every category with its published count and no quota field", () => {
    render(<DamplipsImportPanel counts={COUNTS} />);
    expect(screen.getByText("Amateur")).toBeTruthy();
    expect(screen.getByText("POV")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    // The old panel asked "new videos per category"; an unlimited import has no
    // such thing to ask for.
    expect(screen.queryByLabelText(/videos per category/i)).toBeNull();
    expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy();
    // Popular listings are the promise the panel makes.
    expect(screen.getByText(/popular listings first/i)).toBeTruthy();
  });

  it("chains slices from the cursor each one returns", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 10 })))
      .mockResolvedValueOnce(
        jsonResponse(report({ imported: 4, cursor: { source: 1, page: 3, skip: 2 } })),
      )
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].cursor).toEqual({ source: 0, page: 1, skip: 0 });
    expect(bodies[1].cursor).toEqual({
      source: 0,
      page: 2,
      skip: 0,
      url: "https://www.damplips.com/most-popular/page/2/",
    });
    expect(bodies[2].cursor).toEqual({ source: 1, page: 3, skip: 2 });
    // Nothing in the payload asks for a capped number of videos.
    expect(bodies[0]).not.toHaveProperty("perCategory");
    expect(bodies[0]).not.toHaveProperty("limit");
    // The first slice of a run also asks the server to repair stored posters.
    expect(bodies[0].repair).toBe(true);
    expect(bodies[2].repair).toBe(false);
    await waitFor(() => expect(screen.getAllByText(/\+14 new/).length).toBeGreaterThan(0));
  });

  it("starts another pass instead of finishing when every listing has been walked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 3, exhausted: true })))
      .mockResolvedValueOnce(
        jsonResponse(report({ imported: 7, exhausted: false, cursor: { source: 2, page: 1, skip: 0 } })),
      )
      .mockResolvedValue(
        jsonResponse(report({ imported: 0, exhausted: false, cursor: { source: 3, page: 1, skip: 0 } })),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    // The second pass starts at the top of the plan again.
    expect(bodies[1].cursor).toEqual({ source: 0, page: 1, skip: 0 });
    // Stop is still offered: the run is alive, not finished.
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();

    await stopRun();
    expect(screen.getByText(/pass 2/)).toBeTruthy();
  });

  it("keeps going across several empty passes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report({ imported: 0, exhausted: true })));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    // Four empty passes and still asking: only Stop ends it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    await stopRun();
  });

  it("stops when the operator presses Stop", async () => {
    let released: (value: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            released = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const stop = await screen.findByRole("button", { name: /stop/i });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(stop);
    released(jsonResponse(report({ exhausted: true })));

    await waitFor(() => expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy());
    // Stop ends the loop; it never issues another request after the in-flight one.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops while it is waiting for the next pass", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report({ imported: 0, exhausted: true })));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DamplipsImportPanel
        counts={[COUNTS[0]]}
        slicePauseMs={1}
        roundPauseMs={5_000}
        maxRoundPauseMs={5_000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("advances every selected category, not just the first one", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return jsonResponse(
        report({ category: body.category, imported: 1, cursor: { source: 0, page: 2, skip: 0 } }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={COUNTS} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const categories = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).category);
    expect(categories.slice(0, 4)).toEqual(["amateur", "pov", "amateur", "pov"]);
    await stopRun();
  });

  it("keeps the run alive through a refused or throttled answer", async () => {
    // damplips answering 429/503 is transient, not a reason to end the run the
    // operator asked to keep going until Stop.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "damplips responded 429" }, false, 429))
      .mockResolvedValue(jsonResponse(report({ imported: 2 })));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DamplipsImportPanel
        counts={[COUNTS[0]]}
        slicePauseMs={1}
        roundPauseMs={30}
        maxRoundPauseMs={30}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("429");
    expect(alert.textContent).toMatch(/retrying/i);

    // It retries the same slice, and the run continues afterwards.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(second.cursor).toEqual(first.cursor);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    await stopRun();
  });

  it("stops when the admin session has expired, because retrying cannot fix it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, false, 401)),
    );

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Unauthorized");
    await waitFor(() => expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy());
  });

  it("stages imports as drafts when the operator asks for review", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByLabelText(/stage as private drafts/i));
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rightsStatus).toBe("pending");
  });

  it("explains what to fix when the counts could not be read", () => {
    render(<DamplipsImportPanel counts={[]} />);
    expect(screen.getByText(/categories table/i)).toBeTruthy();
  });
});
