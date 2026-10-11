import { SITE_URL } from "@/lib/site";
import { getPopularVideos } from "@/lib/public/catalog";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import type { Metadata } from "next";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Popular Videos",
  alternates: { canonical: `${SITE_URL}/popular` },
};

export default async function PopularPage() {
  const videos = await getPopularVideos();

  return (
    <div className="pt-4">
      <h1 className="text-[22px] font-semibold tracking-tight">Popular Videos</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Most viewed</p>

      {videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-semibold">No performance data available yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Popular videos will appear as views accumulate.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {videos.map((video) => (
            <PublicVideoCard key={video.slug} video={video} subtitle={`${video.view_count} views`} />
          ))}
        </div>
      )}
    </div>
  );
}
