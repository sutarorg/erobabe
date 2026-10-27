import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/video/", "/category/", "/categories", "/latest", "/popular", "/about", "/terms", "/privacy", "/contact", "/faq", "/content-removal"],
        disallow: ["/admin", "/checkout", "/auth", "/api/"],
      },
      {
        userAgent: "Googlebot",
        allow: ["/", "/video/", "/category/", "/categories", "/latest", "/popular"],
        disallow: ["/admin", "/checkout", "/auth", "/api/"],
      },
    ],
    sitemap: [`${siteUrl}/sitemap.xml`, `${siteUrl}/video-sitemap.xml`],
  };
}
