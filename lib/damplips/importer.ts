import { DAMPLIPS_BASE_URL, advanceSearchPage, damplipsSlug, parseListing, parseVideoPage } from "./parse";
import { categorySource, sourcePlan } from "./categories";
import type { FetchDamplipsPage } from "./client";
import { fetchHostMediaUrl, type FetchHostMedia } from "./host-media";

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

/** Default unique videos to add per selected category in one operator run. */
export const DEFAULT_VIDEOS_PER_CATEGORY = 110;
/** Nightly autopilot: new unique videos per category at 00:00 IST. */
export const AUTOPILOT_VIDEOS_PER_CATEGORY = 100;
/** Hard ceiling per request, so one operator action stays bounded. */
export const MAX_VIDEOS_PER_CATEGORY = 500;
/** @deprecated Kept so older reports still type-check; quota is unique new rows. */
export const MIN_VIDEOS_PER_CATEGORY = 0;

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
  /**
   * Hits the media host so the stored URL is already the file a browser can
   * play. Defaults to a range-request against the parsed file.
   */
  fetchHostMedia?: FetchHostMedia;
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

/** PostgREST pages at 1 000 rows; a larger catalog would otherwise look "already imported". */
const CATALOG_PAGE = 1000;

type DamplipsIdentity = { provider_file_id: string; category_id: string | null };

/**
 * Every live damplips row. Deleted videos are gone from `videos` and must not
 * appear here — `media_retention` is operator history, not the catalog.
 */
export async function loadLiveDamplipsIdentities(service: ImportService): Promise<DamplipsIdentity[]> {
  const identities: DamplipsIdentity[] = [];
  let from = 0;
  for (;;) {
    const query = service
      .from("videos")
      .select("provider_file_id, category_id")
      .eq("provider", "damplips");
    const page = typeof query.range === "function" ? query.range(from, from + CATALOG_PAGE - 1) : query;
    const { data, error } = await page;
    if (error) throw new Error(error.message || "Unable to read the category catalog");
    const batch = (data || []) as Array<{ provider_file_id?: string | null; category_id?: string | null }>;
    for (const row of batch) {
      if (!row.provider_file_id) continue;
      identities.push({
        provider_file_id: String(row.provider_file_id),
        category_id: row.category_id == null ? null : String(row.category_id),
      });
    }
    if (batch.length < CATALOG_PAGE) break;
    from += CATALOG_PAGE;
  }
  return identities;
}

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
  const fetchHostMedia = deps.fetchHostMedia ?? fetchHostMediaUrl;
  const claimed = deps.claimed ?? new Set<string>();
  const baseUrl = (options.baseUrl || DAMPLIPS_BASE_URL).replace(/\/$/, "");
  const target = clampTarget(options.perCategory);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const delayMs = Math.max(0, options.delayMs ?? 120);
  const maxPages = Math.max(1, Math.min(120, options.maxPages ?? 80));
  const rightsStatus: RightsStatus = options.rightsStatus === "pending" ? "pending" : "cleared";
  const dryRun = Boolean(options.dryRun);

  if (!categorySource(options.categorySlug)) {
    throw new Error(`No damplips source is configured for "${options.categorySlug}"`);
  }

  const report: CategoryImportReport = {
    category: options.categorySlug,
    categoryId: deps.categoryId,
    target,
    minimum: target,
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
    // A row is only worth importing when the watch page can stream a file
    // immediately. HLS and post pages would push that work onto the visitor.
    if (!detail.media || detail.media.kind !== "direct") return "missingMedia";

    // Prefer the URL the host actually answers, but never drop a parsed file
    // because a datacenter fetch was blocked — that is what left amateur at 0.
    const hostUrl = await fetchHostMedia(detail.media.url);
    const mediaUrl = hostUrl || detail.media.url;

    return saveCard({
      detail: { ...detail, media: { kind: "direct", url: mediaUrl } },
      thumbnailUrl,
    });
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

  // Live catalog only. A deleted row is not "already present" — the operator
  // wiped it and this run must import that damplips post again.
  const existingRows = await loadLiveDamplipsIdentities(deps.service);
  for (const row of existingRows) {
    claimed.add(row.provider_file_id);
    if (String(row.category_id) === String(deps.categoryId)) report.alreadyPresent += 1;
  }
  report.total = report.alreadyPresent;

  for (const sourceUrl of sourcePlan(options.categorySlug, baseUrl)) {
    if (report.imported >= target) break;
    const sourceReport: ImportSourceReport = { url: sourceUrl, pages: 0, cards: 0, imported: 0 };
    report.sources.push(sourceReport);
    const seenOnSource = new Set<string>();
    let pageUrl: string | null = sourceUrl;

    while (pageUrl && report.imported < target && sourceReport.pages < maxPages) {
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
      while (cursor < fresh.length && report.imported < target) {
        const remaining = target - report.imported;
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

      pageUrl =
        report.imported < target
          ? nextPageUrl || (fresh.length > 0 ? advanceSearchPage(page.url || pageUrl) : null)
          : null;
    }

    log(
      `${options.categorySlug}: ${sourceReport.imported} from ${sourceUrl}` +
        (sourceReport.error ? ` (${sourceReport.error})` : ""),
    );
  }

  report.fulfilled = report.imported >= target;
  if (!report.fulfilled && report.imported === 0) {
    log(`${options.categorySlug}: no new unique videos (already ${report.alreadyPresent} in catalog)`);
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
    fetchHostMedia?: FetchHostMedia;
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
          fetchHostMedia: deps.fetchHostMedia,
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
    minimum: perCategory,
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
