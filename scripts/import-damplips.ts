/**
 * Fill the erobabe catalog from damplips.com.
 *
 *   npm run import:damplips -- --categories=all
 *   npm run import:damplips -- --categories=hardcore,lesbian --dry-run
 *   npm run import:damplips -- --categories=all --passes=2
 *
 * This is the same importer the admin dashboard calls, run from a shell so the
 * first fill does not depend on a browser tab staying open. There is no
 * per-category target: a pass walks every listing of the category (popular
 * feeds, taxonomy pages, searches) and stops when it runs out. It reads
 * .env.local / the process environment, writes only to the catalog, and never
 * copies media files.
 */

import { createClient } from "@supabase/supabase-js";
import { DAMPLIPS_CATEGORY_SOURCES } from "../lib/damplips/categories";
import { createDamplipsFetcher, type FetchDamplipsPage } from "../lib/damplips/client";
import {
  DEFAULT_POSTS_PER_REQUEST,
  MAX_POSTS_PER_REQUEST,
  importCategorySlice,
  repairThumbnails,
  type ImportCursor,
} from "../lib/damplips/importer";
import { categoryCounts, type ImportService } from "../lib/catalog/counts";
import { parseListing, parseVideoPage } from "../lib/damplips/parse";

type Args = {
  categories: string[];
  dryRun: boolean;
  rightsStatus: "cleared" | "pending";
  /** Post pages opened per slice. */
  posts: number;
  /** Full passes over every listing of each category. */
  passes: number;
  delayMs: number;
  /** Only fix stored posters, then exit. */
  posters: boolean;
  /** Diagnose one damplips URL and exit (no database access needed). */
  probe: string | null;
  /** Re-resolve rows whose stored destination is not a direct media file. */
  repair: boolean;
  /** Write the machine-readable run report here. */
  json: string | null;
  help: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    categories: ["all"],
    dryRun: false,
    rightsStatus: "cleared",
    posts: DEFAULT_POSTS_PER_REQUEST,
    passes: 1,
    delayMs: 120,
    posters: false,
    probe: null,
    repair: false,
    json: null,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--repair") args.repair = true;
    else if (raw.startsWith("--categories=")) {
      args.categories = raw
        .slice("--categories=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (raw.startsWith("--posts=")) {
      const value = Math.floor(Number(raw.slice("--posts=".length)));
      if (Number.isFinite(value) && value > 0) args.posts = value;
    } else if (raw.startsWith("--passes=")) {
      const value = Math.floor(Number(raw.slice("--passes=".length)));
      if (Number.isFinite(value) && value > 0) args.passes = value;
    } else if (raw === "--posters") {
      args.posters = true;
    } else if (raw.startsWith("--rights=")) {
      args.rightsStatus = raw.slice("--rights=".length) === "pending" ? "pending" : "cleared";
    } else if (raw.startsWith("--delay=")) {
      const value = Math.floor(Number(raw.slice("--delay=".length)));
      if (Number.isFinite(value) && value >= 0) args.delayMs = value;
    } else if (raw.startsWith("--probe=")) {
      args.probe = raw.slice("--probe=".length) || "https://www.damplips.com/";
    } else if (raw.startsWith("--json=")) {
      args.json = raw.slice("--json=".length) || null;
    }
  }
  args.posts = Math.max(1, Math.min(MAX_POSTS_PER_REQUEST, args.posts));
  return args;
}

const HELP = `Fill the catalog from damplips.com

  --categories=all|slug,slug   fixed categories to fill (default: all)
  --passes=<n>                 full passes over every listing (default: 1)
  --posts=<n>                  post pages opened per request, 1-${MAX_POSTS_PER_REQUEST} (default: ${DEFAULT_POSTS_PER_REQUEST})
  --rights=cleared|pending     publish now, or stage as private drafts (default: cleared)
  --dry-run                    resolve and report without writing
  --posters                    fix stored rows whose poster is missing, then exit
  --delay=<ms>                 pause between page reads (default: 120)
  --probe=<url>                print what one damplips page yields, then exit
  --repair                     rewrite catalog rows that are not storing a
                               direct media file (post pages, old proxies)
  --json=<path>                write the run report as JSON

Environment: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or
SUPABASE_SECRET_KEY), optionally DAMPLIPS_BASE_URL.
`;

/**
 * Asks the media host for the first two bytes of the file and reports what came
 * back.
 *
 * A media URL that parses is not necessarily a media URL that plays: the host
 * can 403 a request, redirect somewhere odd, answer with HTML, or refuse range
 * requests altogether. This runs from the machine the operator is sitting at,
 * so the answer describes *their* network path — the same one the browser in
 * front of them will use.
 */
export async function probeMedia(url: string): Promise<boolean> {
  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timeout,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "*/*",
        range: "bytes=0-1",
      },
    });
    const type = response.headers.get("content-type") || "no content-type";
    const ranges = response.headers.get("accept-ranges") || "none";
    const length = response.headers.get("content-length") || "unknown";
    const encoding = response.headers.get("content-encoding");
    await response.body?.cancel().catch(() => undefined);
    process.stdout.write(
      `  reachable: ${response.status} ${response.statusText} · ${type} · ` +
        `accept-ranges: ${ranges} · ${length} bytes` +
        (encoding ? ` · encoding: ${encoding}` : "") +
        "\n",
    );
    return response.ok || response.status === 206;
  } catch (error) {
    process.stdout.write(
      `  reachable: NO — ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return false;
  }
}

/**
 * Prints what the parser can see on one damplips URL.
 *
 * Run this first in a new environment: it needs no database, and it is the
 * fastest way to tell whether damplips is reachable and whether its current
 * markup still exposes a poster and a media destination — and whether that
 * destination actually answers.
 */
export async function probe(target: string): Promise<number> {
  const url = target.startsWith("http")
    ? target
    : `https://www.damplips.com${target.startsWith("/") ? "" : "/"}${target}`;
  const fetchPage = createDamplipsFetcher({ baseUrl: process.env.DAMPLIPS_BASE_URL || undefined });
  let page;
  try {
    page = await fetchPage(url);
  } catch (error) {
    process.stderr.write(
      `Could not read ${url}: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 1;
  }
  process.stdout.write(`${page.status} ${page.url} (${page.html.length} bytes)\n`);

  const listing = parseListing(page.html, page.url);
  if (listing.cards.length) {
    process.stdout.write(`\nListing cards: ${listing.cards.length}${listing.nextPageUrl ? `, next ${listing.nextPageUrl}` : ", no next page"}\n`);
    for (const card of listing.cards.slice(0, 5)) {
      process.stdout.write(`  ${card.sourceId}  ${card.thumbnailUrl ? "poster" : "NO POSTER"}  ${card.title}\n`);
    }
  }

  const detail = parseVideoPage(page.html, page.url);
  if (detail) {
    process.stdout.write(`\nPost: ${detail.title}\n  poster: ${detail.thumbnailUrl || "none"}\n`);
    process.stdout.write(`  duration: ${detail.durationSeconds ? `${detail.durationSeconds}s` : "unknown"}\n`);
    process.stdout.write(
      `  media: ${detail.media ? `${detail.media.kind} ${detail.media.url}` : "NOT FOUND — the page loads it with JavaScript; check the player markup"}\n`,
    );
    if (!detail.media) return 3;
    // A direct file is played by the browser itself, so its own reachability is
    // the whole question. A playlist is handled by the stream proxy.
    if (detail.media.kind === "direct") {
      return (await probeMedia(detail.media.url)) ? 0 : 4;
    }
    return 0;
  }

  if (!listing.cards.length) {
    process.stderr.write("\nNothing parsed: neither a listing nor a post page. Check the URL and damplips markup.\n");
    return 2;
  }
  return 0;
}


/** A destination a browser can stream without the proxy preparing it first. */
const DIRECT_MEDIA_PATH = /\.(mp4|m4v|webm|mov|m3u8|ogv|ogg)(?:[?#]|$)/i;

export type RepairReport = {
  scanned: number;
  healthy: number;
  repaired: number;
  unresolved: number;
  dryRun: boolean;
  changes: Array<{ slug: string; from: string | null; to: string }>;
  errors: string[];
};

/**
 * Rewrites catalog rows whose `playable_url` is not a media file.
 *
 * The importer stores the file a damplips post serves — today a direct host URL
 * like `https://video.damplips.com/video7/717/79.mp4`, which the browser streams
 * itself with nothing to prepare. A row written by an older run (or another
 * tool) may instead hold a post page, or a `/api/videos/stream` address those
 * had to be resolved through. Those are the rows that sit on a loading screen,
 * so this walks the catalog, re-reads the post page, and stores the file it
 * publishes as `playable_url`.
 *
 * Rows already holding a direct file are left alone and never re-fetched.
 */
export async function repairDirectUrls(
  service: ImportService,
  options: { dryRun?: boolean; fetchPage?: FetchDamplipsPage } = {},
): Promise<RepairReport> {
  const fetchPage = options.fetchPage ?? createDamplipsFetcher({
    baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
  });
  const report: RepairReport = {
    scanned: 0,
    healthy: 0,
    repaired: 0,
    unresolved: 0,
    dryRun: Boolean(options.dryRun),
    changes: [],
    errors: [],
  };

  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await service
      .from("videos")
      .select("id, slug, source_url, playable_url, embed_url")
      .eq("provider", "damplips")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Unable to read the catalog");
    const rows = (data as Array<Record<string, string | null>> | null) || [];
    if (!rows.length) break;

    for (const row of rows) {
      report.scanned += 1;
      const current = row.playable_url;
      if (current && DIRECT_MEDIA_PATH.test(current)) {
        report.healthy += 1;
        continue;
      }

      // The post page is the thing that advertises the file: prefer our stored
      // source page, then whatever the row was pointing at.
      const page = row.source_url || row.playable_url || row.embed_url;
      if (!page) {
        report.unresolved += 1;
        continue;
      }

      try {
        const detail = await fetchPage(page);
        const media = parseVideoPage(detail.html, detail.url || page)?.media;
        if (!media || media.kind !== "direct" || !DIRECT_MEDIA_PATH.test(media.url)) {
          report.unresolved += 1;
          report.errors.push(`${row.slug}: the post page did not publish a media file`);
          continue;
        }
        if (media.url === current && row.embed_url === null) {
          report.healthy += 1;
          continue;
        }
        if (!report.dryRun) {
          const { error: updateError } = await service
            .from("videos")
            .update({ playable_url: media.url, embed_url: null })
            .eq("id", row.id);
          if (updateError) throw new Error(updateError.message || "update failed");
        }
        report.repaired += 1;
        if (report.changes.length < 20) {
          report.changes.push({ slug: String(row.slug), from: current, to: media.url });
        }
      } catch (error) {
        report.unresolved += 1;
        report.errors.push(
          `${row.slug}: ${error instanceof Error ? error.message : "unreadable post page"}`,
        );
      }
    }
  }

  return report;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.probe) return probe(args.probe);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    process.stderr.write(
      "Missing Supabase credentials: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n",
    );
    return 1;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const service = supabase as unknown as ImportService;

  if (args.repair) {
    process.stdout.write(
      `Repairing direct media URLs${args.dryRun ? " (dry run)" : ""}\n`,
    );
    const report = await repairDirectUrls(service, { dryRun: args.dryRun });
    process.stdout.write(
      `  ${report.scanned} scanned · ${report.healthy} already direct · ` +
        `${report.repaired} repaired · ${report.unresolved} unresolved\n`,
    );
    for (const change of report.changes) {
      process.stdout.write(`    ${change.slug}\n      was: ${change.from || "none"}\n      now: ${change.to}\n`);
    }
    for (const message of report.errors.slice(0, 10)) {
      process.stdout.write(`    ! ${message}\n`);
    }
    if (args.json) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(args.json), { recursive: true }).catch(() => undefined);
      await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`\nReport written to ${args.json}\n`);
    }
    return report.unresolved ? 2 : 0;
  }

  const requested =
    args.categories.includes("all")
      ? DAMPLIPS_CATEGORY_SOURCES.map((entry) => entry.slug)
      : args.categories;
  const unknown = requested.filter(
    (slug) => !DAMPLIPS_CATEGORY_SOURCES.some((entry) => entry.slug === slug),
  );
  if (unknown.length) {
    process.stderr.write(`Unknown category: ${unknown.join(", ")}\n`);
    return 1;
  }

  const { data: categories, error } = await supabase.from("categories").select("id, slug, label");
  if (error) {
    process.stderr.write(`Unable to read categories: ${error.message}\n`);
    return 1;
  }
  const ordered = requested
    .map((slug) => (categories || []).find((category: { slug: string }) => category.slug === slug))
    .filter(Boolean) as Array<{ id: string; slug: string; label: string }>;
  if (ordered.length !== requested.length) {
    const found = new Set(ordered.map((category) => category.slug));
    process.stderr.write(
      `These categories are missing from the database: ${requested.filter((slug) => !found.has(slug)).join(", ")}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `Importing ${ordered.length} categor${ordered.length === 1 ? "y" : "ies"} · ` +
      `${args.passes} pass${args.passes === 1 ? "" : "es"} · rights=${args.rightsStatus}` +
      `${args.dryRun ? " · dry run" : ""}\n`,
  );

  const fetchPage = createDamplipsFetcher({
    baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
  });
  const run = { categories: [] as Array<Record<string, unknown>> };

  for (const category of ordered) {
    let imported = 0;
    let duplicates = 0;
    let repaired = 0;
    let postsRead = 0;
    const errors: string[] = [];

    for (let pass = 1; pass <= args.passes; pass += 1) {
      let cursor: ImportCursor = { source: 0, page: 1, skip: 0 };
      for (;;) {
        const report = await importCategorySlice(
          {
            categorySlug: category.slug,
            cursor,
            postsPerRequest: args.posts,
            dryRun: args.dryRun,
            rightsStatus: args.rightsStatus,
            // The first slice of a pass also repairs stored posters.
            repair: repaired === 0 && pass === 1,
            baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
          },
          {
            fetchPage,
            service,
            categoryId: category.id,
            delayMs: args.delayMs,
            logger: (message) => process.stdout.write(`  ${message}\n`),
          },
        );
        imported += report.imported;
        duplicates += report.duplicates;
        repaired += report.repaired;
        postsRead += report.postsRead;
        errors.push(...report.errors);
        cursor = report.cursor;
        if (report.exhausted) break;
        if (report.pagesRead === 0 && report.postsRead === 0) break;
        process.stdout.write(
          `  ${category.slug}: +${imported} new · ${postsRead} videos read · ` +
            `listing ${report.cursor.source + 1}\n`,
        );
      }
    }

    process.stdout.write(
      `  OK   ${category.slug.padEnd(14)} +${imported} new · ${duplicates} already present · ` +
        `${postsRead} videos read${repaired ? ` · ${repaired} poster(s) repaired` : ""}\n`,
    );
    for (const message of errors.slice(0, 3)) process.stdout.write(`       ${message}\n`);
    run.categories.push({
      category: category.slug,
      imported,
      duplicates,
      repaired,
      postsRead,
      errors: errors.slice(0, 10),
    });
  }

  if (args.json) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(args.json), { recursive: true }).catch(() => undefined);
    await writeFile(args.json, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    process.stdout.write(`\nReport written to ${args.json}\n`);
  }

  if (!args.dryRun) {
    try {
      const counts = await categoryCounts(service);
      process.stdout.write("\nPublished damplips videos per category\n");
      for (const entry of counts) {
        const backlog = entry.total > entry.published ? `  (${entry.total} rows in catalog)` : "";
        process.stdout.write(`  ${entry.label.padEnd(18)} ${entry.published}${backlog}\n`);
      }
    } catch {
      /* The run summary above already says what was written. */
    }
  }

  const failed = run.categories.some((entry) => (entry.errors as string[]).length > 0);
  process.stdout.write(
    failed
      ? "\nFinished with errors — see the messages above.\n"
      : "\nFinished: every listing was walked.\n",
  );
  return failed ? 2 : 0;
}

// Only run when executed directly (the bundler keeps `import.meta` intact).
if (process.argv[1] && /import-damplips/.test(process.argv[1])) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
