"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Square } from "lucide-react";
import type { CategoryCount } from "@/lib/catalog/counts";

type Cursor = { source: number; page: number };

type SliceReport = {
  category: string;
  label?: string;
  imported: number;
  duplicates: number;
  repaired: number;
  pagesRead: number;
  cursor: Cursor;
  exhausted: boolean;
  errors: string[];
  skipped: { notHd: number; unknownQuality: number; short: number; noThumbnail: number; failed: number };
};

type CategoryTotal = {
  slug: string;
  label: string;
  imported: number;
  duplicates: number;
  repaired: number;
  pages: number;
  /** Completed passes over every search of this category. */
  passes: number;
  state: "running" | "waiting" | "error";
};

/** Search pages the server reads per call. Mirrors the route's default. */
const PAGES_PER_SLICE = 4;
/** Pause between slices so a long run stays a polite visitor. */
const SLICE_PAUSE_MS = 350;
/**
 * Pause before starting another pass once every search has been walked.
 *
 * The run does not stop there — the operator asked for it to keep going until
 * Stop — but hammering the same exhausted result pages would be rude and
 * pointless. A pass that finds nothing new waits longer each time, up to
 * `MAX_ROUND_PAUSE_MS`, and the Stop button stays live throughout.
 */
const ROUND_PAUSE_MS = 60_000;
const MAX_ROUND_PAUSE_MS = 600_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fills the catalog from Pornhub.
 *
 * The operator ticks the categories they want and presses one button. The panel
 * then asks the server for one slice at a time and **does not stop on its own**:
 * when a category has walked every one of its searches (and every sort order),
 * it pauses briefly and starts another pass, picking up whatever Pornhub has
 * published since. Only the Stop button ends the run — it finishes the slice in
 * flight and leaves every imported video in place.
 *
 * There is deliberately no "how many" field: an import is not quota-bound, and
 * the cursor in each response is what lets the run continue past any single
 * request's timeout. Searches are ordered most-viewed first, so the videos that
 * land first are the category's popular ones.
 */
export type PornhubImportPanelProps = {
  counts: CategoryCount[];
  /** Pause between slices. Tests shorten it; production keeps it polite. */
  slicePauseMs?: number;
  /** Pause before another pass once every search has been walked. */
  roundPauseMs?: number;
  /** Ceiling for the backoff while passes keep coming back empty. */
  maxRoundPauseMs?: number;
};

export default function PornhubImportPanel({
  counts,
  slicePauseMs = SLICE_PAUSE_MS,
  roundPauseMs = ROUND_PAUSE_MS,
  maxRoundPauseMs = MAX_ROUND_PAUSE_MS,
}: PornhubImportPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(counts.map((entry) => entry.slug)),
  );
  const [stageForReview, setStageForReview] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("");
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [progress, setProgress] = useState<CategoryTotal[]>([]);
  const [error, setError] = useState("");
  const stopped = useRef(false);

  const publishedTotal = counts.reduce((sum, entry) => sum + entry.published, 0);
  const catalogTotal = counts.reduce((sum, entry) => sum + entry.total, 0);
  const runningTotal = progress.reduce(
    (sum, entry) => ({
      imported: sum.imported + entry.imported,
      duplicates: sum.duplicates + entry.duplicates,
      repaired: sum.repaired + entry.repaired,
    }),
    { imported: 0, duplicates: 0, repaired: 0 },
  );

  const toggle = (slug: string) => {
    setSelected((value) => {
      const next = new Set(value);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const updateProgress = useCallback((entry: CategoryTotal) => {
    setProgress((rows) => {
      const next = rows.filter((row) => row.slug !== entry.slug);
      next.push(entry);
      return next;
    });
  }, []);

  /** One cancellable pause: Stop must work while the panel is waiting. */
  async function pause(ms: number): Promise<void> {
    const startedAt = Date.now();
    let remaining = ms;
    while (remaining > 0 && !stopped.current) {
      setWaitingFor(remaining);
      await sleep(Math.min(500, remaining));
      remaining = ms - (Date.now() - startedAt);
    }
    setWaitingFor(null);
  }

  async function run() {
    const queue = counts.filter((entry) => selected.has(entry.slug));
    if (!queue.length) {
      setError("Select at least one category");
      return;
    }

    stopped.current = false;
    setRunning(true);
    setError("");
    setProgress([]);

    type RunState = { cursor: Cursor; total: CategoryTotal; walkedPlan: boolean };
    const states = new Map<string, RunState>();
    for (const category of queue) {
      states.set(category.slug, {
        cursor: { source: 0, page: 1 },
        walkedPlan: false,
        total: {
          slug: category.slug,
          label: category.label,
          imported: 0,
          duplicates: 0,
          repaired: 0,
          pages: 0,
          passes: 0,
          state: "running",
        },
      });
    }

    // Every selected category advances one slice at a time in rotation, so one
    // busy category never starves the others and each keeps making progress.
    let index = 0;
    let pauseBeforeNextRound = roundPauseMs;
    let importedSinceRound = 0;

    try {
      while (!stopped.current) {
        const category = queue[index % queue.length];
        index += 1;
        const state = states.get(category.slug)!;
        const total = state.total;
        setCurrent(`${category.label} · page ${total.pages + PAGES_PER_SLICE}`);
        total.state = "running";
        updateProgress({ ...total });

        const response = await fetch("/api/admin/pornhub/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: category.slug,
            cursor: state.cursor,
            pages: PAGES_PER_SLICE,
            dryRun,
            // Repair stored rows with a missing poster once per run, on the very
            // first slice, so a grid imported before the poster rule fills in.
            repair: total.pages === 0,
            rightsStatus: stageForReview ? "pending" : "cleared",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `Import failed for ${category.label}`);
        }

        const slice = payload.report as SliceReport;
        total.imported += slice.imported;
        total.duplicates += slice.duplicates;
        total.repaired += slice.repaired || 0;
        total.pages += slice.pagesRead;
        importedSinceRound += slice.imported;

        // The plan is walked when the server says so, or when a slice cannot
        // read a single page. Either way the next pass starts at the top.
        if (slice.exhausted || slice.pagesRead === 0) {
          state.cursor = { source: 0, page: 1 };
          state.walkedPlan = true;
          total.passes += 1;
          total.state = "waiting";
        } else {
          state.cursor = slice.cursor;
          state.walkedPlan = false;
          total.state = "running";
        }
        updateProgress({ ...total });

        const everyCategoryWalked = queue.every(
          (entry) => states.get(entry.slug)!.walkedPlan,
        );

        if (everyCategoryWalked) {
          // Nothing left to read right now — but the run does not stop. Wait,
          // then start another pass over every search; anything published since
          // the last pass is new. The pause grows while passes stay empty.
          for (const entry of queue) states.get(entry.slug)!.walkedPlan = false;
          if (importedSinceRound > 0) pauseBeforeNextRound = roundPauseMs;
          await pause(pauseBeforeNextRound);
          if (importedSinceRound === 0) {
            pauseBeforeNextRound = Math.min(maxRoundPauseMs, pauseBeforeNextRound * 2);
          }
          importedSinceRound = 0;
        } else {
          await sleep(slicePauseMs);
        }
      }

      for (const state of states.values()) {
        state.total.state = "waiting";
        updateProgress({ ...state.total });
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import could not finish");
    } finally {
      setRunning(false);
      setCurrent("");
      setWaitingFor(null);
    }
  }

  if (!counts.length) {
    return (
      <section className="mt-5 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-[13px] font-semibold">Import from Pornhub</h2>
        <p className="mt-1 text-[11.5px] text-amber-300">
          Category counts are unavailable. Apply migration
          00000000000029_pornhub_embeds.sql, then reload this page.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Import from Pornhub" className="mt-5 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
            Import from Pornhub
          </h2>
          <p className="mt-0.5 max-w-[760px] text-[11.5px] text-ink-3">
            Searches Pornhub for each selected category name and imports every
            matching video it finds — there is no number to set and no ceiling.
            Each category is searched <strong className="font-medium text-ink-2">most
            viewed first</strong>, so the popular videos land first, and the run
            keeps working until you press Stop: when every search has been walked
            it pauses and starts another pass, picking up anything published
            since. Only videos Pornhub marks HD (or whose page serves 720p or
            better) with a real poster are imported, and a video already in the
            catalog is never added twice.{" "}
            {publishedTotal.toLocaleString("en-US")} published{" "}
            {publishedTotal === 1 ? "video" : "videos"} across these categories
            {catalogTotal !== publishedTotal
              ? `, out of ${catalogTotal.toLocaleString("en-US")} rows in the catalog`
              : ""}
            .
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map((entry) => (
          <label
            key={entry.slug}
            className="flex items-center gap-2 rounded-md border border-line bg-void px-2 py-1.5 text-[11.5px]"
          >
            <input
              type="checkbox"
              checked={selected.has(entry.slug)}
              disabled={running}
              onChange={() => toggle(entry.slug)}
            />
            <span className="flex-1 truncate">{entry.label}</span>
            <span
              className="flex items-baseline gap-1 tabular-nums"
              title={`${entry.published} published ${
                entry.published === 1 ? "video" : "videos"
              } in ${entry.label} · ${entry.total} ${
                entry.total === 1 ? "row" : "rows"
              } in the catalog`}
            >
              <span className={entry.published > 0 ? "text-emerald-400" : "text-amber-300"}>
                {entry.published}
              </span>
              {entry.total !== entry.published && (
                <span className="text-[10px] text-ink-3">{entry.total} total</span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11.5px]">
          <input
            type="checkbox"
            checked={dryRun}
            disabled={running}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Dry run (resolve only, write nothing)
        </label>
        <label className="flex items-center gap-2 text-[11.5px]">
          <input
            type="checkbox"
            checked={stageForReview}
            disabled={running || dryRun}
            onChange={(event) => setStageForReview(event.target.checked)}
          />
          Stage as private drafts (rights pending)
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || !selected.size}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
        >
          {running ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          )}
          {running
            ? waitingFor != null
              ? `Next pass in ${Math.ceil(waitingFor / 1000)}s`
              : `Importing ${current || "…"}`
            : dryRun
              ? "Run dry run"
              : "Start import"}
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              stopped.current = true;
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[12.5px] font-medium text-ink-2 hover:text-ink"
          >
            <Square aria-hidden="true" className="h-3.5 w-3.5" />
            Stop
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[11.5px] text-red-300">
          {error}
        </p>
      )}

      {progress.length > 0 && (
        <>
          <p className="mt-3 text-[11.5px] text-ink-3">
            This run: <span className="text-emerald-400">+{runningTotal.imported} new</span>{" "}
            {dryRun ? "(would import)" : ""} · {runningTotal.duplicates} already present
            {runningTotal.repaired > 0 ? ` · ${runningTotal.repaired} poster(s) repaired` : ""}
            {running && stopped.current ? " · stopping after this slice" : ""}
          </p>
          <ul className="mt-2 space-y-1.5">
            {progress.map((entry) => (
              <li
                key={entry.slug}
                className="rounded-md border border-line bg-void px-2.5 py-2 text-[11.5px]"
              >
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">{entry.label}</span>
                  <span className={entry.state === "running" ? "text-amber-300" : "text-emerald-400"}>
                    {entry.state === "running"
                      ? "importing"
                      : entry.passes > 0
                        ? `pass ${entry.passes + 1}`
                        : "in progress"}
                  </span>
                  <span className="text-ink-3">
                    +{entry.imported} new · {entry.duplicates} already present ·{" "}
                    {entry.pages} page{entry.pages === 1 ? "" : "s"} read
                    {entry.repaired > 0 ? ` · ${entry.repaired} poster(s) repaired` : ""}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
