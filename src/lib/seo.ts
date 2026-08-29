import { useEffect } from "react";

/**
 * Client-side SEO manager: unique titles/descriptions, canonical URLs,
 * Open Graph + Twitter tags and Schema.org JSON-LD per route.
 * Every page calls useSEO(); on unmount the <head> returns to site defaults.
 * Admin overrides saved in the CMS are merged in via withOverride().
 */

import { publicSettings } from "@/data/dynamic";

export const siteOrigin = () => {
  if (typeof window === "undefined") return "https://erobabe.com";
  // Deployed previews also canonicalize to the purchased production domain.
  // Local development stays local so navigation remains convenient.
  return /localhost|127\.0\.0\.1/.test(window.location.hostname)
    ? window.location.origin
    : "https://erobabe.com";
};

export const absUrl = (url: string) =>
  /^https?:\/\//i.test(url) ? url : `${siteOrigin()}${url.startsWith("/") ? "" : "/"}${url}`;

export const isoDuration = (s: number) => {
  if (!s || s <= 0) return undefined;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m}M${sec}S`;
};

const BASE_TITLE = "EroBabe — Watch 18+ Adult Videos Online | erobabe.com";
/** The default website description, reused as the fallback on every page. */
export const SITE_DESCRIPTION =
  "Stream premium 18+ adult videos online on EroBabe — trending categories, cinematic playback, fast private browsing and new releases daily. Adults only.";
const BASE_DESC = SITE_DESCRIPTION;
const BASE_IMAGE = "https://erobabe.com/assets/hero.jpg";
const BASE_ROBOTS = "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1";

export function websiteSchema(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: "EroBabe",
    url: `${origin}/`,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${origin}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** Publisher entity, referenced by every other schema object. */
export function organizationSchema(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "EroBabe",
    url: `${origin}/`,
    logo: {
      "@type": "ImageObject",
      url: `${origin}/favicon.svg`,
    },
    description: SITE_DESCRIPTION,
  };
}

/**
 * Combines several schema objects into one @graph so entities reference
 * each other by @id — how Google prefers connected structured data.
 */
export function schemaGraph(origin: string, ...nodes: Record<string, unknown>[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@id": `${origin}/#organization` },
      { "@id": `${origin}/#website` },
      ...nodes,
    ],
  };
}

/** A browseable listing page (categories, trending, popular, etc.). */
export function collectionSchema(
  origin: string,
  path: string,
  name: string,
  description: string,
  items: { name: string; url: string }[] = []
) {
  return {
    "@type": "CollectionPage",
    "@id": `${origin}${path}#webpage`,
    url: `${origin}${path}`,
    name,
    description,
    isPartOf: { "@id": `${origin}/#website` },
    ...(items.length
      ? {
          hasPart: items.slice(0, 20).map((item) => ({
            "@type": "WebPage",
            name: item.name,
            url: item.url,
          })),
        }
      : {}),
  };
}

/** Breadcrumb trail — helps Google build sitelinks. */
export function breadcrumbSchema(
  origin: string,
  trail: { name: string; path: string }[]
) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${origin}${item.path}`,
    })),
  };
}

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Admin-entered tags, emitted as <meta name="keywords">. */
  keywords?: string[];
  canonical?: string;
  robots?: string;
  type?: string;
  image?: string;
  video?: { url: string; mime?: string; durationS?: number; publishedAt?: string };
  schema?: Record<string, unknown> | Record<string, unknown>[] | null;
}

function setMeta(attr: "name" | "property", key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Accepts a single object or a @graph, and always emits one script tag. */
function setSchema(data: Record<string, unknown> | Record<string, unknown>[] | null) {
  document.getElementById("eb-schema")?.remove();
  if (!data) return;
  const payload = Array.isArray(data) ? { "@context": "https://schema.org", "@graph": data } : data;
  const script = document.createElement("script");
  script.id = "eb-schema";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(payload);
  document.head.appendChild(script);
}

export function applySEO(o: SeoOptions = {}): void {
  const origin = siteOrigin();
  const title = o.title ?? BASE_TITLE;
  const description = o.description ?? BASE_DESC;
  const canonical =
    o.canonical ??
    origin + (typeof window !== "undefined" ? window.location.pathname : "/");
  const image = o.image ? absUrl(o.image) : BASE_IMAGE;
  const type = o.type ?? "website";
  const robots = o.robots ?? BASE_ROBOTS;

  document.title = title;

  setMeta("name", "description", description);
  setMeta("name", "robots", robots);
  setMeta("name", "keywords", o.keywords?.length ? o.keywords.join(", ") : null);
  setCanonical(canonical);

  setMeta("property", "og:site_name", "EroBabe");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", canonical);
  setMeta("property", "og:type", type);
  setMeta("property", "og:image", image);

  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", image);

  // Video-specific Open Graph tags.
  const videoTags: [string, string | null][] = o.video
    ? [
        ["og:video", o.video.url],
        ["og:video:url", o.video.url],
        ["og:video:secure_url", o.video.url],
        ["og:video:type", o.video.mime ?? "video/mp4"],
        ["og:video:duration", o.video.durationS ? String(o.video.durationS) : null],
        ["og:video:release_date", o.video.publishedAt ?? null],
      ]
    : [
        ["og:video", null],
        ["og:video:url", null],
        ["og:video:secure_url", null],
        ["og:video:type", null],
        ["og:video:duration", null],
        ["og:video:release_date", null],
      ];
  for (const [key, value] of videoTags) setMeta("property", key, value);

  // Default to the site graph; pages supply their own richer data.
  setSchema(o.schema === undefined ? schemaGraph(origin) : o.schema);
}

export function useSEO(options: SeoOptions): void {
  const key = JSON.stringify(options);
  useEffect(() => {
    applySEO(options);
    return () => applySEO();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Resolve the admin's saved override for a path, if any.
 * Returns values that should replace the page's generated defaults.
 */
export function seoOverrideFor(path: string) {
  const all = publicSettings.seo;
  if (!all || !Object.keys(all).length) return null;
  const exact = all[path];
  if (exact) return exact;
  // Trailing-slash tolerance.
  const alt = all[path.endsWith("/") && path !== "/" ? path.slice(0, -1) : `${path}/`];
  return alt ?? null;
}

/**
 * Merge a page's generated SEO with any admin override for that path.
 * Null/empty override fields fall through to the generated value, so
 * admins only override what they deliberately set.
 */
export function withOverride(
  path: string,
  generated: SeoOptions
): SeoOptions {
  const o = seoOverrideFor(path);
  if (!o) return generated;

  const merged: SeoOptions = { ...generated };

  if (o.seoTitle) merged.title = o.seoTitle;
  if (o.metaDescription) merged.description = o.metaDescription;
  if (o.keywords) {
    merged.keywords = o.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  if (o.canonicalUrl) merged.canonical = o.canonicalUrl;
  if (o.robots) merged.robots = o.robots;
  if (o.ogTitle) merged.title = o.ogTitle; // OG title defaults to the page title
  if (o.ogDescription) merged.description = o.ogDescription;
  if (o.ogImage) merged.image = o.ogImage;

  // Extra JSON-LD is appended to whatever the page already emits.
  if (o.jsonLd) {
    let extra: Record<string, unknown> | null = null;
    try {
      extra = JSON.parse(o.jsonLd);
    } catch {
      extra = null;
    }
    if (extra) {
      const base = Array.isArray(generated.schema) ? generated.schema : generated.schema ? [generated.schema] : [];
      merged.schema = [...base, extra];
    }
  }

  if (o.inSitemap === false) {
    merged.robots = merged.robots?.includes("noindex")
      ? merged.robots
      : `noindex, ${merged.robots?.includes("nofollow") ? "nofollow" : "follow"}`;
  }

  return merged;
}
