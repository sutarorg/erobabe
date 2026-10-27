import { DAMPLIPS_BASE_URL, damplipsSlug, parseListing, parseVideoPage } from "./parse";
import { categorySource, sourcePlan } from "./categories";
import type { FetchDamplipsPage } from "./client";

/**
 * Fills the erobabe catalog from damplips.com.
 *
 * The importer is idempotent and additive: it never deletes a catalog row, it
 * recognises a video it has already imported by the damplips post id, and it
 * counts a video once even when damplips lists it in several categories.
 *
 * Nothing is uploaded or copied. Each catalog row stores the damplips page, the
 * thumbnail the page advertises, and the media destination the page itself
 * serves, which the player then reads.
 */

/** Minimum number of videos the default run must leave in every category. */
export const MIN_VIDEOS_PER_CATEGORY = 100;
/** Default target: the minimum plus a buffer for posts that cannot resolve. */
export const DEFAULT_VIDEOS_PER_CATEGORY = 110;
/** Hard ceiling per request, so one operator action stays bounded. */
export const MAX_VIDEOS_PER_CATEGORY = 200;

export type RightsStatus = "cleared" | "pending";

export type DamplipsImportOptions = {
  /** erobabe category slug (fixed taxonomy). */
  categorySlug: string;
  /** How many videos that category should end up with. */
  perCategory?: number;
  /** Parse and report without writing to the catalog. */
  dryRun?: boolean;
  /** `pending` stages imports as private drafts for review. */
  rightsStatus?: RightsStatus;
  /** Safety valve for paging. */
  maxPages?: number;
  /** Parallel post-page reads. */
  concurrency?: number;
  /** Delay between post-page reads, in milliseconds. */
  delayMs?: number;
  baseUrl?: string;
};

/** The slice of the Supabase service client the importer uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ImportService = { from: (table: string) => any };

export type ImportLogger = (message: string) => void;

export type ImportDeps = {
  fetchPage: FetchDamplipsPage;
  service: ImportService;
  /** erobabe category id, resolved by the caller from the fixed taxonomy. */
  categoryId: string;
  /** Post ids used by this run, shared across categories. */
  claimed?: Set<string>;
  logger?: ImportLogger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type ImportSample = {
  title: string;
  thumbnailUrl: string | null;
  sourceUrl: string;
  mediaKind: "direct" | "embed";
  mediaUrl: string;
};

export type ImportSourceReport = {
  url: string;
  pages: number;
  cards: number;
  imported: number;
  error?: string;
};

export type CategoryImportReport = {
  category: string;
  categoryId: string;
  target: number;
  minimum: number;
  imported: number;
  updated: number;
  alreadyPresent: number;
  skipped: {
    duplicateAcrossCategories: number;
    missingMedia: number;
    missingThumbnail: number;
    failed: number;
  };
  total: number;
  fulfilled: boolean;
  dryRun: boolean;
  sources: ImportSourceReport[];
  errors: string[];
  samples: ImportSample[];
};

type Outcome = "imported" | "updated" | "failed" | "missingMedia" | "missingThumbnail";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function clampTarget(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_VIDEOS_PER_CATEGORY;
  return Math.min(MAX_VIDEOS_PER_CATEGORY, Math.max(1, Math.floor(value)));
}

/** Runs `worker` over `items` with a fixed concurrency, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.max(1, Math.min(concurrency, items.length || 1)))
    .fill(null)
    .map(async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    });
  await Promise.all(runners);
  return results;
}

export async function importCategory(
  options: DamplipsImportOptions,
  deps: ImportDeps,
): Promise<CategoryImportReport> {
  const log = deps.logger ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const claimed = deps.claimed ?? new Set<string>();
  const baseUrl = (options.baseUrl || DAMPLIPS_BASE_URL).replace(/\/$/, "");
  const target = clampTarget(options.perCategory);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const delayMs = Math.max(0, options.delayMs ?? 120);
  const maxPages = Math.max(1, Math.min(80, options.maxPages ?? 40));
  const rightsStatus: RightsStatus = options.rightsStatus === "pending" ? "pending" : "cleared";
  const dryRun = Boolean(options.dryRun);

  if (!categorySource(options.categorySlug)) {
    throw new Error(`No damplips source is configured for "${options.categorySlug}"`);
  }

  const report: CategoryImportReport = {
    category: options.categorySlug,
    categoryId: deps.categoryId,
    target,
    minimum: Math.min(MIN_VIDEOS_PER_CATEGORY, target),
    imported: 0,
    updated: 0,
    alreadyPresent: 0,
    skipped: { duplicateAcrossCategories: 0, missingMedia: 0, missingThumbnail: 0, failed: 0 },
    total: 0,
    fulfilled: false,
    dryRun,
    sources: [],
    errors: [],
    samples: [],
  };

  /**
   * Writes (or, in a dry run, only describes) one resolved post.
   *
   * A duplicate key means the post is already in the catalog: refresh its
   * metadata rather than counting it twice.
   */
  async function saveCard(card: {
    detail: NonNullable<ReturnType<typeof parseVideoPage>>;
    thumbnailUrl: string;
  }): Promise<Outcome> {
    const { detail, thumbnailUrl } = card;
    if (dryRun) {
      if (report.samples.length < 5) {
        report.samples.push({
          title: detail.title,
          thumbnailUrl,
          sourceUrl: detail.sourceUrl,
          mediaKind: detail.media!.kind,
          mediaUrl: detail.media!.url,
        });
      }
      return "imported";
    }

    const row: Record<string, unknown> = {
      slug: damplipsSlug(detail.title, detail.sourceId),
      title: detail.title,
      description: detail.description,
      category_id: deps.categoryId,
      thumbnail_url: thumbnailUrl,
      provider: "damplips",
      provider_file_id: detail.sourceId,
      source_name: "damplips",
      source_url: detail.sourceUrl,
      playable_url: detail.media!.kind === "direct" ? detail.media!.url : null,
      embed_url: detail.media!.kind === "embed" ? detail.media!.url : null,
      duration_seconds: detail.durationSeconds,
      status: rightsStatus === "cleared" ? "published" : "pending_review",
      visibility: rightsStatus === "cleared" ? "public" : "private",
      rights_status: rightsStatus,
      moderation_status: "approved",
      requires_reupload: false,
      published_at: rightsStatus === "cleared" ? now().toISOString() : null,
    };

    const { error } = await deps.service.from("videos").insert(row);
    if (!error) return "imported";

    if (error.code === "23505") {
      const { data: samePost } = await deps.service
        .from("videos")
        .select("id")
        .eq("provider", "damplips")
        .eq("provider_file_id", detail.sourceId)
        .maybeSingle();
      if (samePost) {
        const { error: updateError } = await deps.service
          .from("videos")
          .update({
            title: row.title,
            thumbnail_url: row.thumbnail_url,
            playable_url: row.playable_url,
            embed_url: row.embed_url,
            source_url: row.source_url,
            duration_seconds: row.duration_seconds,
          })
          .eq("id", (samePost as { id: string }).id);
        if (updateError) {
          report.errors.push(`${detail.sourceUrl}: ${updateError.message || "update failed"}`);
          return "failed";
        }
        return "updated";
      }
      // The slug belongs to a different row; keep the post and disambiguate.
      const retry = await deps.service
        .from("videos")
        .insert({ ...row, slug: `${String(row.slug)}-${detail.sourceId}` });
      if (!retry.error) return "imported";
      report.errors.push(`${detail.sourceUrl}: ${retry.error.message || "insert failed"}`);
      return "failed";
    }

    report.errors.push(`${detail.sourceUrl}: ${error.message || "insert failed"}`);
    return "failed";
  }

  /** Reads one post page and turns it into a catalog row. */
  async function processCard(card: {
    sourceId: string;
    sourceUrl: string;
    title: string;
    thumbnailUrl: string | null;
  }): Promise<Outcome> {
    if (delayMs) await sleep(delayMs);
    let detail: ReturnType<typeof parseVideoPage>;
    try {
      const detailPage = await deps.fetchPage(card.sourceUrl);
      detail = parseVideoPage(detailPage.html, detailPage.url || card.sourceUrl);
    } catch (error) {
      report.errors.push(
        `${card.sourceUrl}: ${error instanceof Error ? error.message : "unreadable post page"}`,
      );
      return "failed";
    }
    if (!detail) {
      report.errors.push(`${card.sourceUrl}: no title on the post page`);
      return "failed";
    }

    const thumbnailUrl = detail.thumbnailUrl || card.thumbnailUrl;
    if (!thumbnailUrl) return "missingThumbnail";
    if (!detail.media) return "missingMedia";

    return saveCard({ detail, thumbnailUrl });
  }

  function tally(outcomes: Outcome[], sourceReport: ImportSourceReport): void {
    for (const outcome of outcomes) {
      if (outcome === "imported") {
        report.imported += 1;
        sourceReport.imported += 1;
        report.total += 1;
      } else if (outcome === "updated") {
        report.updated += 1;
        sourceReport.imported += 1;
        report.total += 1;
      } else if (outcome === "missingMedia") {
        report.skipped.missingMedia += 1;
      } else if (outcome === "missingThumbnail") {
        report.skipped.missingThumbnail += 1;
      } else {
        report.skipped.failed += 1;
      }
    }
  }

  // Everything already in this category counts towards the target and stops
  // another category from claiming the same post in the same run.
  const { data: existingRows, error: existingError } = await deps.service
    .from("videos")
    .select("provider_file_id")
    .eq("provider", "damplips")
    .eq("category_id", deps.categoryId);
  if (existingError) throw new Error(existingError.message || "Unable to read the category catalog");
  for (const row of (existingRows as Array<{ provider_file_id?: string | null }> | null) || []) {
    if (!row.provider_file_id) continue;
    claimed.add(String(row.provider_file_id));
    report.alreadyPresent += 1;
  }
  report.total = report.alreadyPresent;

  if (report.total >= target) {
    report.fulfilled = true;
    log(`${options.categorySlug}: already holds ${report.total} videos`);
    return report;
  }

  for (const sourceUrl of sourcePlan(options.categorySlug, baseUrl)) {
    if (report.total >= target) break;
    const sourceReport: ImportSourceReport = { url: sourceUrl, pages: 0, cards: 0, imported: 0 };
    report.sources.push(sourceReport);
    const seenOnSource = new Set<string>();
    let pageUrl: string | null = sourceUrl;

    while (pageUrl && report.total < target && sourceReport.pages < maxPages) {
      let page;
      try {
        page = await deps.fetchPage(pageUrl);
      } catch (error) {
        sourceReport.error = error instanceof Error ? error.message : "Unable to read the listing";
        break;
      }
      sourceReport.pages += 1;

      const { cards, nextPageUrl } = parseListing(page.html, page.url || pageUrl);
      if (!cards.length) {
        if (sourceReport.pages === 1 && !sourceReport.error) {
          sourceReport.error = "No video cards on this listing";
        }
        break;
      }

      const fresh = cards.filter((card) => !seenOnSource.has(card.sourceId));
      for (const card of fresh) seenOnSource.add(card.sourceId);
      sourceReport.cards += fresh.length;

      // Read post pages in chunks no larger than the quota still needs. A card
      // that turns out to be unusable frees its slot, so the loop takes the next
      // cards on the same page instead of leaving the category short.
      let cursor = 0;
      while (cursor < fresh.length && report.total < target) {
        const remaining = target - report.total;
        const batch: typeof fresh = [];
        while (cursor < fresh.length && batch.length < remaining) {
          const card = fresh[cursor];
          cursor += 1;
          if (claimed.has(card.sourceId)) {
            report.skipped.duplicateAcrossCategories += 1;
            continue;
          }
          // Claim immediately: two categories paging the same listing must not
          // import the same post twice, and a post that turned out to be
          // unusable is not retried by a later source in the same run.
          claimed.add(card.sourceId);
          batch.push(card);
        }
        if (!batch.length) break;

        tally(await mapWithConcurrency(batch, concurrency, processCard), sourceReport);
      }

      pageUrl = report.total < target ? nextPageUrl : null;
    }

    log(
      `${options.categorySlug}: ${sourceReport.imported} from ${sourceUrl}` +
        (sourceReport.error ? ` (${sourceReport.error})` : ""),
    );
  }

  report.fulfilled = report.total >= report.minimum;
  if (!report.fulfilled) {
    report.errors.push(
      `Only ${report.total} videos resolved for ${options.categorySlug}; ${report.minimum} required.`,
    );
  }
  return report;
}

export type ImportRunReport = {
  categories: CategoryImportReport[];
  minimum: number;
  perCategory: number;
  dryRun: boolean;
  /** True only when every requested category reached the minimum. */
  complete: boolean;
};

/** Imports every requested category in order, sharing one claim set. */
export async function importCatalog(
  options: {
    categories: Array<{ slug: string; id: string; label?: string }>;
    perCategory?: number;
    dryRun?: boolean;
    rightsStatus?: RightsStatus;
    concurrency?: number;
    delayMs?: number;
    maxPages?: number;
    baseUrl?: string;
  },
  deps: {
    fetchPage: FetchDamplipsPage;
    service: ImportService;
    logger?: ImportLogger;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<ImportRunReport> {
  const claimed = new Set<string>();
  const reports: CategoryImportReport[] = [];
  const perCategory = clampTarget(options.perCategory);

  for (const category of options.categories) {
    reports.push(
      await importCategory(
        {
          categorySlug: category.slug,
          perCategory,
          dryRun: options.dryRun,
          rightsStatus: options.rightsStatus,
          concurrency: options.concurrency,
          delayMs: options.delayMs,
          maxPages: options.maxPages,
          baseUrl: options.baseUrl,
        },
        {
          fetchPage: deps.fetchPage,
          service: deps.service,
          categoryId: category.id,
          claimed,
          logger: deps.logger,
          now: deps.now,
          sleep: deps.sleep,
        },
      ),
    );
  }

  return {
    categories: reports,
    minimum: Math.min(MIN_VIDEOS_PER_CATEGORY, perCategory),
    perCategory,
    dryRun: Boolean(options.dryRun),
    complete: reports.every((report) => report.fulfilled),
  };
}

export type CategoryCount = { id: string; slug: string; label: string; count: number };

/** Published damplips videos per fixed category, for the admin panel. */
export async function categoryCounts(service: ImportService): Promise<CategoryCount[]> {
  const { data: categories, error } = await service
    .from("categories")
    .select("id, label, slug")
    .order("label");
  if (error) throw new Error(error.message || "Unable to read categories");

  const { data: videos } = await service
    .from("videos")
    .select("category_id, status, visibility, playable_url, embed_url")
    .eq("provider", "damplips");

  const counts = new Map<string, number>();
  for (const row of (videos as Array<Record<string, unknown>> | null) || []) {
    if (row.status !== "published" || row.visibility !== "public") continue;
    if (!row.playable_url && !row.embed_url) continue;
    const key = String(row.category_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return ((categories as Array<Record<string, unknown>> | null) || []).map((category) => ({
    id: String(category.id),
    slug: String(category.slug),
    label: String(category.label),
    count: counts.get(String(category.id)) || 0,
  }));
}
