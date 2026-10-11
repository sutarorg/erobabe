import { unstable_cache } from "next/cache";
import { tryCreateServiceClient } from "@/lib/supabase/server";

export type PublicVideo = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  view_count: number;
  published_at: string | null;
  quality: string | null;
  category_label: string | null;
  category_slug: string | null;
};

export type PublicCategory = {
  id: string;
  label: string;
  slug: string;
  icon: string | null;
};

export type PublicAd = {
  slot_id: number;
  creative: {
    id: string;
    title: string;
    image_url: string;
    destination_url: string;
    status: string;
  };
};

const VIDEO_SELECT = `
  id,
  slug,
  title,
  description,
  thumbnail_url,
  duration_seconds,
  quality,
  view_count,
  published_at,
  category:categories(label, slug)
`;

function mapVideo(row: any): PublicVideo {
  const category = Array.isArray(row.category) ? row.category[0] : row.category;
  return {
    id: String(row.slug || row.id),
    slug: String(row.slug || row.id),
    title: String(row.title || "Untitled"),
    description: row.description ? String(row.description) : null,
    thumbnail_url: row.thumbnail_url || null,
    duration_seconds: row.duration_seconds ?? null,
    view_count: Number(row.view_count) || 0,
    published_at: row.published_at || null,
    quality: row.quality || null,
    category_label: category?.label ? String(category.label) : null,
    category_slug: category?.slug ? String(category.slug) : null,
  };
}

function publishedQuery(supabase: NonNullable<ReturnType<typeof tryCreateServiceClient>>) {
  return supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved");
}

async function loadPublishedVideos(limit: number): Promise<PublicVideo[]> {
  const supabase = tryCreateServiceClient();
  if (!supabase) return [];
  const { data } = await publishedQuery(supabase).order("published_at", { ascending: false }).limit(limit);
  return (data || []).map(mapVideo);
}

async function loadPopularVideos(limit: number): Promise<PublicVideo[]> {
  const supabase = tryCreateServiceClient();
  if (!supabase) return [];
  const { data } = await publishedQuery(supabase).order("view_count", { ascending: false }).limit(limit);
  return (data || []).map(mapVideo);
}

async function loadCategories(): Promise<PublicCategory[]> {
  const supabase = tryCreateServiceClient();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("id, label, slug, icon").order("label");
  return (data || []).map((row: any) => ({
    id: String(row.id),
    label: String(row.label),
    slug: String(row.slug || ""),
    icon: row.icon ? String(row.icon) : null,
  }));
}

async function loadActiveAds(): Promise<PublicAd[]> {
  const supabase = tryCreateServiceClient();
  if (!supabase) return [];
  const now = new Date().toISOString().split("T")[0];
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      `
      id,
      slot_id,
      status,
      start_date,
      end_date,
      creative:ad_creatives(
        id,
        title,
        image_url,
        destination_url,
        status
      )
    `
    )
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now);

  return (campaigns || [])
    .map((campaign: any) => ({
      slot_id: Number(campaign.slot_id),
      creative: Array.isArray(campaign.creative) ? campaign.creative[0] : campaign.creative,
    }))
    .filter((campaign: any) => campaign.creative?.status === "approved" && campaign.creative?.image_url && campaign.creative?.destination_url);
}

export const getPublishedVideos = unstable_cache(async () => loadPublishedVideos(80), ["published-videos"], {
  revalidate: 30,
  tags: ["videos"],
});

export const getPopularVideos = unstable_cache(async () => loadPopularVideos(80), ["popular-videos"], {
  revalidate: 30,
  tags: ["videos"],
});

export const getPublicCategories = unstable_cache(loadCategories, ["public-categories"], {
  revalidate: 120,
  tags: ["categories"],
});

export const getActiveAds = unstable_cache(loadActiveAds, ["active-ads"], {
  revalidate: 60,
  tags: ["ads"],
});

export async function getCategoryBySlug(slug: string): Promise<{ category: PublicCategory | null; videos: PublicVideo[] }> {
  return unstable_cache(
    async () => {
      const supabase = tryCreateServiceClient();
      if (!supabase) return { category: null, videos: [] };
      const { data: category } = await supabase.from("categories").select("id, label, slug, icon").eq("slug", slug).maybeSingle();
      if (!category) return { category: null, videos: [] };
      const { data } = await publishedQuery(supabase)
        .eq("category_id", category.id)
        .order("published_at", { ascending: false })
        .limit(80);
      return {
        category: {
          id: String(category.id),
          label: String(category.label),
          slug: String(category.slug || slug),
          icon: category.icon ? String(category.icon) : null,
        },
        videos: (data || []).map(mapVideo),
      };
    },
    ["category-page", slug],
    { revalidate: 30, tags: ["videos", "categories"] }
  )();
}
