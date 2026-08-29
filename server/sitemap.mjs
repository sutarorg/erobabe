import { dbApi, dbConfigMissing, hasSlugColumn, hasColumn } from "./db.mjs";
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

/** No persistent cache — the sitemap reflects the live catalog per request. */
let sitemapCache = { at: 0, data: null };

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
  { path: "/explore", changefreq: "daily", priority: "0.7" },
  { path: "/categories", changefreq: "weekly", priority: "0.7" },
  { path: "/legal/about", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/privacy", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/terms", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/dmca", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/age", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/contact", changefreq: "monthly", priority: "0.3" },
];

function urlEntry({ loc, lastmod, changefreq = "daily", priority = "0.5", video }) {
  const videoXml = video
    ? `
    <video:video>
      <video:thumbnail_loc>${esc(video.thumbnail)}</video:thumbnail_loc>
      <video:title>${esc(String(video.title || "EroBabe video").slice(0, 100))}</video:title>
      <video:description>${esc(String(video.description || "Watch this 18+ video on EroBabe.").replace(/\s+/g, " ").slice(0, 2048))}</video:description>
      ${video.content ? `<video:content_loc>${esc(video.content)}</video:content_loc>` : ""}
      ${video.duration ? `<video:duration>${Math.min(Math.max(Math.round(video.duration), 1), 28800)}</video:duration>` : ""}
      ${video.published ? `<video:publication_date>${esc(video.published)}</video:publication_date>` : ""}
      <video:family_friendly>no</video:family_friendly>
      ${video.tags.map((tag) => `<video:tag>${esc(String(tag).slice(0, 32))}</video:tag>`).join("\n      ")}
    </video:video>`
    : "";
  return (
    `  <url>\n` +
    `    <loc>${esc(loc)}</loc>\n` +
    (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "") +
    `    <changefreq>${changefreq}</changefreq>\n` +
    `    <priority>${priority}</priority>${videoXml}\n` +
    `  </url>`
  );
}

/** SEO edits invalidate the cached sitemap so it regenerates on demand. */
export function invalidateSitemapCache() {
  sitemapCache = { at: 0, data: null };
}

export async function handleSitemap() {
  const base = siteBase();
  const entries = [];

  // Admin SEO overrides can exclude a page from the sitemap entirely.
  const excluded = new Set();
  if (!(await hasColumn("seo_pages", "path_key")).valueOf()) {
    /* table absent — nothing to exclude */
  } else {
    try {
      const { data } = await dbApi.select(
        "seo_pages",
        "in_sitemap=eq.false&select=path_key&limit=1000"
      );
      for (const row of data ?? []) excluded.add(row.path_key);
    } catch {
      /* migration 0008 not applied yet */
    }
  }
  const isExcluded = (key, path) => excluded.has(key) || excluded.has(`page:${path.slice(1)}`);

  let published = [];
  let categories = [];

  if (!dbConfigMissing()) {
    try {
      const slugs = await hasSlugColumn();
      const videoCols =
        `id,${slugs ? "slug," : ""}published_at,updated_at,title,description,` +
        `thumbnail_url,video_url,hls_url,duration_s,tags`;
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
    if (isExcluded("home", page.path) || isExcluded(`page:${page.path.slice(1)}`, page.path)) continue;
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
    if (excluded.has(`category:${c.slug}`)) continue;
    entries.push({
      loc: `${base}/category/${c.slug}`,
      changefreq: "daily",
      priority: "0.7",
    });
  }

  // 3. Every published video page, addressed by its canonical SEO slug.
  for (const v of published) {
    if (excluded.has(`video:${v.slug || v.id}`) || excluded.has(`video:${v.id}`)) continue;
    entries.push({
      loc: `${base}/video/${v.slug || v.id}`,
      lastmod: day(v.updated_at || v.published_at),
      changefreq: "weekly",
      priority: "0.8",
      // Google video sitemap fields. A thumbnail is required by the
      // protocol; videos without one still retain the page URL above.
      ...(v.thumbnail_url
        ? {
            video: {
              thumbnail: v.thumbnail_url,
              title: v.title,
              description: v.description,
              content: v.hls_url || v.video_url,
              duration: v.duration_s,
              published: v.published_at,
              tags: Array.isArray(v.tags) ? v.tags.slice(0, 32) : [],
            },
          }
        : {}),
    });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- EroBabe sitemap - generated dynamically from the published catalog -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n` +
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
      "# Crawling is allowed; private, admin and low-value pages are excluded.",
      "",
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /admin/",
      "Disallow: /api/",
      "Disallow: /search",
      "Disallow: /history",
      "Disallow: /liked",
      "Disallow: /watch-later",
      "Disallow: /*?q=",
      "",
      "User-agent: Googlebot",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /search",
      "Disallow: /history",
      "Disallow: /liked",
      "Disallow: /watch-later",
      "Disallow: /*?q=",
      "",
      "User-agent: Bingbot",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /search",
      "Disallow: /history",
      "Disallow: /liked",
      "Disallow: /watch-later",
      "",
      `Sitemap: ${base}/sitemap.xml`,
    ].join("\n") + "\n";

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
