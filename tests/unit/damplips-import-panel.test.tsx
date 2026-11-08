import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DamplipsImportPanel from "@/app/admin/(dashboard)/videos/DamplipsImportPanel";
import type { CategoryCount } from "@/lib/catalog/counts";

/**
 * The panel is the operator's whole interface to the import. What matters:
 *
 *  - it offers the categories, with their real published counts;
 *  - a **round** is 100 new videos: the panel asks for exactly what the open
 *    round still needs and does not treat a short call as a finished round;
 *  - it never reports a round of zero: when damplips has nothing new the round
 *    stays open, the run waits, and it keeps trying until Stop;
 *  - Stop ends the run without losing what was already imported.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const COUNTS: CategoryCount[] = [
  { id: "cat-amateur", slug: "amateur", label: "Amateur", published: 42, total: 45 },
  { id: "cat-pov", slug: "pov", label: "POV", published: 0, total: 0 },
];

/** Short pauses so a "never stops" loop stays a fast test. */
const FAST = { slicePauseMs: 1, roundPauseMs: 5, maxRoundPauseMs: 10 };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function report(overrides: Record<string, unknown> = {}) {
  const imported = typeof overrides.imported === "number" ? overrides.imported : 10;
  const target = typeof overrides.target === "number" ? overrides.target : 100;
  return {
    report: {
      category: "amateur",
      imported,
      target,
      targetReached: imported >= target,
      uncategorised: 0,
      duplicates: 5,
      repaired: 0,
      pagesRead: 2,
      postsRead: imported,
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

const body = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body);

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DamplipsImportPanel", () => {
  it("lists every category with its published count, promises 100 a round and asks for no quota", () => {
    render(<DamplipsImportPanel counts={COUNTS} />);
    expect(screen.getByText("Amateur")).toBeTruthy();
    expect(screen.getByText("POV")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText(/100 videos a round/i)).toBeTruthy();
    expect(screen.getByText(/no category tag/i)).toBeTruthy();
    // The old panel asked "new videos per category"; an unlimited import has no
    // such thing to ask for.
    expect(screen.queryByLabelText(/videos per category/i)).toBeNull();
    expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy();
  });

  it("asks for a round of 100 and only asks for more as the round fills", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 60 })))
      .mockResolvedValueOnce(jsonResponse(report({ imported: 40 })))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    const bodies = fetchMock.mock.calls.map(body);
    // The first call opens a round of 100, the second only needs the 40 that are
    // still missing, and completing it opens the next round of 100.
    expect(bodies[0].target).toBe(100);
    expect(bodies[1].target).toBe(40);
    expect(bodies[2].target).toBe(100);
    // The cursor of each call is the one the previous call returned.
    expect(bodies[1].cursor).toEqual({
      source: 0,
      page: 2,
      skip: 0,
      url: "https://www.damplips.com/most-popular/page/2/",
    });
    // A round is only reported once it holds its 100 videos.
    expect(screen.getByText(/1 round of 100 complete/)).toBeTruthy();
    await stopRun();
  });

  it("does not finish a round on a short call: it keeps reading", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report({ imported: 25 })));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    // Four calls of 25 make one round; the fifth opens the next one.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5));
    const targets = fetchMock.mock.calls.slice(0, 5).map((call) => body(call).target);
    expect(targets).toEqual([100, 75, 50, 25, 100]);
    await stopRun();
  });

  it("keeps the round open when every listing has been walked, instead of reporting +0", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 30 })))
      .mockResolvedValueOnce(jsonResponse(report({ imported: 0, exhausted: true, pagesRead: 1, postsRead: 0 })))
      .mockResolvedValueOnce(jsonResponse(report({ imported: 70 })))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    // The empty call waited and retried the same open round rather than
    // declaring a round of zero; the next call asked for the missing 70.
    expect(body(fetchMock.mock.calls[1]).target).toBe(70);
    expect(body(fetchMock.mock.calls[2]).target).toBe(70);
    // Only once 70 more arrived is the round of 100 complete.
    await waitFor(() => expect(screen.getByText(/1 round of 100 complete/)).toBeTruthy());
    await stopRun();
  });

  it("keeps waiting through several empty calls and never ends the run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(report({ imported: 0, exhausted: true, pagesRead: 1, postsRead: 0 })));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    // Still running, still no completed round, round 1 still at 0 of 100.
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    expect(screen.getByText(/round 1 · 0\/100/)).toBeTruthy();
    expect(screen.queryByText(/1 round of 100 complete/)).toBeNull();
    await stopRun();
  });

  it("stops when the operator presses Stop, cancelling the call in flight", async () => {
    let aborted = false;
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
          setTimeout(() => resolve(jsonResponse(report({ imported: 10 }))), 5);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} slicePauseMs={50} roundPauseMs={50} maxRoundPauseMs={50} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const stop = await screen.findByRole("button", { name: /stop/i });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(stop);

    await waitFor(() => expect(screen.getByRole("button", { name: /start import/i })).toBeTruthy());
    expect(aborted).toBe(true);
    // Progress made before Stop is kept, and shown.
    expect(screen.getAllByText(/\+\d+ new/).length).toBeGreaterThan(0);
  });

  it("stops while it is waiting for new posts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(report({ imported: 0, exhausted: true, pagesRead: 1, postsRead: 0 })));
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
      const request = JSON.parse(init.body);
      return jsonResponse(
        report({ category: request.category, imported: 50, cursor: { source: 0, page: 2, skip: 0 } }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={COUNTS} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    const categories = fetchMock.mock.calls.map((call) => body(call).category);
    expect(categories.slice(0, 4)).toEqual(["amateur", "pov", "amateur", "pov"]);
    // Each category fills its own round of 100.
    expect(fetchMock.mock.calls.map((call) => body(call).target).slice(0, 4)).toEqual([
      100, 100, 50, 50,
    ]);
    await stopRun();
  });

  it("counts videos that came in with no category", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report({ imported: 100, uncategorised: 37 })))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    await waitFor(() => expect(screen.getAllByText(/37 with no category/).length).toBeGreaterThan(0));
    await stopRun();
  });

  it("keeps the run alive through a refused or throttled answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "damplips responded 429" }, false, 429))
      .mockResolvedValueOnce(jsonResponse(report({ imported: 100 })))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<DamplipsImportPanel counts={[COUNTS[0]]} {...FAST} />);
    fireEvent.click(screen.getByRole("button", { name: /start import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("429");
    expect(alert.textContent).toMatch(/retrying/i);

    // It retries the same round, and the run continues afterwards.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [first, second] = fetchMock.mock.calls.map(body);
    expect(second.target).toBe(first.target);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(screen.getByText(/1 round of 100 complete/)).toBeTruthy());
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
    expect(body(fetchMock.mock.calls[0]).rightsStatus).toBe("pending");
  });

  it("explains what to fix when the counts could not be read", () => {
    render(<DamplipsImportPanel counts={[]} />);
    expect(screen.getByText(/categories table/i)).toBeTruthy();
  });
});
