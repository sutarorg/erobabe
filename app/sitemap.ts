import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";
import { tryCreateServiceClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/categories`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/latest`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/popular`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/browser`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${siteUrl}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/faq`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/content-removal`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
  ];

  try {
    const supabase = tryCreateServiceClient();
    if (!supabase) return staticPages;

    const { data: categories } = await supabase.from("categories").select("slug, updated_at");
    const categoryPages: MetadataRoute.Sitemap =
      (categories || []).map((c: any) => ({
        url: `${siteUrl}/category/${c.slug}`,
        lastModified: c.updated_at ? new Date(c.updated_at) : new Date(),
        changeFrequency: "daily" as const,
        priority: 0.7,
      }));

    const { data: videos } = await supabase
      .from("videos")
      .select("slug, updated_at, published_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("rights_status", "cleared")
      .eq("moderation_status", "approved")
      .order("published_at", { ascending: false })
      .limit(5000);

    const videoPages: MetadataRoute.Sitemap =
      (videos || []).map((v: any) => ({
        url: `${siteUrl}/video/${v.slug}`,
        lastModified: v.updated_at ? new Date(v.updated_at) : v.published_at ? new Date(v.published_at) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      }));

    return [...staticPages, ...categoryPages, ...videoPages];
  } catch (e) {
    // If Supabase not configured, return static only
    console.warn("sitemap: supabase error, returning static only", e);
    return staticPages;
  }
}
