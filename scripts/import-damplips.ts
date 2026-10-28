/**
 * Fill the erobabe catalog from damplips.com.
 *
 *   npm run import:damplips -- --categories=all --per-category=110
 *   npm run import:damplips -- --categories=hardcore,lesbian --dry-run
 *
 * This is the same importer the admin dashboard calls, run from a shell so the
 * first fill (12 categories × 100+ videos) does not depend on a browser tab
 * staying open. It reads .env.local / the process environment, writes only to
 * the catalog, and never copies media files.
 */

import { createClient } from "@supabase/supabase-js";
import { DAMPLIPS_CATEGORY_SOURCES } from "../lib/damplips/categories";
import { createDamplipsFetcher } from "../lib/damplips/client";
import {
  MAX_VIDEOS_PER_CATEGORY,
  categoryCounts,
  importCatalog,
  type ImportService,
} from "../lib/damplips/importer";
import { parseListing, parseVideoPage } from "../lib/damplips/parse";

type Args = {
  categories: string[];
  perCategory: number;
  dryRun: boolean;
  rightsStatus: "cleared" | "pending";
  concurrency: number;
  delayMs: number;
  /** Diagnose one damplips URL and exit (no database access needed). */
  probe: string | null;
  /** Write the machine-readable run report here. */
  json: string | null;
  help: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    categories: ["all"],
    perCategory: 110,
    dryRun: false,
    rightsStatus: "cleared",
    concurrency: 4,
    delayMs: 120,
    probe: null,
    json: null,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--categories=")) {
      args.categories = raw
        .slice("--categories=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (raw.startsWith("--per-category=")) {
      const value = Math.floor(Number(raw.slice("--per-category=".length)));
      args.perCategory = Number.isFinite(value) ? value : args.perCategory;
    } else if (raw.startsWith("--rights=")) {
      args.rightsStatus = raw.slice("--rights=".length) === "pending" ? "pending" : "cleared";
    } else if (raw.startsWith("--concurrency=")) {
      const value = Math.floor(Number(raw.slice("--concurrency=".length)));
      if (Number.isFinite(value) && value > 0) args.concurrency = value;
    } else if (raw.startsWith("--delay=")) {
      const value = Math.floor(Number(raw.slice("--delay=".length)));
      if (Number.isFinite(value) && value >= 0) args.delayMs = value;
    } else if (raw.startsWith("--probe=")) {
      args.probe = raw.slice("--probe=".length) || "https://www.damplips.com/";
    } else if (raw.startsWith("--json=")) {
      args.json = raw.slice("--json=".length) || null;
    }
  }
  args.perCategory = Math.max(1, Math.min(MAX_VIDEOS_PER_CATEGORY, args.perCategory));
  return args;
}

const HELP = `Fill the catalog from damplips.com

  --categories=all|slug,slug   fixed categories to fill (default: all)
  --per-category=<n>           videos per category, 1-${MAX_VIDEOS_PER_CATEGORY} (default: 110)
  --rights=cleared|pending     publish now, or stage as private drafts (default: cleared)
  --dry-run                    resolve and report without writing
  --concurrency=<n>            parallel post reads (default: 4)
  --delay=<ms>                 pause between post reads (default: 120)
  --probe=<url>                print what one damplips page yields, then exit
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
      `${args.perCategory} videos each · rights=${args.rightsStatus}` +
      `${args.dryRun ? " · dry run" : ""}\n`,
  );

  const run = await importCatalog(
    {
      categories: ordered,
      perCategory: args.perCategory,
      dryRun: args.dryRun,
      rightsStatus: args.rightsStatus,
      concurrency: args.concurrency,
      delayMs: args.delayMs,
      baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
    },
    {
      fetchPage: createDamplipsFetcher({ baseUrl: process.env.DAMPLIPS_BASE_URL || undefined }),
      service,
      logger: (message) => process.stdout.write(`  ${message}\n`),
    },
  );

  process.stdout.write("\nCategory summary\n");
  for (const report of run.categories) {
    const flags = [
      `${report.total}/${report.target}`,
      `+${report.imported} new`,
      `${report.updated} refreshed`,
      `${report.alreadyPresent} already present`,
      report.skipped.missingMedia ? `${report.skipped.missingMedia} no media` : "",
      report.skipped.missingThumbnail ? `${report.skipped.missingThumbnail} no poster` : "",
      report.skipped.failed ? `${report.skipped.failed} unreadable` : "",
    ].filter(Boolean);
    process.stdout.write(
      `  ${report.fulfilled ? "OK  " : "LOW "} ${report.category.padEnd(14)} ${flags.join(" · ")}\n`,
    );
    for (const message of report.errors.slice(0, 3)) {
      process.stdout.write(`       ${message}\n`);
    }
  }

  if (!args.dryRun) {
    try {
      const counts = await categoryCounts(service);
      process.stdout.write("\nPublished damplips videos per category\n");
      for (const entry of counts) {
        process.stdout.write(`  ${entry.label.padEnd(18)} ${entry.count}\n`);
      }
    } catch {
      /* The run summary above already says what was written. */
    }
  }

  if (args.json) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(args.json), { recursive: true }).catch(() => undefined);
    await writeFile(args.json, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    process.stdout.write(`\nReport written to ${args.json}\n`);
  }

  if (!run.complete) {
    process.stderr.write(
      `\nNot every category reached ${run.minimum} videos. Re-run to continue filling, or check the source paths in lib/damplips/categories.ts.\n`,
    );
    return 2;
  }
  process.stdout.write("\nEvery requested category reached its target.\n");
  return 0;
}

// Only run when executed directly (the bundler keeps `import.meta` intact).
if (process.argv[1] && /import-damplips/.test(process.argv[1])) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
