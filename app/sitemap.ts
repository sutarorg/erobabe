import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";
import { tryCreateServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/categories`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/latest`,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/popular`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/about`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/terms`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/dmca`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/2257`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/parental-controls`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/contact`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/faq`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/content-removal`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];

  try {
    const supabase = tryCreateServiceClient();
    if (!supabase) return staticPages;

    const { data: categories } = await supabase
      .from("categories")
      .select("slug, updated_at");
    const categoryPages: MetadataRoute.Sitemap = (categories || []).map(
      (c: any) => ({
        url: `${siteUrl}/category/${c.slug}`,
        lastModified: c.updated_at ? new Date(c.updated_at) : new Date(),
        changeFrequency: "daily" as const,
        priority: 0.7,
      }),
    );

    const videos: Array<{ slug: string; updated_at?: string; published_at?: string }> = [];
    for (let offset = 0; offset < 45000; offset += 1000) {
      const { data, error } = await supabase
        .from("videos")
        .select("slug, updated_at, published_at")
        .eq("requires_reupload", false)
        .eq("status", "published")
        .eq("visibility", "public")
        .eq("rights_status", "cleared")
        .eq("moderation_status", "approved")
        .order("published_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      videos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const videoPages: MetadataRoute.Sitemap = (videos || []).map((v: any) => ({
      url: `${siteUrl}/video/${v.slug}`,
      lastModified: v.updated_at
        ? new Date(v.updated_at)
        : v.published_at
          ? new Date(v.published_at)
          : new Date(),
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
