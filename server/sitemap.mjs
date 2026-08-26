import { dbApi, dbConfigMissing } from "./db.mjs";
import { ENV } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Dynamic SEO assets for Googlebot:
 *   /sitemap.xml — generated from the live published catalog, so
 *   publishing adds a watch URL and deleting/unpublishing removes
 *   it automatically (the sitemap is regenerated on every fetch).
 *   /robots.txt  — allows crawling, blocks admin/API/search, and
 *   references the sitemap.
 * ────────────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function siteBase(req) {
  return (
    (ENV("SITE_URL") || "").replace(/\/+$/, "") ||
    (() => {
      try {
        const u = new URL(req.url);
        return `${u.protocol}//${u.host}`;
      } catch {
        return "https://erobabe.com";
      }
    })()
  );
}

const STATIC_PAGES = [
  { path: "", changefreq: "weekly", priority: "1.0" },
  { path: "/trending", changefreq: "hourly", priority: "0.9" },
  { path: "/popular", changefreq: "daily", priority: "0.8" },
  { path: "/new", changefreq: "hourly", priority: "0.8" },
  { path: "/explore", changefreq: "daily", priority: "0.8" },
  { path: "/categories", changefreq: "weekly", priority: "0.7" },
  { path: "/legal/about", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/privacy", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/terms", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/dmca", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/age", changefreq: "monthly", priority: "0.3" },
  { path: "/legal/contact", changefreq: "monthly", priority: "0.3" },
];

const entry = ({ loc, lastmod, changefreq = "daily", priority = "0.5" }) =>
  `  <url>\n    <loc>${esc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

export async function handleSitemap(req) {
  const base = siteBase(req);
  const entries = STATIC_PAGES.map((p) =>
    entry({ loc: `${base}${p.path}`, changefreq: p.changefreq, priority: p.priority })
  );

  if (!dbConfigMissing()) {
    try {
      const [{ data: cats }, { data: vids }] = await Promise.all([
        dbApi.select("categories", "order=sort.asc&select=slug"),
        dbApi.select(
          "videos",
          "status=eq.published&select=id,published_at,updated_at&order=published_at.desc&limit=5000"
        ),
      ]);
      for (const c of cats) {
        entries.push(
          entry({ loc: `${base}/category/${c.slug}`, changefreq: "daily", priority: "0.7" })
        );
      }
      for (const v of vids) {
        const lastmod = (v.updated_at || v.published_at || "").slice(0, 10) || undefined;
        entries.push(
          entry({ loc: `${base}/watch/${v.id}`, lastmod, changefreq: "weekly", priority: "0.8" })
        );
      }
    } catch (e) {
      /* A storage hiccup must never take the sitemap down. */
      console.error("[sitemap]", e);
    }
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}

export function handleRobots(req) {
  const base = siteBase(req);
  const body = [
    "# EroBabe — crawl configuration",
    "User-agent: *",
    "Allow: /",
    "",
    "# Private / parameterized areas",
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /api/",
    "Disallow: /search",
    "",
    "# Sitemap",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=3600",
    },
  });
}
