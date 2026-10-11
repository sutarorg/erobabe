import { SITE_URL } from "@/lib/site";
import { getPublishedVideos } from "@/lib/public/catalog";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import type { Metadata } from "next";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Latest Videos",
  alternates: { canonical: `${SITE_URL}/latest` },
};

export default async function LatestPage() {
  const videos = await getPublishedVideos();

  return (
    <div className="pt-4">
      <h1 className="text-[22px] font-semibold tracking-tight">Latest Videos</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Fresh uploads first</p>

      {videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-semibold">No videos published yet</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {videos.map((video) => (
            <PublicVideoCard
              key={video.slug}
              video={video}
              subtitle={video.published_at ? new Date(video.published_at).toLocaleDateString() : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
