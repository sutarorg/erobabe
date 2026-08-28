import { dbApi, dbConfigMissing, hasColumn } from "./db.mjs";
import { ENV } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Server-rendered video page metadata.
 *
 * WhatsApp, Telegram, X, Facebook, Discord and many other link
 * unfurlers do not execute the React application. This handler
 * resolves a published video by slug, injects its metadata into the
 * app shell, and adds crawlable body content before returning HTML.
 * Humans still receive and run the normal React application.
 * ────────────────────────────────────────────────────────────── */

const CANONICAL_ORIGIN = "https://erobabe.com";
const DEFAULT_DESCRIPTION =
  "Stream premium 18+ adult videos online on EroBabe — trending categories, cinematic playback, fast private browsing and new releases daily. Adults only.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,100}$/i;

const html = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const absolute = (value, origin = CANONICAL_ORIGIN) => {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim(), origin);
    // Link-preview crawlers reject non-HTTPS images, and many refuse
    // localhost/private hosts outright.
    if (url.protocol === "http:" && !/^localhost|^127\./.test(url.hostname)) {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * Best available preview image for a video.
 *
 * Order: the video's own thumbnail → its poster/first-frame if stored →
 * the site hero as a last resort. Always returns an absolute HTTPS URL,
 * because WhatsApp and Facebook silently drop relative or insecure ones.
 */
function previewImage(video) {
  const candidates = [video.thumbnail_url, video.poster_url, video.preview_url];
  for (const candidate of candidates) {
    const url = absolute(candidate);
    if (url) return url;
  }
  return `${CANONICAL_ORIGIN}/assets/hero.jpg`;
}

const isoDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (!s) return undefined;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec}S`;
};

const imageMime = (url) => {
  const path = String(url || "").split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

function canonicalOrigin() {
  const configured = String(ENV("SITE_URL", "")).trim().replace(/\/+$/, "");
  if (configured && /^https:\/\//i.test(configured) && !/localhost|vercel\.app|netlify\.app/i.test(configured)) {
    return configured;
  }
  return CANONICAL_ORIGIN;
}

async function findPublishedVideo(ref) {
  if (dbConfigMissing()) return null;
  const hasSlug = await hasColumn("videos", "slug");
  const hasLikes = await hasColumn("videos", "likes");
  const cols = [
    "id", "title", "description", "status", "tags", "duration_s", "views",
    "thumbnail_url", "video_url", "hls_url", "published_at", "updated_at",
    "created_at", "category_id", "like_ratio", "seo_title", "seo_description",
    hasSlug ? "slug" : null,
    hasLikes ? "likes" : null,
  ].filter(Boolean).join(",");

  if (hasSlug && SLUG_RE.test(ref)) {
    const row = await dbApi
      .one("videos", `slug=eq.${encodeURIComponent(ref)}&status=eq.published&select=${cols}`)
      .catch(() => null);
    if (row) return row;
  }
  if (UUID_RE.test(ref)) {
    return dbApi.one("videos", `id=eq.${ref}&status=eq.published&select=${cols}`).catch(() => null);
  }
  return null;
}

async function categoryFor(id) {
  if (!id) return null;
  return dbApi.one("categories", `id=eq.${id}&select=name,slug`).catch(() => null);
}

/** Remove static defaults so crawlers never encounter conflicting tags. */
function stripDefaultMetadata(shell) {
  return shell
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|keywords|robots|twitter:[^"']+|og:[^"']+)["'][^>]*>\s*/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
    .replace(/<script[^>]+id=["']eb-schema["'][^>]*>[\s\S]*?<\/script>\s*/gi, "");
}

function fallbackShell() {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>`;
}

async function loadAppShell(request) {
  // Fetch the static production app shell from the same deployment. This
  // avoids embedding generated bundle names in server code.
  try {
    const current = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || current.host;
    const forwardedProto = request.headers.get("x-forwarded-proto") || current.protocol.replace(":", "") || "https";
    const url = `${forwardedProto}://${forwardedHost}/index.html`;
    const response = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "EroBabe-SEO-Renderer/1.0" },
    });
    if (response.ok) return response.text();
  } catch {
    /* fallback below */
  }
  return fallbackShell();
}

function metadata({ video, category, canonical }) {
  // Share cards show the actual video title, thumbnail and description.
  const title = String(video.title || "EroBabe Video").trim().slice(0, 180);
  const description = String(video.description || DEFAULT_DESCRIPTION).replace(/\s+/g, " ").trim().slice(0, 300);
  const image = previewImage(video);
  const media = absolute(video.hls_url || video.video_url);
  const mime = video.hls_url ? "application/vnd.apple.mpegurl" : "video/mp4";
  const tags = Array.isArray(video.tags) ? video.tags.filter(Boolean).slice(0, 20) : [];
  const uploadDate = video.published_at || video.created_at;
  const duration = isoDuration(video.duration_s);

  const videoObject = {
    "@type": "VideoObject",
    "@id": `${canonical}#video`,
    name: title,
    headline: title,
    description,
    thumbnailUrl: [image],
    uploadDate,
    datePublished: uploadDate,
    dateModified: video.updated_at || uploadDate,
    duration,
    contentUrl: media || undefined,
    embedUrl: canonical,
    url: canonical,
    genre: category?.name || undefined,
    keywords: tags.join(", ") || undefined,
    isFamilyFriendly: false,
    contentRating: "18+",
    inLanguage: "en",
    isAccessibleForFree: true,
    requiresSubscription: false,
    publisher: {
      "@type": "Organization",
      "@id": `${canonicalOrigin()}/#organization`,
      name: "EroBabe",
      url: `${canonicalOrigin()}/`,
      logo: {
        "@type": "ImageObject",
        url: `${canonicalOrigin()}/favicon.svg`,
      },
    },
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: Number(video.views) || 0,
    },
    potentialAction: {
      "@type": "WatchAction",
      target: canonical,
    },
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      videoObject,
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description,
        primaryImageOfPage: { "@type": "ImageObject", url: image },
        mainEntity: { "@id": `${canonical}#video` },
        isPartOf: { "@type": "WebSite", name: "EroBabe", url: `${canonicalOrigin()}/` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${canonicalOrigin()}/` },
          ...(category
            ? [{ "@type": "ListItem", position: 2, name: category.name, item: `${canonicalOrigin()}/category/${category.slug}` }]
            : []),
          { "@type": "ListItem", position: category ? 3 : 2, name: title, item: canonical },
        ],
      },
    ],
  };

  const meta = `
    <title>${html(title)}</title>
    <meta name="description" content="${html(description)}">
    <meta name="keywords" content="${html(tags.join(", "))}">
    <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">
    <link rel="canonical" href="${html(canonical)}">

    <meta property="og:site_name" content="EroBabe">
    <meta property="og:type" content="video.other">
    <meta property="og:title" content="${html(title)}">
    <meta property="og:description" content="${html(description)}">
    <meta property="og:url" content="${html(canonical)}">
    <meta property="og:image" content="${html(image)}">
    <meta property="og:image:secure_url" content="${html(image)}">
    <meta property="og:image:type" content="${imageMime(image)}">
    <!-- WhatsApp and Facebook need explicit dimensions to render a large
         card; without them the preview often falls back to a tiny icon. -->
    <meta property="og:image:width" content="1280">
    <meta property="og:image:height" content="720">
    <meta property="og:image:alt" content="${html(`${title} video thumbnail`)}">
    ${media ? `<meta property="og:video" content="${html(media)}"><meta property="og:video:secure_url" content="${html(media)}"><meta property="og:video:type" content="${mime}">` : ""}
    ${video.duration_s ? `<meta property="og:video:duration" content="${Math.round(video.duration_s)}">` : ""}

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${html(title)}">
    <meta name="twitter:description" content="${html(description)}">
    <meta name="twitter:image" content="${html(image)}">
    <meta name="twitter:image:alt" content="${html(`${title} video thumbnail`)}">

    <link rel="alternate" type="application/json+oembed" href="${html(`${canonicalOrigin()}/api/oembed?url=${encodeURIComponent(canonical)}&format=json`)}" title="${html(title)}">

    <script type="application/ld+json" id="eb-schema">${safeJson(graph)}</script>
  `;

  const crawlable = `
    <article id="seo-video-content" itemscope itemtype="https://schema.org/VideoObject" style="min-height:100vh;background:#050506;color:#f5f1f4;font-family:system-ui,sans-serif;padding:24px;box-sizing:border-box">
      <div style="max-width:1100px;margin:0 auto">
        <a href="/" style="color:#fb6fa8;text-decoration:none;font-weight:700">EroBabe</a>
        <p style="font-size:12px;color:#9d93a0">18+ Adults Only</p>
        <h1 itemprop="name" style="font-size:clamp(24px,5vw,44px);line-height:1.1;margin:24px 0 14px">${html(title)}</h1>
        <img itemprop="thumbnailUrl" src="${html(image)}" alt="${html(`${title} video thumbnail`)}" width="1280" height="720" style="display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#111;border-radius:14px">
        <p itemprop="description" style="max-width:760px;line-height:1.6;color:#bdb3bc">${html(description)}</p>
        ${category ? `<p><a href="/category/${html(category.slug)}" style="color:#fda4c8">${html(category.name)}</a></p>` : ""}
        ${tags.length ? `<p style="color:#9d93a0">${tags.map((tag) => `<span>${html(tag)}</span>`).join(" · ")}</p>` : ""}
        <meta itemprop="uploadDate" content="${html(uploadDate)}">
        ${duration ? `<meta itemprop="duration" content="${duration}">` : ""}
        ${media ? `<link itemprop="contentUrl" href="${html(media)}">` : ""}
      </div>
    </article>
  `;

  return { meta, crawlable };
}

export async function handleVideoPage(request, ref) {
  const video = await findPublishedVideo(decodeURIComponent(ref || ""));
  if (!video) {
    return new Response("Video not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }

  const category = await categoryFor(video.category_id);
  const origin = canonicalOrigin();
  const slug = video.slug || video.id;
  const canonical = `${origin}/video/${encodeURIComponent(slug)}`;
  const { meta, crawlable } = metadata({ video, category, canonical });

  let shell = stripDefaultMetadata(await loadAppShell(request));
  shell = shell.replace(/<\/head>/i, `${meta}</head>`);
  shell = shell.replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root">${crawlable}</div>`);

  return new Response(shell, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Metadata changes when admins edit title/description/thumbnail.
      "cache-control": "no-cache, no-store, must-revalidate",
      "x-robots-tag": "index, follow, max-image-preview:large, max-video-preview:-1",
      "link": `<${canonical}>; rel="canonical"`,
    },
  });
}

/** JSON oEmbed response for platforms that discover it from the HTML. */
export async function handleOEmbed(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";
  let ref = "";
  try {
    const targetUrl = new URL(target, canonicalOrigin());
    const match = targetUrl.pathname.match(/^\/(?:video|watch)\/([^/]+)$/);
    ref = match?.[1] || "";
  } catch {
    ref = "";
  }
  const video = await findPublishedVideo(decodeURIComponent(ref));
  if (!video) {
    return new Response(JSON.stringify({ error: "Video not found" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const slug = video.slug || video.id;
  const canonical = `${canonicalOrigin()}/video/${encodeURIComponent(slug)}`;
  const thumbnail = previewImage(video);
  const description = String(video.description || DEFAULT_DESCRIPTION).replace(/\s+/g, " ").trim().slice(0, 300);
  return new Response(
    JSON.stringify({
      version: "1.0",
      type: "video",
      provider_name: "EroBabe",
      provider_url: `${canonicalOrigin()}/`,
      title: video.title,
      author_name: "Erobabe Studio",
      author_url: `${canonicalOrigin()}/`,
      thumbnail_url: thumbnail,
      html: `<iframe src="${html(canonical)}" width="960" height="540" frameborder="0" allowfullscreen></iframe>`,
      width: 960,
      height: 540,
      description,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}