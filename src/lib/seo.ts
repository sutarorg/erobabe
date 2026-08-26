import { useEffect } from "react";

/**
 * Client-side SEO manager: unique titles/descriptions, canonical URLs,
 * Open Graph + Twitter tags and Schema.org JSON-LD per route.
 * Every page calls useSEO(); on unmount the <head> returns to site defaults.
 */

export const siteOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "https://erobabe.com";

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
const BASE_DESC =
  "Stream premium 18+ adult videos online on EroBabe — trending categories, cinematic playback, fast private browsing and new releases daily. Adults only.";
const BASE_IMAGE = "https://erobabe.com/assets/hero.jpg";
const BASE_ROBOTS = "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1";

export function websiteSchema(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "EroBabe",
    url: `${origin}/`,
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

export interface SeoOptions {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  type?: string;
  image?: string;
  video?: { url: string; mime?: string; durationS?: number; publishedAt?: string };
  schema?: Record<string, unknown> | null;
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

function setSchema(data: Record<string, unknown> | null) {
  document.getElementById("eb-schema")?.remove();
  if (!data) return;
  const script = document.createElement("script");
  script.id = "eb-schema";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
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

  setSchema(o.schema === undefined ? websiteSchema(origin) : o.schema);
}

export function useSEO(options: SeoOptions): void {
  const key = JSON.stringify(options);
  useEffect(() => {
    applySEO(options);
    return () => applySEO();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
