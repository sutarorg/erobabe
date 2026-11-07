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
  pages: number;
  exhausted: boolean;
};

/** Search pages the server reads per call. Mirrors the route's default. */
const PAGES_PER_SLICE = 4;
/** Pause between slices so a long run stays a polite visitor. */
const SLICE_PAUSE_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fills the catalog from Pornhub.
 *
 * The operator ticks the categories they want and presses one button: the panel
 * then asks the server for one slice at a time and keeps going until Pornhub's
 * search for that category is exhausted. There is deliberately no "how many"
 * field — an import is not quota-bound, and the cursor in each response is what
 * lets the run continue past any single request's timeout.
 *
 * Pressing Stop finishes the slice that is already in flight and leaves every
 * imported video in place; a later run simply continues from wherever the search
 * has got to, because anything already in the catalog is skipped as a duplicate.
 */
export default function PornhubImportPanel({ counts }: { counts: CategoryCount[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(counts.map((entry) => entry.slug)),
  );
  const [stageForReview, setStageForReview] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("");
  const [progress, setProgress] = useState<CategoryTotal[]>([]);
  const [error, setError] = useState("");
  const stopped = useRef(false);

  const publishedTotal = counts.reduce((sum, entry) => sum + entry.published, 0);
  const catalogTotal = counts.reduce((sum, entry) => sum + entry.total, 0);
  const runningTotal = progress.reduce(
    (sum, entry) => ({ imported: sum.imported + entry.imported, duplicates: sum.duplicates + entry.duplicates }),
    { imported: 0, duplicates: 0 },
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

    try {
      for (const category of queue) {
        setCurrent(category.label);
        let cursor: Cursor = { source: 0, page: 1 };
        const total: CategoryTotal = {
          slug: category.slug,
          label: category.label,
          imported: 0,
          duplicates: 0,
          pages: 0,
          exhausted: false,
        };

        while (!stopped.current) {
          const response = await fetch("/api/admin/pornhub/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: category.slug,
              cursor,
              pages: PAGES_PER_SLICE,
              dryRun,
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
          total.pages += slice.pagesRead;
          total.exhausted = slice.exhausted;
          cursor = slice.cursor;
          updateProgress({ ...total });
          setCurrent(`${category.label} · page ${total.pages}`);

          if (slice.exhausted) break;
          // A slice that read nothing and imported nothing is the end of the
          // road for this category, whatever the pagination claims.
          if (slice.pagesRead === 0) break;
          await sleep(SLICE_PAUSE_MS);
        }
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import could not finish");
    } finally {
      setRunning(false);
      setCurrent("");
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
            Videos stream from Pornhub&apos;s own embed player, so each row keeps
            its poster, duration and HD badge. Only videos Pornhub marks HD (or
            whose page serves 720p or better) are imported, and a video already in
            the catalog is never added twice. The run keeps going until the search
            is exhausted; press Stop to end it early.{" "}
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
            ? `Importing ${current || "…"}`
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
            {dryRun ? "(would import)" : ""} ·{" "}
            {runningTotal.duplicates} already present
            {stopped.current && running ? " · stopping after this slice" : ""}
          </p>
          <ul className="mt-2 space-y-1.5">
            {progress.map((entry) => (
              <li
                key={entry.slug}
                className="rounded-md border border-line bg-void px-2.5 py-2 text-[11.5px]"
              >
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">{entry.label}</span>
                  <span className={entry.exhausted ? "text-emerald-400" : "text-amber-300"}>
                    {entry.exhausted ? "search exhausted" : "in progress"}
                  </span>
                  <span className="text-ink-3">
                    +{entry.imported} new · {entry.duplicates} already present ·{" "}
                    {entry.pages} page{entry.pages === 1 ? "" : "s"} read
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
