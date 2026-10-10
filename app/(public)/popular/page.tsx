import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SITE_URL, formatDuration } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Popular Videos",
  alternates: { canonical: `${SITE_URL}/popular` },
};

export default async function PopularPage() {
  const supabase = await createClient();
  const { data: videos } = await supabase
    .from("videos")
    .select("id, slug, title, thumbnail_url, duration_seconds, view_count, published_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .order("view_count", { ascending: false })
    .limit(50);

  return (
    <div className="pt-4">
      <h1 className="text-[22px] font-semibold tracking-tight">Popular Videos</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Most viewed</p>

      {(!videos || videos.length === 0) ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-semibold">No performance data available yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Popular videos will appear as views accumulate.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {videos.map((v: any) => (
            <Link key={v.id} href={`/video/${v.slug}`} className="group">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
                <img src={v.thumbnail_url} alt={v.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                {v.duration_seconds && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">{formatDuration(v.duration_seconds)}</span>}
              </div>
              <h3 className="mt-2 line-clamp-2 text-[13px] font-medium group-hover:text-accent">{v.title}</h3>
              <p className="mt-1 text-[11px] text-ink-3">{v.view_count} views</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
