import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://erobabe.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/video/", "/category/", "/categories", "/latest", "/popular", "/about", "/terms", "/privacy", "/contact", "/faq", "/content-removal"],
        disallow: ["/admin/", "/advertiser/", "/auth/", "/api/"],
      },
      {
        userAgent: "Googlebot",
        allow: ["/", "/video/", "/category/", "/categories", "/latest", "/popular"],
        disallow: ["/admin/", "/advertiser/", "/auth/", "/api/"],
      },
    ],
    sitemap: [`${siteUrl}/sitemap.xml`, `${siteUrl}/video-sitemap.xml`],
  };
}
