import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import { getPopularVideos } from "@/lib/public/catalog";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import type { Metadata } from "next";

export const revalidate = 30;

export const metadata: Metadata = publicPageMetadata({
  title: "Popular Videos",
  description: "Discover popular videos on Erobabe, ordered by views. Explore the collection and browse related categories. Exclusively for adults aged 18 and over.",
  alternates: { canonical: `${SITE_URL}/popular` },
});

export default async function PopularPage() {
  const videos = await getPopularVideos();

  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
        Most Viewed
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">
          Popular Videos
        </h1>
        <span className="text-[12px] tabular-nums text-ink-3">
          {videos.length} videos
        </span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Published videos ordered by recorded watch-page views.
      </p>

      {videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-semibold">No popular videos yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Popular videos will appear here as the library receives views.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 @md:grid-cols-3 @lg:grid-cols-4">
          {videos.map((video) => (
            <PublicVideoCard key={video.slug} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
