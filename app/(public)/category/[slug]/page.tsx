import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL, formatDuration } from "@/lib/site";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: cat } = await supabase.from("categories").select("label").eq("slug", slug).single();
  if (!cat) return { title: "Category not found" };
  return {
    title: `${cat.label} Videos`,
    alternates: { canonical: `${SITE_URL}/category/${slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: category } = await supabase.from("categories").select("*").eq("slug", slug).single();
  if (!category) notFound();

  const { data: videos } = await supabase
    .from("videos")
    .select("id, slug, title, thumbnail_url, duration_seconds, view_count, published_at")
    .eq("category_id", category.id)
    .eq("status", "published")
    .eq("visibility", "public")
    .order("published_at", { ascending: false })
    .limit(50);

  return (
    <div className="pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Category</p>
      <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{category.label}</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">{videos?.length || 0} videos</p>

      {(!videos || videos.length === 0) ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-medium">No videos in this category yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Check back later for new content.</p>
          <Link href="/categories" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">
            Browse categories
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {videos.map((v: any) => (
            <Link key={v.id} href={`/video/${v.slug}`} className="group">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
                <img src={v.thumbnail_url} alt={v.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                {v.duration_seconds && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">{formatDuration(v.duration_seconds)}</span>
                )}
              </div>
              <h3 className="mt-2 line-clamp-2 text-[13px] font-medium group-hover:text-accent">{v.title}</h3>
              <p className="mt-1 text-[11px] text-ink-3">{v.view_count || 0} views</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
