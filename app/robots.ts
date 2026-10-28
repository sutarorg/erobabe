import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

const DISALLOW = ["/admin", "/checkout", "/auth", "/api/"];

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
