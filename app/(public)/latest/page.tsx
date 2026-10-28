import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import { latestRecommendations } from "@/lib/recommendations/service";
import PaginatedLatestFeed from "@/src/components/PaginatedLatestFeed";
import type { Metadata } from "next";

export const revalidate = 30;
export const metadata: Metadata = publicPageMetadata({
  title: "Latest Videos",
  description:
    "Newest published adult videos on erobabe, listed in chronological order. 18+ only.",
  alternates: { canonical: `${SITE_URL}/latest` },
});

export default async function LatestPage() {
  const page = await latestRecommendations({ limit: 24 });
  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Newest first</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Latest Videos</h1>
        <span className="text-[12px] text-ink-3">Chronological browsing</span>
      </div>
      <p className="mt-1.5 max-w-[520px] text-[12.5px] leading-relaxed text-ink-3">Eligible published videos, newest first. This feed is not personalized.</p>
      {page.videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-semibold">No videos published yet</p>
        </div>
      ) : <PaginatedLatestFeed initialVideos={page.videos} initialCursor={page.cursor} />}
    </div>
  );
}
