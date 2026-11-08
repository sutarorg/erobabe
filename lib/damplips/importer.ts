import {
  DAMPLIPS_BASE_URL,
  damplipsSlug,
  looksLikePoster,
  nextListingPage,
  parseListing,
  parseVideoPage,
  type DamplipsCard,
  type DamplipsDetail,
} from "./parse";
import { categorySource, matchesCategory, sourcePlan } from "./categories";
import type { FetchDamplipsPage } from "./client";
import { fetchHostMediaUrl, type FetchHostMedia } from "./host-media";
import type { ImportService } from "@/lib/catalog/counts";

/**
 * Fills the erobabe catalog from damplips.com.
 *
 * Nothing is uploaded or copied. Each catalog row stores the damplips post page,
 * the poster the page advertises and the media file the page itself serves,
 * which the player then reads.
 *
 * What the operator asked for, and how this file delivers it:
 *
 *  - **100 videos a round.** A call to `importCategorySlice` does not count
 *    *pages read*; it counts **rows written**. It keeps reading listings and
 *    opening post pages until 100 new videos are in the catalog, skipping over
 *    everything already imported, every teaser and every post without a poster.
 *    A round that would stop short is extended with more listings, the related
 *    videos of the posts it just read, and finally the site's newest archives —
 *    so "+0 new" is not a round outcome while there is anything left to find.
 *  - **Fast.** Post pages are opened concurrently, listing ids are checked
 *    against the catalog in one batched query per page, rows are inserted in
 *    batches, and no media host is probed per video (the files are already on a
 *    host the player streams from). A round of 100 is seconds, not minutes.
 *  - **Still unlimited, still popular-first.** There is no cap: the cursor hands
 *    back exactly where this call stopped, so the panel (or the cron route) can
 *    call again for as long as the operator wants. Popular feeds are walked
 *    before taxonomy pages, searches and the newest archives.
 *  - **A poster on every row.** A post whose page advertises no usable poster is
 *    skipped instead of imported blank, and `repairThumbnails` fixes rows stored
 *    before that rule existed.
 *  - **No duplicates.** The damplips post id is the identity. It is claimed for
 *    the run before its page is fetched, checked against the catalog in
 *    batches, and finally enforced by the unique index
 *    `videos_damplips_identity_idx`.
 *  - **Nothing is misfiled.** A video found through a category that does not
 *    actually belong to it is still imported — with `category_id = null`, so it
 *    shows up in the catalog with no category tag instead of under a category it
 *    is not part of.
 */

/** Stored in `videos.provider` for every row this importer creates. */
export const DAMPLIPS_PROVIDER = "damplips";

/** New rows one call aims to write. The operator's "100 videos a round". */
export const IMPORT_TARGET = 100;
/** Ceiling for a caller that asks for a bigger round. */
export const MAX_IMPORT_TARGET = 400;

/** Listing pages read by one call, unless the target is reached sooner. */
export const DEFAULT_PAGES_PER_REQUEST = 12;
/** Hard ceiling for one call when a caller asks for more. */
export const MAX_PAGES_PER_REQUEST = 60;

/**
 * Post pages one call may open.
 *
 * This is a safety valve, not a quota: a post page is the real cost of a round,
 * and a round of 100 normally needs well under 200 of them. The slice stops on
 * the target long before it stops on this number.
 */
export const DEFAULT_POSTS_PER_REQUEST = 400;
export const MAX_POSTS_PER_REQUEST = 600;

/** Post pages opened at the same time. Six keeps a round of 100 to seconds. */
export const POST_CONCURRENCY = 6;
export const MAX_POST_CONCURRENCY = 10;

/** Related-video ids kept in the cursor, so the frontier survives a slice. */
export const MAX_DISCOVERY_QUEUE = 160;

/** Rows written in one insert. */
const INSERT_BATCH = 25;

/** Below this, a clip is a teaser rather than a video worth cataloguing. */
export const MIN_DURATION_SECONDS = 60;

/** Rows `repairThumbnails` may fix in one call. */
export const MAX_POSTER_REPAIRS = 10;

/**
 * Soft deadline for one call.
 *
 * The routes allow 300 s; stopping a little before that leaves room to answer
 * with a cursor. A run that reaches it simply continues in the next call — it
 * never ends because of it.
 */
export const DEFAULT_TIME_BUDGET_MS = 200_000;

export type RightsStatus = "cleared" | "pending";

export type ImportCursor = {
  /** Index into the category's source plan (popular → taxonomy → search → latest). */
  source: number;
  /** 1-based listing page within that source. */
  page: number;
  /** Candidates already handled on that page, so a slice resumes mid-page. */
  skip: number;
  /**
   * The exact listing URL the next slice must read. damplips' pagination is not
   * uniform (`rel=next`, `/page/2/`, `?paged=2`), so the resolved URL travels in
   * the cursor instead of being guessed from a page number.
   */
  url?: string;
  /**
   * Related-video post ids discovered but not opened yet.
   *
   * Every post page links to others; those links are new ids no listing shows,
   * and keeping them in the cursor is what keeps a long run finding videos after
   * a category's own listings have been walked.
   */
  queue?: string[];
};

export const INITIAL_CURSOR: ImportCursor = { source: 0, page: 1, skip: 0 };

export type DamplipsImportOptions = {
  /** erobabe category slug (fixed taxonomy). */
  categorySlug: string;
  /** Where the previous slice stopped. Omit to start at the first listing. */
  cursor?: ImportCursor;
  /** New rows this call aims to write. Defaults to 100. */
  importTarget?: number;
  /** Listing pages to read in this call. */
  pagesPerRequest?: number;
  /** Post pages this call may open before it hands back a cursor. */
  postsPerRequest?: number;
  /** Post pages opened at the same time. */
  concurrency?: number;
  /** Soft deadline for this call, in milliseconds. */
  timeBudgetMs?: number;
  /** Skip clips whose published duration is shorter than this. */
  minDurationSeconds?: number;
  /** `pending` stages imports as private drafts for review. */
  rightsStatus?: RightsStatus;
  /** Resolve and report without writing to the catalog. */
  dryRun?: boolean;
  /** Repair stored rows whose poster is missing before importing. */
  repair?: boolean;
  /**
   * Ask the media host for the file before storing its URL.
   *
   * Off by default: it is one extra request per video, the URL was already
   * parsed from a page that serves it, and the same-origin stream proxy follows
   * any redirect at playback time. Turn it on to re-resolve an origin.
   */
  verifyMedia?: boolean;
  baseUrl?: string;
};

export type DamplipsSkipped = {
  missingMedia: number;
  missingThumbnail: number;
  short: number;
  failed: number;
};

export type DamplipsSample = {
  title: string;
  sourceId: string;
  sourceUrl: string;
  thumbnailUrl: string;
  mediaUrl: string;
  /** False when the video was imported with no category. */
  categorised?: boolean;
};

export type DamplipsSourceReport = {
  label: string;
  url: string;
  kind: "popular" | "taxonomy" | "search" | "latest";
  pages: number;
  posts: number;
  imported: number;
  /** False when the site does not serve this listing (a probed popular feed). */
  found: boolean;
  error?: string;
};

export type DamplipsImportReport = {
  category: string;
  categoryId: string;
  /** New rows written by this call. */
  imported: number;
  /** New rows this call was aiming for. */
  target: number;
  /** Rows written with no category, because the video is not from this category. */
  uncategorised: number;
  duplicates: number;
  /** Stored rows whose missing poster was resolved during this slice. */
  repaired: number;
  skipped: DamplipsSkipped;
  pagesRead: number;
  postsRead: number;
  /** Where the next slice continues. */
  cursor: ImportCursor;
  /**
   * Every listing in the plan has been walked, the related frontier is empty and
   * the target was not reached. A new pass may begin; nothing was left unread.
   */
  exhausted: boolean;
  /** True when the call stopped because it had written `target` new rows. */
  targetReached: boolean;
  dryRun: boolean;
  errors: string[];
  sources: DamplipsSourceReport[];
  samples: DamplipsSample[];
};

export type DamplipsImportDeps = {
  fetchPage: FetchDamplipsPage;
  service: ImportService;
  /** erobabe category id, resolved by the caller from the fixed taxonomy. */
  categoryId: string;
  /**
   * Hits the media host so the stored URL is already the file a browser can
   * play. Only used when `verifyMedia` is on.
   */
  fetchHostMedia?: FetchHostMedia;
  /** Post ids used by this run, shared across categories. */
  claimed?: Set<string>;
  logger?: (message: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Politeness delay between read batches, in milliseconds. */
  delayMs?: number;
};

/** One catalog row, before it is inserted. */
type CatalogRow = {
  slug: string;
  title: string;
  description: string | null;
  category_id: string | null;
  thumbnail_url: string;
  provider: typeof DAMPLIPS_PROVIDER;
  provider_file_id: string;
  source_name: string;
  source_url: string;
  playable_url: string | null;
  embed_url: string | null;
  duration_seconds: number | null;
  quality: "HD" | "4K" | null;
  resolution: string | null;
  view_count: number;
  status: "published" | "pending_review";
  visibility: "public" | "private";
  rights_status: RightsStatus;
  moderation_status: "approved";
  requires_reupload: false;
  published_at: string | null;
};

/** A post the importer is about to open. From a listing card or the frontier. */
type PostCandidate = {
  sourceId: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** PostgREST caps an `in` filter at a few hundred values; batches stay well under. */
const IDENTITY_BATCH = 40;
/** Rows scanned when looking for stored posters that are not posters at all. */
const POSTER_SCAN_LIMIT = 500;

function clampPages(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_PAGES_PER_REQUEST;
  return Math.min(MAX_PAGES_PER_REQUEST, Math.max(1, Math.floor(value)));
}

function clampPosts(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_POSTS_PER_REQUEST;
  return Math.min(MAX_POSTS_PER_REQUEST, Math.max(1, Math.floor(value)));
}

function clampTarget(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return IMPORT_TARGET;
  return Math.min(MAX_IMPORT_TARGET, Math.max(1, Math.floor(value)));
}

function clampConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return POST_CONCURRENCY;
  return Math.min(MAX_POST_CONCURRENCY, Math.max(1, Math.floor(value)));
}

function normaliseQueue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = String(entry ?? "").trim();
    if (/^\d{1,12}$/.test(id) && !seen.has(id)) seen.add(id);
    if (seen.size >= MAX_DISCOVERY_QUEUE) break;
  }
  return [...seen];
}

function normalizeCursor(cursor: ImportCursor | undefined, planLength: number): ImportCursor {
  const source = Number.isFinite(cursor?.source) ? Math.floor(Number(cursor?.source)) : 0;
  const page = Number.isFinite(cursor?.page) ? Math.floor(Number(cursor?.page)) : 1;
  const skip = Number.isFinite(cursor?.skip) ? Math.floor(Number(cursor?.skip)) : 0;
  const url = typeof cursor?.url === "string" && cursor.url ? cursor.url : undefined;
  const queue = normaliseQueue(cursor?.queue);
  const queued = queue.length ? { queue } : {};
  if (source >= planLength) return { source: planLength, page: 1, skip: 0, ...queued };
  return {
    source: Math.max(0, source),
    page: Math.max(1, page),
    skip: Math.max(0, skip),
    ...(url ? { url } : {}),
    ...queued,
  };
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Post ids already in the catalog, so a slice never re-imports one. */
async function existingPostIds(
  service: ImportService,
  ids: string[],
): Promise<{ found: Set<string>; error: string | null }> {
  const found = new Set<string>();
  for (let index = 0; index < ids.length; index += IDENTITY_BATCH) {
    const batch = ids.slice(index, index + IDENTITY_BATCH);
    const { data, error } = await service
      .from("videos")
      .select("provider_file_id")
      .eq("provider", DAMPLIPS_PROVIDER)
      .in("provider_file_id", batch);
    if (error) return { found, error: error.message || "Unable to read the catalog" };
    for (const row of (data || []) as Array<{ provider_file_id?: string | null }>) {
      if (row.provider_file_id) found.add(String(row.provider_file_id));
    }
  }
  return { found, error: null };
}

/** Every live damplips post id, so a full run knows the catalogue up front. */
export async function loadLiveDamplipsIdentities(service: ImportService): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    let query = service
      .from("videos")
      .select("provider_file_id")
      .eq("provider", DAMPLIPS_PROVIDER);
    if (typeof query.range === "function") query = query.range(from, from + pageSize - 1);
    const { data, error } = await query;
    if (error) throw new Error(error.message || "Unable to read the catalog");
    const batch = (data || []) as Array<{ provider_file_id?: string | null }>;
    for (const row of batch) if (row.provider_file_id) ids.push(String(row.provider_file_id));
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

/** True when a stored value is a poster URL the grid can display. */
export { looksLikePoster };

type StoredRow = { id: string; provider_file_id: string | null; thumbnail_url: string | null };

/**
 * Resolves the real poster for stored damplips rows that have none.
 *
 * A row imported before the poster rule existed — or whose page advertised only
 * a GIF or a placeholder — shows a blank card, which is exactly the "thumbnails
 * are not visible" symptom. The post page always publishes an `og:image`, so the
 * poster is read from there and written back. Nothing else on the row changes.
 */
export async function repairThumbnails(
  deps: {
    service: ImportService;
    fetchPage: FetchDamplipsPage;
    logger?: (message: string) => void;
    sleep?: (ms: number) => Promise<void>;
    delayMs?: number;
  },
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<{ repaired: number; failed: number }> {
  const limit = Math.max(0, Math.min(MAX_POSTER_REPAIRS, options.limit ?? MAX_POSTER_REPAIRS));
  if (!limit) return { repaired: 0, failed: 0 };
  const sleep = deps.sleep ?? defaultSleep;
  const delayMs = Math.max(0, deps.delayMs ?? 120);
  const log = deps.logger ?? (() => {});

  const candidates = new Map<string, StoredRow>();
  const collect = (rows: StoredRow[] | null) => {
    for (const row of rows || []) {
      if (row.id && row.provider_file_id && !candidates.has(row.id)) candidates.set(row.id, row);
    }
  };

  // Two shapes of broken: no poster at all, and a value that is not an image.
  const missing = await deps.service
    .from("videos")
    .select("id, provider_file_id, thumbnail_url")
    .eq("provider", DAMPLIPS_PROVIDER)
    .is("thumbnail_url", null)
    .limit(limit);
  if (missing.error) log(`poster repair: ${missing.error.message}`);
  else collect(missing.data as unknown as StoredRow[]);

  if (candidates.size < limit) {
    const window = await deps.service
      .from("videos")
      .select("id, provider_file_id, thumbnail_url")
      .eq("provider", DAMPLIPS_PROVIDER)
      .not("thumbnail_url", "is", null)
      .order("id", { ascending: true })
      .limit(POSTER_SCAN_LIMIT);
    if (window.error) log(`poster repair: ${window.error.message}`);
    else collect(window.data as unknown as StoredRow[]);
  }

  const broken = [...candidates.values()]
    .filter((row) => row.provider_file_id && !looksLikePoster(row.thumbnail_url))
    .slice(0, limit);

  let repaired = 0;
  let failed = 0;
  for (const row of broken) {
    try {
      if (delayMs) await sleep(delayMs);
      const page = await deps.fetchPage(`${DAMPLIPS_BASE_URL}/p/${row.provider_file_id}/`);
      const detail = parseVideoPage(page.html, page.url);
      if (!detail?.thumbnailUrl || !looksLikePoster(detail.thumbnailUrl)) {
        failed += 1;
        continue;
      }
      if (options.dryRun) {
        repaired += 1;
        continue;
      }
      const { error } = await deps.service
        .from("videos")
        .update({ thumbnail_url: detail.thumbnailUrl })
        .eq("id", row.id);
      if (error) failed += 1;
      else repaired += 1;
    } catch {
      failed += 1;
    }
  }

  if (repaired) log(`poster repair: ${repaired} row(s) now have a poster`);
  return { repaired, failed };
}

/** What examining one post page produced. */
type Examined = {
  candidate: PostCandidate;
  outcome: "row" | "duplicate" | "missingMedia" | "missingThumbnail" | "short" | "failed";
  row?: CatalogRow;
  related: string[];
};

export async function importCategorySlice(
  options: DamplipsImportOptions,
  deps: DamplipsImportDeps,
): Promise<DamplipsImportReport> {
  const log = deps.logger ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const fetchHostMedia = deps.fetchHostMedia ?? fetchHostMediaUrl;
  const claimed = deps.claimed ?? new Set<string>();
  const delayMs = Math.max(0, deps.delayMs ?? 40);

  if (!categorySource(options.categorySlug)) {
    throw new Error(`No damplips source is configured for "${options.categorySlug}"`);
  }

  const baseUrl = (options.baseUrl || DAMPLIPS_BASE_URL).replace(/\/$/, "");
  const plan = sourcePlan(options.categorySlug, baseUrl);
  const pagesPerRequest = clampPages(options.pagesPerRequest);
  const postsPerRequest = clampPosts(options.postsPerRequest);
  const importTarget = clampTarget(options.importTarget);
  const concurrency = clampConcurrency(options.concurrency);
  const timeBudgetMs = Math.max(5_000, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const deadline = Date.now() + timeBudgetMs;
  const minDuration = Math.max(0, options.minDurationSeconds ?? MIN_DURATION_SECONDS);
  const rightsStatus: RightsStatus = options.rightsStatus === "pending" ? "pending" : "cleared";
  const dryRun = Boolean(options.dryRun);
  const verifyMedia = options.verifyMedia === true;

  const report: DamplipsImportReport = {
    category: options.categorySlug,
    categoryId: deps.categoryId,
    imported: 0,
    target: importTarget,
    uncategorised: 0,
    duplicates: 0,
    repaired: 0,
    skipped: { missingMedia: 0, missingThumbnail: 0, short: 0, failed: 0 },
    pagesRead: 0,
    postsRead: 0,
    cursor: { ...INITIAL_CURSOR },
    exhausted: false,
    targetReached: false,
    dryRun,
    errors: [],
    sources: [],
    samples: [],
  };

  // Rows stored before the poster rule existed are fixed first: the operator
  // sees the grid fill in with pictures, not just with rows.
  if (options.repair) {
    const repair = await repairThumbnails(
      { service: deps.service, fetchPage: deps.fetchPage, logger: log, sleep, delayMs },
      { dryRun },
    );
    report.repaired = repair.repaired;
  }

  let cursor = normalizeCursor(options.cursor, plan.length);
  const publishedAt = rightsStatus === "cleared" ? now().toISOString() : null;
  const queue: string[] = [...(cursor.queue ?? [])];
  const queued = new Set<string>(queue);
  const knownInCatalog = new Set<string>();

  const timeLeft = () => Date.now() < deadline;
  const wanted = () => report.imported < importTarget;

  /**
   * Post pages taken per wave.
   *
   * Wide enough that rows are inserted in batches rather than one at a time,
   * narrow enough that a round never overshoots its target by more than one
   * concurrency window, and never past the post budget.
   */
  function waveSize(): number {
    const remainingPosts = postsPerRequest - report.postsRead;
    const remainingTarget = Math.max(concurrency, importTarget - report.imported);
    return Math.max(1, Math.min(concurrency * 4, remainingPosts, remainingTarget));
  }

  function enqueueRelated(ids: string[]) {
    for (const id of ids) {
      if (queue.length >= MAX_DISCOVERY_QUEUE) return;
      if (claimed.has(id) || queued.has(id)) continue;
      queue.push(id);
      queued.add(id);
    }
  }

  function toRow(detail: DamplipsDetail, thumbnailUrl: string, categoryId: string | null): CatalogRow {
    const media = detail.media!;
    const height = detail.maxHeight;
    return {
      slug: damplipsSlug(detail.title, detail.sourceId),
      title: detail.title.slice(0, 240),
      description: detail.description,
      category_id: categoryId,
      thumbnail_url: thumbnailUrl,
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: detail.sourceId,
      source_name: DAMPLIPS_PROVIDER,
      source_url: detail.sourceUrl,
      playable_url: media.kind === "direct" ? media.url : null,
      embed_url: media.kind === "embed" ? media.url : null,
      duration_seconds: detail.durationSeconds,
      quality: height != null && height >= 2160 ? "4K" : height != null && height >= 720 ? "HD" : null,
      resolution: height ? `${height}p` : null,
      view_count: detail.views ?? 0,
      status: rightsStatus === "cleared" ? "published" : "pending_review",
      visibility: rightsStatus === "cleared" ? "public" : "private",
      rights_status: rightsStatus,
      moderation_status: "approved",
      requires_reupload: false,
      published_at: publishedAt,
    };
  }

  /** Reads one post page and turns it into a catalog row (or a skip reason). */
  async function examine(candidate: PostCandidate): Promise<Examined> {
    let detail: DamplipsDetail | null;
    try {
      const page = await deps.fetchPage(candidate.sourceUrl);
      detail = parseVideoPage(page.html, page.url || candidate.sourceUrl);
    } catch (error) {
      report.errors.push(
        `${candidate.sourceUrl}: ${error instanceof Error ? error.message : "unreadable post page"}`,
      );
      return { candidate, outcome: "failed", related: [] };
    }
    report.postsRead += 1;

    if (!detail) {
      report.errors.push(`${candidate.sourceUrl}: no title on the post page`);
      return { candidate, outcome: "failed", related: [] };
    }

    const related = detail.relatedIds;

    // A row is only worth importing when the watch page can stream a file
    // immediately. Playlists and post pages would push that work onto the
    // visitor.
    if (!detail.media || detail.media.kind !== "direct") {
      return { candidate, outcome: "missingMedia", related };
    }

    const thumbnailUrl = [detail.thumbnailUrl, candidate.thumbnailUrl].find(
      (value): value is string => Boolean(value) && looksLikePoster(value),
    );
    if (!thumbnailUrl) return { candidate, outcome: "missingThumbnail", related };

    if (detail.durationSeconds != null && detail.durationSeconds < minDuration) {
      return { candidate, outcome: "short", related };
    }

    const mediaUrl = verifyMedia
      ? (await fetchHostMedia(detail.media.url)) || detail.media.url
      : detail.media.url;
    const resolved: DamplipsDetail = { ...detail, media: { kind: "direct", url: mediaUrl } };

    // Filed under the selected category only when the video really belongs to
    // it; anything else is imported with no category rather than mislabelled.
    const categorised = matchesCategory(options.categorySlug, {
      title: detail.title,
      categorySlugs: detail.categorySlugs,
      tags: detail.tags,
    });
    const categoryId = categorised ? deps.categoryId : null;

    return {
      candidate,
      outcome: "row",
      row: toRow(resolved, thumbnailUrl, categoryId),
      related,
    };
  }

  /** Writes prepared rows, salvaging the survivors of a unique-index clash. */
  async function writeRows(rows: CatalogRow[]): Promise<void> {
    for (const batch of chunk(rows, INSERT_BATCH)) {
      if (dryRun) {
        report.imported += batch.length;
        report.uncategorised += batch.filter((row) => row.category_id === null).length;
        continue;
      }
      const { error } = await deps.service.from("videos").insert(batch);
      if (!error) {
        report.imported += batch.length;
        report.uncategorised += batch.filter((row) => row.category_id === null).length;
        continue;
      }
      if (error.code !== "23505") {
        report.skipped.failed += batch.length;
        report.errors.push(`${error.message || "insert failed"} (${batch.length} row(s))`);
        continue;
      }
      // One row in the batch is already in the catalog: insert the rest one by
      // one so a single race does not cost the whole batch.
      for (const row of batch) {
        const { error: rowError } = await deps.service.from("videos").insert(row);
        if (!rowError) {
          report.imported += 1;
          if (row.category_id === null) report.uncategorised += 1;
        } else if (rowError.code === "23505") {
          report.duplicates += 1;
        } else {
          report.skipped.failed += 1;
          report.errors.push(`${row.source_url}: ${rowError.message || "insert failed"}`);
        }
      }
    }
  }

  /**
   * Opens a batch of post pages concurrently and writes what they produce.
   *
   * Returns how many new rows this batch wrote, so the listing that produced
   * them can report its own share of the round.
   */
  async function process(candidates: PostCandidate[]): Promise<number> {
    if (!candidates.length) return 0;
    const importedBefore = report.imported;

    // One batched read tells us which of these posts are already catalogued, so
    // a round spends its post pages on new videos only.
    const unchecked = candidates
      .map((candidate) => candidate.sourceId)
      .filter((id) => !claimed.has(id) && !knownInCatalog.has(id));
    if (unchecked.length && !dryRun) {
      const lookup = await existingPostIds(deps.service, unchecked);
      if (lookup.error) report.errors.push(lookup.error);
      for (const id of lookup.found) knownInCatalog.add(id);
    }

    const fresh: PostCandidate[] = [];
    for (const candidate of candidates) {
      if (claimed.has(candidate.sourceId) || knownInCatalog.has(candidate.sourceId)) {
        report.duplicates += 1;
        claimed.add(candidate.sourceId);
        continue;
      }
      claimed.add(candidate.sourceId);
      fresh.push(candidate);
    }
    if (!fresh.length) return 0;

    const examined = await mapPool(fresh, concurrency, async (candidate) => {
      if (delayMs) await sleep(delayMs);
      return examine(candidate);
    });

    const rows: CatalogRow[] = [];
    for (const result of examined) {
      enqueueRelated(result.related);
      switch (result.outcome) {
        case "row":
          if (result.row) rows.push(result.row);
          break;
        case "duplicate":
          report.duplicates += 1;
          break;
        case "missingMedia":
          report.skipped.missingMedia += 1;
          break;
        case "missingThumbnail":
          report.skipped.missingThumbnail += 1;
          break;
        case "short":
          report.skipped.short += 1;
          break;
        default:
          report.skipped.failed += 1;
      }
    }

    await writeRows(rows);

    if (dryRun) {
      for (const result of examined) {
        if (result.outcome !== "row" || !result.row) continue;
        if (report.samples.length >= 5) break;
        report.samples.push({
          title: result.row.title,
          sourceId: result.row.provider_file_id,
          sourceUrl: result.row.source_url,
          thumbnailUrl: result.row.thumbnail_url,
          mediaUrl: result.row.playable_url ?? result.row.embed_url ?? "",
          categorised: result.row.category_id !== null,
        });
      }
    }

    return report.imported - importedBefore;
  }

  const sourceReport = (index: number): DamplipsSourceReport => {
    const existing = report.sources.find((entry) => entry.url === plan[index].url);
    if (existing) return existing;
    const created: DamplipsSourceReport = {
      label: plan[index].label,
      url: plan[index].url,
      kind: plan[index].kind,
      pages: 0,
      posts: 0,
      imported: 0,
      found: false,
    };
    report.sources.push(created);
    return created;
  };

  // The round: keep going until 100 rows are written, the frontier and every
  // listing have been walked, or the soft deadline is reached.
  while (wanted() && timeLeft()) {
    // 1. The related frontier first: those ids are already known to exist and
    //    are the cheapest way to keep a round moving after a listing is used up.
    if (queue.length) {
      if (report.postsRead >= postsPerRequest) break;
      const batch = queue.splice(0, Math.min(waveSize(), queue.length));
      const candidates = batch.map((id) => {
        queued.delete(id);
        return {
          sourceId: id,
          sourceUrl: `${baseUrl}/p/${id}/`,
          title: "",
          thumbnailUrl: null,
        };
      });
      await process(candidates);
      // A site that answers every page with an error would otherwise keep this
      // call busy; the caller gets the cursor and can try again later.
      if (report.errors.length >= 50) break;
      continue;
    }

    // 2. Otherwise read the next listing page of the category's plan.
    if (cursor.source >= plan.length) break;
    if (report.pagesRead >= pagesPerRequest || report.postsRead >= postsPerRequest) break;

    const source = plan[cursor.source];
    const reportForSource = sourceReport(cursor.source);
    const pageUrl: string = cursor.url || source.url;

    let page;
    try {
      if (delayMs) await sleep(delayMs);
      page = await deps.fetchPage(pageUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreadable listing";
      // A probed popular feed the site does not serve is not an error.
      if (!source.quiet) reportForSource.error = message;
      reportForSource.found = false;
      cursor = { source: cursor.source + 1, page: 1, skip: 0 };
      continue;
    }

    report.pagesRead += 1;
    reportForSource.pages += 1;

    const { cards } = parseListing(page.html, page.url || pageUrl);
    if (!cards.length) {
      if (!source.quiet) {
        reportForSource.error =
          reportForSource.pages === 1 ? "No video cards on this listing" : "No more cards";
      }
      cursor = { source: cursor.source + 1, page: 1, skip: 0 };
      continue;
    }
    reportForSource.found = true;

    // Resume mid-page: a round may stop after a handful of post reads.
    const startAt = Math.min(cursor.skip, cards.length);
    const remaining: DamplipsCard[] = cards.slice(startAt);

    let consumed = 0;
    for (const batch of chunk(remaining, waveSize())) {
      if (!wanted() || report.postsRead >= postsPerRequest || !timeLeft()) break;
      const produced = await process(
        batch.map((card) => ({
          sourceId: card.sourceId,
          sourceUrl: card.sourceUrl,
          title: card.title,
          thumbnailUrl: card.thumbnailUrl,
        })),
      );
      consumed += batch.length;
      reportForSource.posts += batch.length;
      reportForSource.imported += produced;
      if (report.errors.length >= 50) break;
    }

    if (startAt + consumed < cards.length) {
      // The round stopped in the middle of this page: resume exactly here.
      cursor = { source: cursor.source, page: cursor.page, skip: startAt + consumed, url: pageUrl };
      break;
    }

    const next = nextListingPage(page.url || pageUrl, page.html);
    cursor = next
      ? { source: cursor.source, page: cursor.page + 1, skip: 0, url: next }
      : { source: cursor.source + 1, page: 1, skip: 0 };
  }

  report.targetReached = report.imported >= importTarget;
  report.exhausted = !report.targetReached && cursor.source >= plan.length && queue.length === 0;
  report.cursor = {
    ...cursor,
    ...(queue.length ? { queue: queue.slice(0, MAX_DISCOVERY_QUEUE) } : {}),
  };

  log(
    `${options.categorySlug}: +${report.imported}/${importTarget} imported` +
      (report.uncategorised ? ` (${report.uncategorised} with no category)` : "") +
      `, ${report.duplicates} already known, ${report.postsRead} post page(s)` +
      (report.exhausted ? ", every listing walked" : ""),
  );

  return report;
}
