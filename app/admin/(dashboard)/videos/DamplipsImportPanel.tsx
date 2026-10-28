"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { MAX_VIDEOS_PER_CATEGORY, type CategoryCount } from "@/lib/damplips/importer";

type CategoryReport = {
  category: string;
  imported: number;
  updated: number;
  alreadyPresent: number;
  total: number;
  target: number;
  fulfilled: boolean;
  skipped: { missingMedia: number; missingThumbnail: number; failed: number; duplicateAcrossCategories: number };
  errors: string[];
};

const DEFAULT_PER_CATEGORY = 110;

/**
 * Fills the catalog from damplips.
 *
 * One request per category: a full 12-category run would outlive a single
 * serverless invocation, and the operator gets the progress of each category
 * as it finishes instead of a spinner with no output.
 */
export default function DamplipsImportPanel({ counts }: { counts: CategoryCount[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(counts.map((entry) => entry.slug)),
  );
  const [perCategory, setPerCategory] = useState(DEFAULT_PER_CATEGORY);
  const [dryRun, setDryRun] = useState(false);
  const [stageForReview, setStageForReview] = useState(false);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("");
  const [reports, setReports] = useState<CategoryReport[]>([]);
  const [error, setError] = useState("");

  const categories = counts.length
    ? counts
    : [];
  const short = counts.filter((entry) => entry.count < perCategory).length;

  function toggle(slug: string) {
    setSelected((value) => {
      const next = new Set(value);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function run() {
    const queue = categories.filter((entry) => selected.has(entry.slug));
    if (!queue.length) {
      setError("Select at least one category");
      return;
    }
    setRunning(true);
    setError("");
    setReports([]);
    let collected: CategoryReport[] = [];
    try {
      for (const category of queue) {
        setCurrent(category.slug);
        const response = await fetch("/api/admin/damplips/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: category.slug,
            perCategory,
            dryRun,
            rightsStatus: stageForReview ? "pending" : "cleared",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `Import failed for ${category.label}`);
        }
        const report = payload.report as CategoryReport;
        collected = [...collected, report];
        setReports([...collected]);
      }
      if (!dryRun) router.refresh();
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
        <h2 className="text-[13px] font-semibold">Sync from damplips</h2>
        <p className="mt-1 text-[11.5px] text-amber-300">
          Category counts are unavailable. Apply migration
          00000000000026_damplips_embeds.sql, then reload this page.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Sync from damplips" className="mt-5 rounded-lg border border-line bg-pcard p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
            Sync from damplips
          </h2>
          <p className="mt-0.5 max-w-[720px] text-[11.5px] text-ink-3">
            Reads damplips.com and stores each video as an embed: title, poster,
            duration, source page and the media destination the page serves. No
            file is uploaded or copied. Posts already in the catalog are skipped,
            so it is safe to run again. {short > 0
              ? `${short} of ${counts.length} categories are below ${perCategory}.`
              : `Every category already holds at least ${perCategory}.`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11.5px]">
          Videos per category
          <input
            type="number"
            aria-label="Videos per category"
            min={1}
            max={MAX_VIDEOS_PER_CATEGORY}
            value={perCategory}
            disabled={running}
            onChange={(event) =>
              setPerCategory(
                Math.max(1, Math.min(MAX_VIDEOS_PER_CATEGORY, Number(event.target.value) || 1)),
              )
            }
            className="h-8 w-20 rounded-md border border-line bg-void px-2 tabular-nums"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((entry) => (
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
              className={`tabular-nums ${entry.count >= perCategory ? "text-emerald-400" : "text-amber-300"}`}
            >
              {entry.count}
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
          {running ? `Importing ${current}…` : dryRun ? "Run dry run" : "Run import"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[11.5px] text-red-300">
          {error}
        </p>
      )}

      {reports.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {reports.map((report) => (
            <li key={report.category} className="rounded-md border border-line bg-void px-2.5 py-2 text-[11.5px]">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{report.category}</span>
                <span className={report.fulfilled ? "text-emerald-400" : "text-amber-300"}>
                  {report.total}/{report.target}
                </span>
                <span className="text-ink-3">
                  +{report.imported} new · {report.updated} refreshed · {report.alreadyPresent} already
                  present
                </span>
                {(report.skipped.missingMedia > 0 || report.skipped.missingThumbnail > 0 || report.skipped.failed > 0) && (
                  <span className="text-ink-3">
                    · skipped {report.skipped.missingMedia} without media,{" "}
                    {report.skipped.missingThumbnail} without poster, {report.skipped.failed} unreadable
                  </span>
                )}
              </p>
              {report.errors.length > 0 && (
                <p className="mt-1 break-words text-[10.5px] text-amber-300">
                  {report.errors.slice(0, 3).join(" · ")}
                  {report.errors.length > 3 ? ` · +${report.errors.length - 3} more` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
