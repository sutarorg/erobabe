import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import VideoGrid from "@/src/components/VideoGrid";
import Categories from "@/src/components/Categories";
import Hero from "@/src/components/Hero";
import VideoSection from "@/src/components/VideoSection";
import InlineAd from "@/src/components/InlineAd";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "erobabe — Premium Adult Entertainment",
  description: "Your destination for discovering premium adult entertainment. 18+ adults only.",
  alternates: { canonical: SITE_URL },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  // Fetch categories
  const { data: categoriesData } = await supabase
    .from("categories")
    .select("id, label, slug, icon")
    .order("label");

  // Only serializable primitives may cross the server/client boundary.
  const categories = (categoriesData || []).map((c: any) => ({
    id: String(c.id),
    label: String(c.label),
    slug: c.slug ? String(c.slug) : undefined,
    icon: c.icon ? String(c.icon) : undefined,
  }));

  // Fetch published videos
  let query = supabase
    .from("videos")
    .select(`
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
    `)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .order("published_at", { ascending: false })
    .limit(50);

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data: videos } = await query;

  // Map to legacy Video type for existing components
  const mappedVideos = (videos || []).map((v: any) => ({
    id: v.slug,
    title: v.title,
    category: v.category?.label || "Mature",
    duration: v.duration_seconds ? `${Math.floor(v.duration_seconds / 60)}:${String(v.duration_seconds % 60).padStart(2, "0")}` : "—",
    quality: (v.quality as "4K" | "HD") || "HD",
    views: v.view_count ? `${(v.view_count / 1000).toFixed(1)}K` : "0",
    viewsNum: v.view_count || 0,
    added: v.published_at ? new Date(v.published_at).toLocaleDateString() : "Recently",
    daysAgo: v.published_at ? Math.floor((Date.now() - new Date(v.published_at).getTime()) / 86400000) : 0,
    rating: 95,
    thumb: v.thumbnail_url || "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
    alt: v.title,
    description: v.description || "",
  }));

  const featuredVideos = mappedVideos.slice(0, 20);
  const latestVideos = mappedVideos.slice(0, 16);

  if (q) {
    return (
      <div className="pt-4">
        <div className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Search</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Results for “{q}”</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">{mappedVideos.length} videos found</p>
        </div>
        {mappedVideos.length === 0 ? (
          <div className="rounded-lg border border-line bg-card p-8 text-center">
            <p className="text-[14px] font-medium">No videos found</p>
            <p className="mt-1 text-[12.5px] text-ink-3">Try a different search term or browse categories.</p>
            <Link href="/" className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft">
              Back to home
            </Link>
          </div>
        ) : (
          <VideoGrid videos={mappedVideos} maxColumns={5} className="video-grid mt-3.5" />
        )}
      </div>
    );
  }

  if (mappedVideos.length === 0) {
    return (
      <div className="pt-4">
        <Hero />
        <div className="mt-12 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[16px] font-semibold">No videos published yet</p>
          <p className="mt-2 text-[13px] text-ink-3">The library is being prepared. Check back soon for premium content.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <Hero />

      <section className="mt-7">
        <Categories activeCategory={null} categories={categories} />
      </section>

      <section className="mt-8">
        <VideoSection title="Featured Videos">
          <div className="video-grid mt-3.5 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {featuredVideos.map((video: any) => (
              <Link key={video.id} href={`/video/${video.id}`} className="group">
                <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
                  <img src={video.thumb} alt={video.alt} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">{video.duration}</span>
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">{video.quality}</span>
                </div>
                <h3 className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight text-ink group-hover:text-accent">{video.title}</h3>
                <p className="mt-1 text-[11px] text-ink-3">{video.category} • {video.views} views</p>
              </Link>
            ))}
          </div>
        </VideoSection>
      </section>

      <div className="mt-8">
        <InlineAd />
      </div>

      <section className="mt-8">
        <VideoSection title="Latest Videos">
          <div className="video-grid mt-3.5 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {latestVideos.map((video: any) => (
              <Link key={video.id} href={`/video/${video.id}`} className="group">
                <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
                  <img src={video.thumb} alt={video.alt} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">{video.duration}</span>
                </div>
                <h3 className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight text-ink group-hover:text-accent">{video.title}</h3>
                <p className="mt-1 text-[11px] text-ink-3">{video.added}</p>
              </Link>
            ))}
          </div>
        </VideoSection>
      </section>
    </div>
  );
}
