import { dbApi, dbConfigMissing, hasSlugColumn } from "./db.mjs";
import { ENV } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Dynamic SEO assets for Googlebot.
 *
 *   /sitemap.xml  Generated on every request straight from the
 *                 published catalog, so a newly published video is
 *                 included immediately (and a deleted/unpublished
 *                 one disappears immediately). No redeploy, no cron,
 *                 no stored file to keep in sync.
 *   /robots.txt   Allows crawling and points at the sitemap.
 *
 * Canonical host is erobabe.com unless SITE_URL overrides it.
 * ────────────────────────────────────────────────────────────── */

const CANONICAL_HOST = "https://erobabe.com";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Prefer SITE_URL, then the canonical production domain. */
function siteBase() {
  const configured = (ENV("SITE_URL") || "").trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured) && !/localhost|127\.0\.0\.1/i.test(configured)) {
    return configured;
  }
  return CANONICAL_HOST;
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : undefined);

const STATIC_PAGES = [
  { path: "/", changefreq: "hourly", priority: "1.0" },
  { path: "/trending", changefreq: "hourly", priority: "0.9" },
  { path: "/new", changefreq: "hourly", priority: "0.8" },
  { path: "/popular", changefreq: "daily", priority: "0.8" },
  { path: "/explore", changefreq: "daily", priority: "0.8" },
  { path: "/categories", changefreq: "weekly", priority: "0.7" },
  { path: "/legal/about", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/privacy", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/terms", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/dmca", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/age", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/contact", changefreq: "monthly", priority: "0.3" },
];

function urlEntry({ loc, lastmod, changefreq = "daily", priority = "0.5" }) {
  return (
    `  <url>\n` +
    `    <loc>${esc(loc)}</loc>\n` +
    (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "") +
    `    <changefreq>${changefreq}</changefreq>\n` +
    `    <priority>${priority}</priority>\n` +
    `  </url>`
  );
}

export async function handleSitemap() {
  const base = siteBase();
  const entries = [];

  let published = [];
  let categories = [];

  if (!dbConfigMissing()) {
    try {
      const slugs = await hasSlugColumn();
      const videoCols = `id,${slugs ? "slug," : ""}published_at,updated_at,title`;
      const [cats, vids] = await Promise.all([
        dbApi.select("categories", "order=sort.asc&select=slug,name"),
        dbApi.select(
          "videos",
          // Only published videos are ever exposed to search engines.
          `status=eq.published&select=${videoCols}&order=published_at.desc.nullslast&limit=5000`
        ),
      ]);
      categories = cats.data ?? [];
      published = vids.data ?? [];
    } catch (e) {
      // A database hiccup must never take the sitemap offline.
      console.error("[sitemap]", e);
    }
  }

  const newestVideoDay =
    day(published[0]?.updated_at || published[0]?.published_at) || day(new Date().toISOString());

  // 1. Static, indexable pages (homepage first, always on erobabe.com).
  for (const page of STATIC_PAGES) {
    entries.push(
      urlEntry({
        loc: `${base}${page.path}`,
        lastmod: page.path === "/" ? newestVideoDay : undefined,
        changefreq: page.changefreq,
        priority: page.priority,
      })
    );
  }

  // 2. Category landing pages.
  for (const c of categories) {
    entries.push({
      loc: `${base}/category/${c.slug}`,
      changefreq: "daily",
      priority: "0.7",
    });
  }

  // 3. Every published watch page, addressed by its canonical SEO slug.
  for (const v of published) {
    entries.push({
      loc: `${base}/watch/${v.slug || v.id}`,
      lastmod: day(v.updated_at || v.published_at),
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- EroBabe sitemap - generated dynamically from the published catalog -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.map((e) => (typeof e === "string" ? e : urlEntry(e))).join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Always regenerate so publishes appear instantly.
      "cache-control": "no-cache, no-store, must-revalidate",
      "x-sitemap-urls": String(entries.length),
      "x-sitemap-videos": String(published.length),
    },
  });
}

export function handleRobots() {
  const base = siteBase();
  const body =
    [
      "# EroBabe - 18+ adult video website",
      "# Crawling is allowed; private and parameterized areas are excluded.",
      "",
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /admin/",
      "Disallow: /api/",
      "Disallow: /search",
      "",
      "User-agent: Googlebot",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /search",
      "",
      "User-agent: Bingbot",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /search",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      `Host: ${base.replace(/^https?:\/\//, "")}`,
    ].join("\n") + "\n";

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
