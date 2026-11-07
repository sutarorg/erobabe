import {
  embedUrlFor,
  parseSearchListing,
  parseVideoPage,
  pornhubSlug,
  searchUrl,
  watchUrlFor,
} from "./parse";
import { categorySource } from "./categories";
import type { FetchPornhubPage } from "./client";
import type { ImportService } from "@/lib/catalog/counts";

/**
 * Fills the erobabe catalog from Pornhub's public search.
 *
 * The importer embeds: a row stores the Pornhub viewkey, the poster the listing
 * advertises and the embed URL built from that viewkey. No bytes are copied,
 * transcoded or proxied.
 *
 * Three properties matter to the operator:
 *
 *  - **Unlimited.** There is no "videos per category" target and no cap. A run
 *    keeps paging until the search is exhausted; the caller asks for one slice
 *    at a time so a single request always finishes inside its timeout, and the
 *    returned cursor continues exactly where the previous slice stopped.
 *  - **No duplicates.** The viewkey is the identity. It is checked against the
 *    rows already in the catalog, against the rows of this run, and finally by
 *    a unique index in the database, so a race between two runs cannot create a
 *    second row for the same video.
 *  - **High quality.** A video is imported only when Pornhub marks it HD, or
 *    when its own watch page advertises a stream at least 720p tall. The
 *    listing's HD badge is trusted when the page has one; a page that carries no
 *    badge at all (markup change) falls back to checking the watch page rather
 *    than importing unknown-quality clips.
 */

/** Stored in `videos.provider` for every row this importer creates. */
export const PORNHUB_PROVIDER = "pornhub";

/** Search pages read by one HTTP request. Keeps each call inside its timeout. */
export const DEFAULT_PAGES_PER_REQUEST = 4;
/** Hard ceiling for one request when a caller asks for more. */
export const MAX_PAGES_PER_REQUEST = 25;

/** Below this, a clip is a teaser rather than a video worth cataloguing. */
export const MIN_DURATION_SECONDS = 60;

/** Shortest stream height that counts as high quality. */
export const MIN_HD_HEIGHT = 720;

/**
 * Consecutive all-duplicate pages after which the next search phrase is tried.
 *
 * Two searches ("milf" and "milf amateur") overlap heavily; once a page brings
 * nothing new for a while, paging deeper only spends requests on the same
 * videos again.
 */
export const DUPLICATE_PAGES_BEFORE_NEXT_SOURCE = 12;

/** Watch pages fetched to confirm quality when a listing carries no HD badge. */
export const MAX_QUALITY_CHECKS_PER_REQUEST = 25;

export type ImportCursor = {
  /** Index into the category's `searches` list. */
  source: number;
  /** 1-based search result page. */
  page: number;
};

export const INITIAL_CURSOR: ImportCursor = { source: 0, page: 1 };

export type RightsStatus = "cleared" | "pending";

export type PornhubImportOptions = {
  /** erobabe category slug (fixed taxonomy). */
  categorySlug: string;
  /** Where the previous slice stopped. Omit to start at the first result. */
  cursor?: ImportCursor;
  /** Search pages to read in this request. */
  pagesPerRequest?: number;
  /** Accept only videos known to be at least 720p. Default true. */
  requireHd?: boolean;
  /** Skip clips shorter than this. Default 60 seconds. */
  minDurationSeconds?: number;
  /** `pending` stages imports as private drafts for review. */
  rightsStatus?: RightsStatus;
  /** Resolve and report without writing to the catalog. */
  dryRun?: boolean;
  baseUrl?: string;
};

export type PornhubSkipped = {
  notHd: number;
  unknownQuality: number;
  short: number;
  noThumbnail: number;
  failed: number;
};

export type PornhubSample = {
  title: string;
  viewkey: string;
  embedUrl: string;
  thumbnailUrl: string;
  quality: "HD" | "4K" | null;
};

export type PornhubImportReport = {
  category: string;
  categoryId: string;
  imported: number;
  duplicates: number;
  skipped: PornhubSkipped;
  pagesRead: number;
  /** Where the next slice continues. Meaningful only while `exhausted` is false. */
  cursor: ImportCursor;
  exhausted: boolean;
  dryRun: boolean;
  errors: string[];
  samples: PornhubSample[];
};

export type PornhubImportDeps = {
  fetchPage: FetchPornhubPage;
  service: ImportService;
  /** erobabe category id, resolved by the caller from the fixed taxonomy. */
  categoryId: string;
  logger?: (message: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Politeness delay between page reads, in milliseconds. */
  delayMs?: number;
};

/** One catalog row, before it is inserted. */
type CatalogRow = {
  slug: string;
  title: string;
  description: string | null;
  category_id: string;
  thumbnail_url: string;
  provider: typeof PORNHUB_PROVIDER;
  provider_file_id: string;
  source_name: string;
  source_url: string;
  playable_url: null;
  embed_url: string;
  duration_seconds: number | null;
  quality: "HD" | "4K" | null;
  resolution: string | null;
  status: "published" | "pending_review";
  visibility: "public" | "private";
  rights_status: RightsStatus;
  moderation_status: "approved";
  requires_reupload: false;
  published_at: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** PostgREST caps an `in` filter at a few hundred values; batches stay well under. */
const IDENTITY_BATCH = 40;
/** Rows per insert statement. */
const INSERT_BATCH = 50;

function clampPages(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_PAGES_PER_REQUEST;
  return Math.min(MAX_PAGES_PER_REQUEST, Math.max(1, Math.floor(value)));
}

function normalizeCursor(cursor: ImportCursor | undefined, sourceCount: number): ImportCursor {
  const source = Number.isFinite(cursor?.source) ? Math.floor(Number(cursor?.source)) : 0;
  const page = Number.isFinite(cursor?.page) ? Math.floor(Number(cursor?.page)) : 1;
  if (source >= sourceCount) return { source: sourceCount, page: 1 };
  return { source: Math.max(0, source), page: Math.max(1, page) };
}

/** Viewkeys already in the catalog, so a slice never re-inserts one. */
async function existingViewkeys(
  service: ImportService,
  viewkeys: string[],
): Promise<{ found: Set<string>; error: string | null }> {
  const found = new Set<string>();
  for (let index = 0; index < viewkeys.length; index += IDENTITY_BATCH) {
    const batch = viewkeys.slice(index, index + IDENTITY_BATCH);
    const { data, error } = await service
      .from("videos")
      .select("provider_file_id")
      .eq("provider", PORNHUB_PROVIDER)
      .in("provider_file_id", batch);
    if (error) return { found, error: error.message || "Unable to read the catalog" };
    for (const row of (data || []) as Array<{ provider_file_id?: string | null }>) {
      if (row.provider_file_id) found.add(String(row.provider_file_id));
    }
  }
  return { found, error: null };
}

/**
 * Inserts one batch, counting rows the database already knew about.
 *
 * A conflict means someone else inserted the same viewkey between our read and
 * our write. That is not an error: the video is in the catalog either way, so it
 * is counted as a duplicate instead of failing the run.
 */
async function insertRows(
  service: ImportService,
  rows: CatalogRow[],
): Promise<{ inserted: number; duplicates: number; errors: string[] }> {
  let inserted = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (let index = 0; index < rows.length; index += INSERT_BATCH) {
    const batch = rows.slice(index, index + INSERT_BATCH);
    const { error } = await service.from("videos").insert(batch);
    if (!error) {
      inserted += batch.length;
      continue;
    }
    if (error.code !== "23505") {
      errors.push(error.message || "insert failed");
      continue;
    }
    // Rare path: retry row by row so one collision cannot drop the batch.
    for (const row of batch) {
      const { error: singleError } = await service.from("videos").insert(row);
      if (!singleError) inserted += 1;
      else if (singleError.code === "23505") duplicates += 1;
      else errors.push(`${row.source_url}: ${singleError.message || "insert failed"}`);
    }
  }

  return { inserted, duplicates, errors };
}

export async function importCategorySlice(
  options: PornhubImportOptions,
  deps: PornhubImportDeps,
): Promise<PornhubImportReport> {
  const log = deps.logger ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const delayMs = Math.max(0, deps.delayMs ?? 150);
  const sources = categorySource(options.categorySlug);
  if (!sources) {
    throw new Error(`No Pornhub source is configured for "${options.categorySlug}"`);
  }

  const baseUrl = (options.baseUrl || undefined) as string | undefined;
  const pagesPerRequest = clampPages(options.pagesPerRequest);
  const requireHd = options.requireHd !== false;
  const minDuration = Math.max(0, options.minDurationSeconds ?? MIN_DURATION_SECONDS);
  const rightsStatus: RightsStatus = options.rightsStatus === "pending" ? "pending" : "cleared";
  const dryRun = Boolean(options.dryRun);

  const report: PornhubImportReport = {
    category: options.categorySlug,
    categoryId: deps.categoryId,
    imported: 0,
    duplicates: 0,
    skipped: { notHd: 0, unknownQuality: 0, short: 0, noThumbnail: 0, failed: 0 },
    pagesRead: 0,
    cursor: { ...INITIAL_CURSOR },
    exhausted: false,
    dryRun,
    errors: [],
    samples: [],
  };

  let cursor = normalizeCursor(options.cursor, sources.searches.length);
  const claimed = new Set<string>();
  let qualityChecks = 0;
  let duplicatePagesInARow = 0;

  const publishedAt = rightsStatus === "cleared" ? now().toISOString() : null;

  /** Builds the row for an accepted card. */
  function toRow(card: {
    viewkey: string;
    title: string;
    thumbnailUrl: string;
    durationSeconds: number | null;
    quality: "HD" | "4K" | null;
    height: number | null;
    description: string | null;
  }): CatalogRow {
    return {
      slug: pornhubSlug(card.title, card.viewkey),
      title: card.title.slice(0, 240),
      description: card.description,
      category_id: deps.categoryId,
      thumbnail_url: card.thumbnailUrl,
      provider: PORNHUB_PROVIDER,
      provider_file_id: card.viewkey,
      source_name: PORNHUB_PROVIDER,
      source_url: watchUrlFor(card.viewkey),
      playable_url: null,
      embed_url: embedUrlFor(card.viewkey),
      duration_seconds: card.durationSeconds,
      quality: card.quality,
      resolution: card.height ? `${card.height}p` : null,
      status: rightsStatus === "cleared" ? "published" : "pending_review",
      visibility: rightsStatus === "cleared" ? "public" : "private",
      rights_status: rightsStatus,
      moderation_status: "approved",
      requires_reupload: false,
      published_at: publishedAt,
    };
  }

  while (report.pagesRead < pagesPerRequest && cursor.source < sources.searches.length) {
    const phrase = sources.searches[cursor.source];
    const url = searchUrl(phrase, cursor.page, baseUrl);
    let html = "";
    try {
      if (delayMs) await sleep(delayMs);
      html = (await deps.fetchPage(url)).html;
    } catch (error) {
      report.errors.push(
        `${url}: ${error instanceof Error ? error.message : "unreadable search page"}`,
      );
      // A blocked or broken search phrase must not trap the run on one page.
      cursor = { source: cursor.source + 1, page: 1 };
      duplicatePagesInARow = 0;
      continue;
    }

    report.pagesRead += 1;
    const listing = parseSearchListing(html, url);

    if (!listing.cards.length) {
      // No results left on this phrase: try the next one.
      cursor = { source: cursor.source + 1, page: 1 };
      duplicatePagesInARow = 0;
      continue;
    }

    const accepted: Array<Parameters<typeof toRow>[0]> = [];
    let duplicatesOnPage = 0;

    for (const card of listing.cards) {
      if (claimed.has(card.viewkey)) {
        duplicatesOnPage += 1;
        continue;
      }
      claimed.add(card.viewkey);

      if (!card.title || !card.thumbnailUrl) {
        report.skipped.noThumbnail += 1;
        continue;
      }
      if (card.durationSeconds != null && card.durationSeconds < minDuration) {
        report.skipped.short += 1;
        continue;
      }

      let quality: "HD" | "4K" | null = card.hd ? "HD" : null;
      let height: number | null = null;
      let title = card.title;
      let thumbnailUrl = card.thumbnailUrl;
      let durationSeconds = card.durationSeconds;
      let description: string | null = null;

      if (card.hd === true) {
        // The listing says HD; nothing else needs fetching.
      } else if (listing.hdSignal) {
        // This page labels videos and this one was not labelled: it is not HD.
        if (requireHd) {
          report.skipped.notHd += 1;
          continue;
        }
      } else if (!requireHd) {
        // Quality is not a requirement and the page offers no badge.
      } else if (qualityChecks < MAX_QUALITY_CHECKS_PER_REQUEST) {
        // No HD badge anywhere on the page (markup change). Ask the watch page,
        // which always lists the streams it can serve.
        qualityChecks += 1;
        try {
          if (delayMs) await sleep(delayMs);
          const detailPage = await deps.fetchPage(watchUrlFor(card.viewkey));
          const detail = parseVideoPage(detailPage.html, card.viewkey);
          if (detail) {
            height = detail.maxHeight;
            title = detail.title || title;
            thumbnailUrl = detail.thumbnailUrl || thumbnailUrl;
            durationSeconds = detail.durationSeconds ?? durationSeconds;
            description = detail.description;
          }
        } catch (error) {
          report.errors.push(
            `${card.viewkey}: ${error instanceof Error ? error.message : "unreadable video page"}`,
          );
        }

        if (height != null && height >= MIN_HD_HEIGHT) {
          quality = height >= 2160 ? "4K" : "HD";
        } else if (height == null) {
          report.skipped.unknownQuality += 1;
          continue;
        } else {
          report.skipped.notHd += 1;
          continue;
        }
      } else {
        // Quality checks are spent for this request; the next slice retries.
        report.skipped.unknownQuality += 1;
        continue;
      }

      accepted.push({
        viewkey: card.viewkey,
        title,
        thumbnailUrl,
        durationSeconds,
        quality,
        height,
        description,
      });
    }

    // How many videos on this page were genuinely new to the catalog. A search
    // that keeps returning pages of already-imported videos is finished, no
    // matter what its pagination says.
    let insertedOnPage = 0;

    if (accepted.length) {
      if (dryRun) {
        insertedOnPage = accepted.length;
        report.imported += accepted.length;
      } else {
        const existing = await existingViewkeys(
          deps.service,
          accepted.map((card) => card.viewkey),
        );
        if (existing.error) report.errors.push(existing.error);
        const fresh = accepted.filter((card) => !existing.found.has(card.viewkey));
        duplicatesOnPage += accepted.length - fresh.length;
        if (fresh.length) {
          const result = await insertRows(
            deps.service,
            fresh.map((card) => toRow(card)),
          );
          insertedOnPage = result.inserted;
          report.imported += result.inserted;
          duplicatesOnPage += result.duplicates;
          report.errors.push(...result.errors);
        }
      }

      for (const card of accepted) {
        if (report.samples.length >= 5) break;
        report.samples.push({
          title: card.title,
          viewkey: card.viewkey,
          embedUrl: embedUrlFor(card.viewkey),
          thumbnailUrl: card.thumbnailUrl,
          quality: card.quality,
        });
      }
    }

    report.duplicates += duplicatesOnPage;
    duplicatePagesInARow = insertedOnPage > 0 ? 0 : duplicatePagesInARow + 1;

    if (duplicatePagesInARow >= DUPLICATE_PAGES_BEFORE_NEXT_SOURCE) {
      log(`${options.categorySlug}: “${phrase}” has nothing new left; moving on`);
      cursor = { source: cursor.source + 1, page: 1 };
      duplicatePagesInARow = 0;
      continue;
    }

    const nextPage = cursor.page + 1;
    cursor =
      listing.totalPages != null && nextPage > listing.totalPages
        ? { source: cursor.source + 1, page: 1 }
        : { source: cursor.source, page: nextPage };
  }

  report.cursor = cursor;
  report.exhausted = cursor.source >= sources.searches.length;

  log(
    `${options.categorySlug}: +${report.imported} imported, ${report.duplicates} already known, ` +
      `${report.pagesRead} page(s)${report.exhausted ? ", search exhausted" : ""}`,
  );

  return report;
}
