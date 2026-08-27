import { handlePublic } from "./public-api.mjs";
import { handleAdmin } from "./admin-api.mjs";
import { handleSitemap, handleRobots } from "./sitemap.mjs";
import { handleOEmbed, handleVideoPage } from "./video-page.mjs";
import { json, toError } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Single entry point shared by the Vercel and Netlify adapters.
 * Accepts a Web-standard Request and returns a Response.
 * ────────────────────────────────────────────────────────────── */

export async function handle(request) {
  const url = new URL(request.url);
  const path = (url.pathname.replace(/\/+$/, "") || "/");

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    // Dynamic SEO assets (generated from the live published catalog)
    if (path === "/sitemap.xml" || path === "/api/sitemap.xml" || path === "/api/sitemap") {
      return await handleSitemap(request);
    }
    if (path === "/robots.txt" || path === "/api/robots.txt") {
      return handleRobots(request);
    }
    // Vercel dispatches /api/seo/video/:slug; Netlify may preserve the
    // original /video/:slug path when invoking the rewritten function.
    const videoPage = path.match(/^(?:(?:\/api)?\/seo)?\/video\/([^/]+)$/);
    if (videoPage && request.method === "GET") {
      return await handleVideoPage(request, videoPage[1]);
    }
    if ((path === "/api/oembed" || path === "/oembed") && request.method === "GET") {
      return await handleOEmbed(request);
    }
    if (path.startsWith("/api/public")) return await handlePublic(request, url, path);
    if (path.startsWith("/api/admin")) return await handleAdmin(request, url, path);
    return json({ error: "Not found", code: "not_found" }, { status: 404 });
  } catch (e) {
    const err = toError(e);
    const headers = {};
    if (err.status === 429) headers["retry-after"] = String(e.retryAfterSec ?? 30);
    if (err.status >= 500) console.error("[erobabe api]", e);
    return json({ error: err.message, code: err.code }, { status: err.status, headers });
  }
}
