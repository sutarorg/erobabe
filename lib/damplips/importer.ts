import {
  DAMPLIPS_BASE_URL,
  damplipsSlug,
  looksLikePoster,
  nextListingPage,
  parseListing,
  parseVideoPage,
} from "./parse";
import { categorySource, sourcePlan } from "./categories";
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
 * Four properties matter to the operator:
 *
 *  - **Unlimited.** There is no "videos per category" target and no cap. A run
 *    keeps going until the operator presses Stop; a slice boundary exists only
 *    so one HTTP request always finishes inside its timeout, and the returned
 *    cursor continues exactly where the previous slice stopped.
 *  - **Popular first.** A category is walked through damplips' own popular
 *    feeds before its taxonomy pages and its search results, so the catalog
 *    fills with the site's popular videos rather than its newest ones.
 *  - **A poster on every row.** A post whose page advertises no usable poster is
 *    skipped instead of imported blank, and `repairThumbnails` fixes rows stored
 *    before that rule existed.
 *  - **No duplicates.** The damplips post id is the identity. It is checked
 *    against the rows already in the catalog, against the rows of the current
 *    run, and finally by the unique index `videos_damplips_identity_idx`.
 */

/** Stored in `videos.provider` for every row this importer creates. */
export const DAMPLIPS_PROVIDER = "damplips";

/** Listing pages read by one HTTP request. */
export const DEFAULT_PAGES_PER_REQUEST = 4;
/** Hard ceiling for one request when a caller asks for more. */
export const MAX_PAGES_PER_REQUEST = 25;

/**
 * Post pages read by one HTTP request.
 *
 * A listing page names ~20–40 posts and every one has to be opened to learn
 * whether it still serves a file, so this — not the page count — is the real
 * cost of a slice. It is the knob the panel's slice size is built around.
 */
export const DEFAULT_POSTS_PER_REQUEST = 12;
export const MAX_POSTS_PER_REQUEST = 60;

/** Below this, a clip is a teaser rather than a video worth cataloguing. */
export const MIN_DURATION_SECONDS = 60;

/** Rows `repairThumbnails` may fix in one call. */
export const MAX_POSTER_REPAIRS = 10;

export type RightsStatus = "cleared" | "pending";

export type ImportCursor = {
  /** Index into the category's source plan (popular → taxonomy → search). */
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
};

export const INITIAL_CURSOR: ImportCursor = { source: 0, page: 1, skip: 0 };

export type DamplipsImportOptions = {
  /** erobabe category slug (fixed taxonomy). */
  categorySlug: string;
  /** Where the previous slice stopped. Omit to start at the first listing. */
  cursor?: ImportCursor;
  /** Listing pages to read in this request. */
  pagesPerRequest?: number;
  /** Post pages to read in this request. */
  postsPerRequest?: number;
  /** Skip clips whose published duration is shorter than this. */
  minDurationSeconds?: number;
  /** `pending` stages imports as private drafts for review. */
  rightsStatus?: RightsStatus;
  /** Resolve and report without writing to the catalog. */
  dryRun?: boolean;
  /** Repair stored rows whose poster is missing before importing. */
  repair?: boolean;
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
};

export type DamplipsSourceReport = {
  label: string;
  url: string;
  kind: "popular" | "taxonomy" | "search";
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
  imported: number;
  duplicates: number;
  /** Stored rows whose missing poster was resolved during this slice. */
  repaired: number;
  skipped: DamplipsSkipped;
  pagesRead: number;
  postsRead: number;
  /** Where the next slice continues. */
  cursor: ImportCursor;
  /** Every listing in the plan has been walked; a new pass may begin. */
  exhausted: boolean;
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
   * play. Defaults to a range-request against the parsed file.
   */
  fetchHostMedia?: FetchHostMedia;
  /** Post ids used by this run, shared across categories. */
  claimed?: Set<string>;
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

function normalizeCursor(cursor: ImportCursor | undefined, planLength: number): ImportCursor {
  const source = Number.isFinite(cursor?.source) ? Math.floor(Number(cursor?.source)) : 0;
  const page = Number.isFinite(cursor?.page) ? Math.floor(Number(cursor?.page)) : 1;
  const skip = Number.isFinite(cursor?.skip) ? Math.floor(Number(cursor?.skip)) : 0;
  const url = typeof cursor?.url === "string" && cursor.url ? cursor.url : undefined;
  if (source >= planLength) return { source: planLength, page: 1, skip: 0 };
  return { source: Math.max(0, source), page: Math.max(1, page), skip: Math.max(0, skip), url };
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

export async function importCategorySlice(
  options: DamplipsImportOptions,
  deps: DamplipsImportDeps,
): Promise<DamplipsImportReport> {
  const log = deps.logger ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const fetchHostMedia = deps.fetchHostMedia ?? fetchHostMediaUrl;
  const claimed = deps.claimed ?? new Set<string>();
  const delayMs = Math.max(0, deps.delayMs ?? 120);

  if (!categorySource(options.categorySlug)) {
    throw new Error(`No damplips source is configured for "${options.categorySlug}"`);
  }

  const baseUrl = (options.baseUrl || DAMPLIPS_BASE_URL).replace(/\/$/, "");
  const plan = sourcePlan(options.categorySlug, baseUrl);
  const pagesPerRequest = clampPages(options.pagesPerRequest);
  const postsPerRequest = clampPosts(options.postsPerRequest);
  const minDuration = Math.max(0, options.minDurationSeconds ?? MIN_DURATION_SECONDS);
  const rightsStatus: RightsStatus = options.rightsStatus === "pending" ? "pending" : "cleared";
  const dryRun = Boolean(options.dryRun);

  const report: DamplipsImportReport = {
    category: options.categorySlug,
    categoryId: deps.categoryId,
    imported: 0,
    duplicates: 0,
    repaired: 0,
    skipped: { missingMedia: 0, missingThumbnail: 0, short: 0, failed: 0 },
    pagesRead: 0,
    postsRead: 0,
    cursor: { ...INITIAL_CURSOR },
    exhausted: false,
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

  function toRow(detail: NonNullable<ReturnType<typeof parseVideoPage>>, thumbnailUrl: string): CatalogRow {
    const media = detail.media!;
    const height = detail.maxHeight;
    return {
      slug: damplipsSlug(detail.title, detail.sourceId),
      title: detail.title.slice(0, 240),
      description: detail.description,
      category_id: deps.categoryId,
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
  async function importPost(card: {
    sourceId: string;
    sourceUrl: string;
    title: string;
    thumbnailUrl: string | null;
  }): Promise<"imported" | "duplicate" | "missingMedia" | "missingThumbnail" | "short" | "failed"> {
    let detail: ReturnType<typeof parseVideoPage>;
    try {
      if (delayMs) await sleep(delayMs);
      const page = await deps.fetchPage(card.sourceUrl);
      detail = parseVideoPage(page.html, page.url || card.sourceUrl);
    } catch (error) {
      report.errors.push(
        `${card.sourceUrl}: ${error instanceof Error ? error.message : "unreadable post page"}`,
      );
      return "failed";
    }
    report.postsRead += 1;

    if (!detail) {
      report.errors.push(`${card.sourceUrl}: no title on the post page`);
      return "failed";
    }

    // A row is only worth importing when the watch page can stream a file
    // immediately. Playlists and post pages would push that work onto the visitor.
    if (!detail.media || detail.media.kind !== "direct") return "missingMedia";

    const thumbnailUrl = [detail.thumbnailUrl, card.thumbnailUrl]
      .map((value) => value)
      .find((value): value is string => Boolean(value) && looksLikePoster(value));
    if (!thumbnailUrl) return "missingThumbnail";

    if (detail.durationSeconds != null && detail.durationSeconds < minDuration) return "short";

    // Prefer the URL the host actually answers, but never drop a parsed file
    // because a datacenter fetch was blocked.
    const hostUrl = await fetchHostMedia(detail.media.url);
    const resolved = { ...detail, media: { kind: "direct" as const, url: hostUrl || detail.media.url } };

    if (dryRun) {
      if (report.samples.length < 5) {
        report.samples.push({
          title: resolved.title,
          sourceId: resolved.sourceId,
          sourceUrl: resolved.sourceUrl,
          thumbnailUrl,
          mediaUrl: resolved.media.url,
        });
      }
      return "imported";
    }

    const { error } = await deps.service.from("videos").insert(toRow(resolved, thumbnailUrl));
    if (!error) return "imported";
    if (error.code === "23505") {
      // Someone inserted this post between our read and our write, or the slug
      // belongs to another row. The video is in the catalog either way.
      return "duplicate";
    }
    report.errors.push(`${detail.sourceUrl}: ${error.message || "insert failed"}`);
    return "failed";
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

  while (
    report.pagesRead < pagesPerRequest &&
    report.postsRead < postsPerRequest &&
    cursor.source < plan.length
  ) {
    const source = plan[cursor.source];
    const reportForSource = sourceReport(cursor.source);

    // Page one is the plan's URL; every later page is the exact URL the previous
    // slice resolved, so a cursor never depends on guessing a pagination shape.
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

    // Resume mid-page: a slice may stop after a handful of post reads.
    const startAt = Math.min(cursor.skip, cards.length);
    const remaining = cards.slice(startAt);

    // One batched read tells us which of these posts are already catalogued, so
    // a re-run spends its post-page budget on new videos only.
    const unseen = remaining.filter((card) => !claimed.has(card.sourceId));
    let alreadyKnown = new Set<string>();
    if (unseen.length && !dryRun) {
      const lookup = await existingPostIds(
        deps.service,
        unseen.map((card) => card.sourceId),
      );
      if (lookup.error) report.errors.push(lookup.error);
      alreadyKnown = lookup.found;
    }

    let consumed = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      if (report.postsRead >= postsPerRequest) break;
      const card = remaining[index];
      consumed = index + 1;

      if (claimed.has(card.sourceId) || alreadyKnown.has(card.sourceId)) {
        report.duplicates += 1;
        claimed.add(card.sourceId);
        continue;
      }
      claimed.add(card.sourceId);

      const outcome = await importPost(card);
      if (outcome === "imported") {
        report.imported += 1;
        reportForSource.imported += 1;
      } else if (outcome === "duplicate") {
        report.duplicates += 1;
      } else if (outcome === "missingMedia") {
        report.skipped.missingMedia += 1;
      } else if (outcome === "missingThumbnail") {
        report.skipped.missingThumbnail += 1;
      } else if (outcome === "short") {
        report.skipped.short += 1;
      } else {
        report.skipped.failed += 1;
      }
    }
    reportForSource.posts += consumed;

    if (startAt + consumed < cards.length) {
      // The slice ran out of post budget in the middle of this page.
      cursor = { source: cursor.source, page: cursor.page, skip: startAt + consumed, url: pageUrl };
      break;
    }

    const next = nextListingPage(page.url || pageUrl, page.html);
    cursor = next
      ? { source: cursor.source, page: cursor.page + 1, skip: 0, url: next }
      : { source: cursor.source + 1, page: 1, skip: 0 };
  }

  report.cursor = cursor;
  report.exhausted = cursor.source >= plan.length;

  log(
    `${options.categorySlug}: +${report.imported} imported, ${report.duplicates} already known, ` +
      `${report.postsRead} post page(s)${report.exhausted ? ", every listing walked" : ""}`,
  );

  return report;
}
