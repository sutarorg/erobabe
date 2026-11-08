"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Square } from "lucide-react";
import type { CategoryCount } from "@/lib/catalog/counts";

type Cursor = { source: number; page: number; skip: number; url?: string; queue?: string[] };

type SliceReport = {
  category: string;
  label?: string;
  imported: number;
  target: number;
  targetReached: boolean;
  uncategorised: number;
  duplicates: number;
  repaired: number;
  pagesRead: number;
  postsRead: number;
  cursor: Cursor;
  exhausted: boolean;
  errors: string[];
  skipped: { missingMedia: number; missingThumbnail: number; short: number; failed: number };
};

type CategoryTotal = {
  slug: string;
  label: string;
  /** New videos this run, across every round. */
  imported: number;
  /** New videos in the round that is being filled right now. */
  roundImported: number;
  /** Completed rounds of 100 in this run. */
  rounds: number;
  uncategorised: number;
  duplicates: number;
  repaired: number;
  posts: number;
  /** True while the category is waiting for something new to appear. */
  waiting: boolean;
};

/** New videos one round imports. The operator's "100 videos a round". */
const ROUND_SIZE = 100;
/** Listing pages the server reads per call. Mirrors the route's default. */
const PAGES_PER_SLICE = 12;
/** Post pages the server may open per call. */
const POSTS_PER_SLICE = 400;
/** Pause between slices, so a long run stays a polite visitor. */
const SLICE_PAUSE_MS = 350;
/**
 * Pause while a category has nothing new to read.
 *
 * Every listing has been walked and the related frontier is empty, so the round
 * cannot be finished until damplips publishes something. The run waits — a
 * minute, doubling up to ten — and keeps the round open. It never reports an
 * empty round and never ends on its own; Stop is the only exit.
 */
const ROUND_PAUSE_MS = 60_000;
const MAX_ROUND_PAUSE_MS = 600_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DamplipsImportPanelProps = {
  counts: CategoryCount[];
  /** Pause between slices. Tests shorten it; production keeps it polite. */
  slicePauseMs?: number;
  /** Pause while a category has nothing new to read. */
  roundPauseMs?: number;
  /** Ceiling for that backoff. */
  maxRoundPauseMs?: number;
};

/**
 * Fills the catalog from damplips, 100 videos a round.
 *
 * The operator ticks the categories they want and presses one button. The panel
 * then asks the server for one round at a time and **does not stop on its own**:
 * a round is only finished when it holds 100 new videos, so a call that comes
 * back short is extended with more listings, the related videos of the posts it
 * just read, and the site's newest archives. When even that is used up the round
 * stays open and the panel waits (with backoff) for something new to appear
 * instead of reporting a round of zero. Only the Stop button ends the run — it
 * finishes the call in flight and leaves every imported video in place.
 *
 * There is deliberately no "how many videos" field: an import is not
 * quota-bound, and the cursor in each response is what lets a run of thousands
 * continue past any single request's timeout.
 */
export default function DamplipsImportPanel({
  counts,
  slicePauseMs = SLICE_PAUSE_MS,
  roundPauseMs = ROUND_PAUSE_MS,
  maxRoundPauseMs = MAX_ROUND_PAUSE_MS,
}: DamplipsImportPanelProps) {
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
  /** The request in flight, so Stop can cancel it instead of waiting it out. */
  const inFlight = useRef<AbortController | null>(null);

  const publishedTotal = counts.reduce((sum, entry) => sum + entry.published, 0);
  const catalogTotal = counts.reduce((sum, entry) => sum + entry.total, 0);
  const runningTotal = progress.reduce(
    (sum, entry) => ({
      imported: sum.imported + entry.imported,
      rounds: sum.rounds + entry.rounds,
      uncategorised: sum.uncategorised + entry.uncategorised,
      duplicates: sum.duplicates + entry.duplicates,
      repaired: sum.repaired + entry.repaired,
    }),
    { imported: 0, rounds: 0, uncategorised: 0, duplicates: 0, repaired: 0 },
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
      next.push({ ...entry });
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
    const controller = new AbortController();
    inFlight.current = controller;
    /**
     * Rejects the moment Stop is pressed, whatever the request is doing.
     *
     * `fetch` honours the signal, but a request that hangs before its first
     * byte would otherwise keep the run waiting for it; racing the two makes
     * Stop immediate in both cases.
     */
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
    // A rejection nobody is waiting for must not surface as an unhandled one.
    cancelled.catch(() => undefined);

    const totals = new Map<string, CategoryTotal>();
    for (const category of queue) {
      totals.set(category.slug, {
        slug: category.slug,
        label: category.label,
        imported: 0,
        roundImported: 0,
        rounds: 0,
        uncategorised: 0,
        duplicates: 0,
        repaired: 0,
        posts: 0,
        waiting: false,
      });
    }
    const cursors = new Map<string, Cursor>(
      queue.map((category) => [category.slug, { source: 0, page: 1, skip: 0 }]),
    );

    let index = 0;
    let waitingPause = roundPauseMs;
    let consecutiveFailures = 0;
    let repairPending = true;
    let dryRunPending = dryRun;

    /** The pause a failed call waits before retrying the same round. */
    const retryPause = () => {
      consecutiveFailures += 1;
      return Math.min(maxRoundPauseMs, roundPauseMs * 2 ** Math.min(consecutiveFailures - 1, 6));
    };

    try {
      while (!stopped.current) {
        const category = queue[index % queue.length];
        index += 1;
        const total = totals.get(category.slug)!;
        const cursor = cursors.get(category.slug)!;
        const remainingInRound = Math.max(1, ROUND_SIZE - total.roundImported);

        total.waiting = false;
        setCurrent(
          `${category.label} — round ${total.rounds + 1}, ${total.roundImported}/${ROUND_SIZE}`,
        );
        updateProgress(total);

        let response: Response;
        try {
          response = await Promise.race([
            fetch("/api/admin/damplips/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: category.slug,
                cursor,
                // Ask for exactly what the open round still needs, so no call is
                // spent importing past the round the operator is watching.
                target: remainingInRound,
                pages: PAGES_PER_SLICE,
                posts: POSTS_PER_SLICE,
                dryRun: dryRunPending,
                // Repair stored rows with a missing poster once per run, on the
                // very first slice, so a grid imported before the poster rule
                // fills in.
                repair: repairPending,
                rightsStatus: stageForReview ? "pending" : "cleared",
              }),
              signal: controller.signal,
            }),
            cancelled,
          ]);
        } catch {
          // Stop aborts the call in flight: the run is over, not broken.
          if (stopped.current) break;
          // A dropped connection is not a reason to end a run the operator asked
          // to keep going: wait, then retry the same round.
          const retryIn = retryPause();
          total.waiting = true;
          updateProgress(total);
          setError(
            `Network error on ${category.label} — retrying the round in ${Math.round(
              retryIn / 1000,
            )}s. Press Stop to end the run.`,
          );
          await pause(retryIn);
          continue;
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = String(payload?.error || `Import failed for ${category.label}`);
          // An expired admin session cannot be retried into working: stop and
          // let the operator sign in again.
          if (response.status === 401 || response.status === 403) {
            throw new Error(message);
          }
          // Anything else — damplips throttling or refusing this address, a
          // timeout — is transient as far as the round is concerned.
          const retryIn = retryPause();
          total.waiting = true;
          updateProgress(total);
          setError(
            `${message} — retrying the round in ${Math.round(retryIn / 1000)}s. Press Stop to end the run.`,
          );
          await pause(retryIn);
          continue;
        }

        consecutiveFailures = 0;
        repairPending = false;
        dryRunPending = false;
        setError("");

        const slice = payload.report as SliceReport;
        total.imported += slice.imported;
        total.roundImported += slice.imported;
        total.uncategorised += slice.uncategorised || 0;
        total.duplicates += slice.duplicates;
        total.repaired += slice.repaired || 0;
        total.posts += slice.postsRead;
        cursors.set(category.slug, slice.cursor);

        if (total.roundImported >= ROUND_SIZE) {
          // The round is complete: exactly what the operator asked for. A call
          // may overshoot its target by one concurrency window, and those extra
          // videos belong to the next round rather than being lost.
          while (total.roundImported >= ROUND_SIZE) {
            total.rounds += 1;
            total.roundImported -= ROUND_SIZE;
          }
          waitingPause = roundPauseMs;
        } else if (slice.imported > 0) {
          // Real progress: the next wait, if any, starts small again.
          waitingPause = roundPauseMs;
        }
        updateProgress(total);

        if (slice.exhausted) {
          // Every listing walked and no related ids left, with the round still
          // short. The round stays open — the run waits for damplips to publish
          // something and tries again, growing the pause while that stays empty.
          total.waiting = true;
          updateProgress(total);
          setCurrent(
            `${category.label} — round ${total.rounds + 1}, ${total.roundImported}/${ROUND_SIZE} · waiting for new posts`,
          );
          await pause(waitingPause);
          waitingPause = Math.min(maxRoundPauseMs, waitingPause * 2);
          continue;
        }

        // A short call that still read pages means there is more to read right
        // now: continue the same round immediately.
        await sleep(slicePauseMs);
      }

      for (const total of totals.values()) {
        total.waiting = false;
        updateProgress(total);
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import could not finish");
    } finally {
      inFlight.current = null;
      setRunning(false);
      setCurrent("");
      setWaitingFor(null);
    }
  }

  if (!counts.length) {
    return (
      <section className="mt-5 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-[13px] font-semibold">Import from damplips</h2>
        <p className="mt-1 text-[11.5px] text-amber-300">
          Category counts are unavailable. Check that the categories table has rows, then reload
          this page.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Import from damplips" className="mt-5 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
            Import from damplips
          </h2>
          <p className="mt-0.5 max-w-[760px] text-[11.5px] text-ink-3">
            Imports <strong className="text-ink-2">{ROUND_SIZE} videos a round</strong> — popular
            listings first, then the category&apos;s own pages, the same searches you would type on
            the site, and finally its newest archives and the related videos of everything it just
            read, so a round is not cut short. There is no number to set and no ceiling, and the run
            keeps working until you press Stop: if damplips has nothing new for a moment the round
            stays open and the run waits for it rather than finishing with nothing. A video already
            in the catalog is never added twice, a post with no poster or no playable file is
            skipped rather than imported broken, and a video that turns out not to belong to the
            category is imported anyway — with no category tag.{" "}
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
              ? `Waiting ${Math.ceil(waitingFor / 1000)}s`
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
              // Cancels the call in flight instead of waiting for it, so Stop
              // is immediate even while damplips is slow to answer.
              inFlight.current?.abort();
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
            This run:{" "}
            <span className="text-emerald-400">
              {runningTotal.imported > 0
                ? `+${runningTotal.imported} new`
                : "filling the first round"}
            </span>
            {dryRun ? " (would import)" : ""} · {runningTotal.rounds}{" "}
            {runningTotal.rounds === 1 ? "round" : "rounds"} of {ROUND_SIZE} complete
            {runningTotal.uncategorised > 0
              ? ` · ${runningTotal.uncategorised} with no category`
              : ""}{" "}
            · {runningTotal.duplicates} already present
            {runningTotal.repaired > 0 ? ` · ${runningTotal.repaired} poster(s) repaired` : ""}
            {running && stopped.current ? " · stopping after this round" : ""}
          </p>
          <ul className="mt-2 space-y-1.5">
            {progress.map((entry) => (
              <li
                key={entry.slug}
                className="rounded-md border border-line bg-void px-2.5 py-2 text-[11.5px]"
              >
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">{entry.label}</span>
                  <span
                    className={entry.waiting ? "text-amber-300" : "text-emerald-400"}
                    data-state={entry.waiting ? "waiting" : "importing"}
                  >
                    {entry.waiting ? "waiting for new posts" : "importing"}
                  </span>
                  <span className="text-ink-3">
                    round {entry.rounds + 1} · {entry.roundImported}/{ROUND_SIZE} ·{" "}
                    {entry.rounds} {entry.rounds === 1 ? "round" : "rounds"} done
                  </span>
                </p>
                <p className="mt-0.5 text-ink-3">
                  +{entry.imported} new
                  {entry.uncategorised > 0 ? ` (${entry.uncategorised} with no category)` : ""} ·{" "}
                  {entry.duplicates} already present · {entry.posts} video
                  {entry.posts === 1 ? "" : "s"} read
                  {entry.repaired > 0 ? ` · ${entry.repaired} poster(s) repaired` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
