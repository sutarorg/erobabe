import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

// /checkout is deliberately absent: it is listed in sitemap.xml, and a URL
// that robots.txt blocks cannot be indexed.
const DISALLOW = ["/admin", "/auth", "/api/"];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        userAgent: "Googlebot-Image",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        userAgent: "Googlebot-Video",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: [`${siteUrl}/sitemap.xml`, `${siteUrl}/video-sitemap.xml`],
    host: siteUrl.replace(/^https?:\/\//, ""),
  };
}
