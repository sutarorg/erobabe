import VideoComments from "@/src/components/VideoComments";
import LatestVideoFeed from "@/src/components/LatestVideoFeed";
import WatchCategories from "@/src/components/WatchCategories";
import { getRecommendationFeed } from "@/lib/recommendations/service";
import RecommendationShelf from "@/src/components/RecommendationShelf";

import { getPublicCategories, type PublicVideo } from "@/lib/public/catalog";
import ViewTracker from "@/src/components/ViewTracker";
import { createClient } from "@/lib/supabase/server";
import {
  isStreamProxyUrl,
  playbackCandidates,
  selectPlaybackSource,
} from "@/lib/video/playback";
import { SITE_URL, formatDuration, formatTimeAgo } from "@/lib/site";
import { SHELF_VIDEO_LIMIT } from "@/lib/public/shelf";
import VideoActions from "@/src/components/VideoActions";
import VideoPlayer from "@/src/components/VideoPlayer";
import FourRowVideoGrid from "@/src/components/FourRowVideoGrid";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import { Eye } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense, cache } from "react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const video = await loadWatchVideo(slug);

  if (!video) {
    notFound();
  }

  return {
    title: video.title,
    description: video.description || `${video.title} — watch on erobabe`,
    alternates: { canonical: `${SITE_URL}/video/${slug}` },
    openGraph: {
      title: video.title,
      description: video.description || "",
      images: video.thumbnail_url ? [video.thumbnail_url] : [],
      type: "video.other",
      url: `${SITE_URL}/video/${slug}`,
    },
  };
}

/** Skeleton for one shelf; each watch-page shelf streams in on its own. */
function WatchShelfFallback({ title }: { title: string }) {
  return (
    <section
      className="mt-8 border-t border-line pt-5"
      aria-label={`Loading ${title}`}
    >
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div
        className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-hidden
      >
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="aspect-video animate-pulse rounded-lg bg-card" />
        ))}
      </div>
    </section>
  );
}

const VIDEO_COLUMNS = `
  id,
  slug,
  title,
  description,
  thumbnail_url,
  provider,
  provider_file_id,
  source_name,
  source_url,
  playable_url,
  embed_url,
  duration_seconds,
  quality,
  view_count,
  published_at,
  category_id,
  category:categories(label, slug)
`;

/** Everything the watch page reads; mirrors `VIDEO_COLUMNS` above. */
type WatchVideo = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  provider: string | null;
  provider_file_id: string | null;
  source_name: string | null;
  source_url: string | null;
  playable_url: string | null;
  embed_url: string | null;
  duration_seconds: number | null;
  quality: string | null;
  view_count: number | null;
  published_at: string | null;
  category_id: string | null;
  category: { label: string | null; slug: string | null } | null;
};

/**
 * The video row, fetched once per request.
 *
 * `generateMetadata` and the page both need it, so it is memoized with React's
 * `cache`: without that, metadata awaited a second copy of the same query and
 * the player HTML waited for both round trips.
 */
const loadWatchVideo = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select(VIDEO_COLUMNS)
    .eq("slug", slug)
    .eq("requires_reupload", false)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .or("playable_url.not.is.null,embed_url.not.is.null")
    .single();
  return (data ?? null) as WatchVideo | null;
});

/** More like this: the current category first, then ranked suggestions. */
async function loadRelatedVideos(video: WatchVideo): Promise<PublicVideo[]> {
  const supabase = await createClient();
  const { data: related } = await supabase
    .from("videos")
    .select(
      "id, slug, title, thumbnail_url, duration_seconds, quality, view_count, published_at",
    )
    .eq("requires_reupload", false)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .or("playable_url.not.is.null,embed_url.not.is.null")
    .eq("category_id", video.category_id)
    .neq("id", video.id)
    .order("published_at", { ascending: false })
    .limit(SHELF_VIDEO_LIMIT);

  const relatedVideos: PublicVideo[] = (related || [])
    .slice(0, SHELF_VIDEO_LIMIT)
    .map((item: any) => ({
      ...item,
      description: null,
      category_label: null,
      category_slug: null,
    }));
  const seen = new Set(relatedVideos.map((item) => String(item.id)));
  if (relatedVideos.length >= SHELF_VIDEO_LIMIT) return relatedVideos;

  // A small category is topped up from the ranked feed, but this shelf never
  // waits for the separate Recommended or Most Liked requests.
  const topUp = await getRecommendationFeed({
    surface: "recommended",
    currentVideoId: video.id,
    limit: SHELF_VIDEO_LIMIT,
  });
  for (const suggestion of topUp.videos) {
    if (relatedVideos.length >= SHELF_VIDEO_LIMIT) break;
    if (seen.has(String(suggestion.id))) continue;
    seen.add(String(suggestion.id));
    relatedVideos.push({
      ...suggestion,
      description: null,
      category_label: null,
      category_slug: null,
    } as PublicVideo);
  }
  return relatedVideos;
}

async function loadShelf(video: WatchVideo, surface: "recommended" | "most_liked") {
  return getRecommendationFeed({
    surface,
    currentVideoId: video.id,
    limit: SHELF_VIDEO_LIMIT,
  });
}

/** Presentational "More like this" shelf. */
export async function RelatedVideos({ video }: { video: WatchVideo }) {
  const videos = await loadRelatedVideos(video);
  return (
    <section className="mt-8 border-t border-line pt-5" aria-label="More like this">
      <h2 className="text-[15px] font-semibold">More like this</h2>
      <FourRowVideoGrid className="video-grid mt-3.5">
        {videos.map((item) => (
          <PublicVideoCard key={item.id} video={item} />
        ))}
      </FourRowVideoGrid>
      {!videos.length && <p className="mt-3 text-sm text-ink-3">No videos available yet.</p>}
    </section>
  );
}

/** Recommended shelf, streamed independently of every other watch-page shelf. */
export async function RecommendedForYou({ video }: { video: WatchVideo }) {
  const recommended = await loadShelf(video, "recommended");
  return (
    <RecommendationShelf
      title={recommended.personalized ? "Recommended for you" : "Discover videos"}
      videos={recommended.videos}
      surface="recommended"
      correlationId={recommended.correlationId}
      algorithmVersion={recommended.algorithmVersion}
    />
  );
}

/** Popularity shelf, also independent. */
export async function MostLiked({ video }: { video: WatchVideo }) {
  const mostLiked = await loadShelf(video, "most_liked");
  return (
    <RecommendationShelf
      title="Most Liked"
      videos={mostLiked.videos}
      surface="most_liked"
      correlationId={mostLiked.correlationId}
      algorithmVersion={mostLiked.algorithmVersion}
    />
  );
}

/** The category strip; a third independent section. */
export async function TopCategories({ video }: { video: WatchVideo }) {
  const categories = await getPublicCategories();
  return (
    <WatchCategories
      categories={categories}
      activeCategory={video.category?.label ?? null}
    />
  );
}

/**
 * All watch-page shelves in order.
 *
 * The page itself mounts each of these in its own `Suspense` boundary, so the
 * player is streamed as soon as the video row is known and a slow feed only
 * delays its own shelf. This composed form remains available for callers that
 * want the whole list at once.
 */
export async function WatchSuggestions({ video }: { video: WatchVideo }) {
  const [related, recommended, mostLiked, categories] = await Promise.all([
    loadRelatedVideos(video),
    loadShelf(video, "recommended"),
    loadShelf(video, "most_liked"),
    getPublicCategories(),
  ]);

  return (
    <>
      <section className="mt-8 border-t border-line pt-5" aria-label="More like this">
        <h2 className="text-[15px] font-semibold">More like this</h2>
        <FourRowVideoGrid className="video-grid mt-3.5">
          {related.map((item) => (
            <PublicVideoCard key={item.id} video={item} />
          ))}
        </FourRowVideoGrid>
        {!related.length && <p className="mt-3 text-sm text-ink-3">No videos available yet.</p>}
      </section>
      <RecommendationShelf
        title={recommended.personalized ? "Recommended for you" : "Discover videos"}
        videos={recommended.videos}
        surface="recommended"
        correlationId={recommended.correlationId}
        algorithmVersion={recommended.algorithmVersion}
      />
      <RecommendationShelf
        title="Most Liked"
        videos={mostLiked.videos}
        surface="most_liked"
        correlationId={mostLiked.correlationId}
        algorithmVersion={mostLiked.algorithmVersion}
      />
      <WatchCategories
        categories={categories}
        activeCategory={video.category?.label ?? null}
      />
    </>
  );
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const video = await loadWatchVideo(slug);

  if (!video) {
    notFound();
  }

  // A direct file is fetched by the browser from its own host: open that
  // connection, and start the poster, while the document is still parsing.
  const playbackSource = selectPlaybackSource(
    video.playable_url,
    video.embed_url,
    video.provider,
  );
  // The player tries its candidates in order, so the first one is what the
  // browser contacts. When that is the media host itself (a direct file) the
  // connection can be opened while the document is still parsing; when it is
  // our own proxy there is nothing to warm up. This is why the first frame can
  // arrive as fast as it does — the video element is not waiting on a server
  // hop through Cloudflare before it can buffer anything.
  const firstCandidate =
    playbackSource.kind === "direct" ? playbackCandidates(playbackSource.url)[0] : null;
  const mediaOrigin =
    firstCandidate && !isStreamProxyUrl(firstCandidate)
      ? (() => {
          try {
            return new URL(firstCandidate).origin;
          } catch {
            return null;
          }
        })()
      : null;
  // An embed plays inside someone else's player, so warm that host instead of
  // the poster: the thumbnail is not shown before playback anymore.
  const embedOrigin = (() => {
    if (playbackSource.kind !== "embed") return null;
    try {
      return new URL(playbackSource.url).origin;
    } catch {
      return null;
    }
  })();
  const showsPoster = playbackSource.kind !== "embed";
  const playableUrl = video.playable_url;

  // The poster is loaded straight from the media host while the document
  // parses; warming that connection is what makes the first paint instant.
  const posterOrigin = (() => {
    if (!video.thumbnail_url) return null;
    try {
      return new URL(video.thumbnail_url).origin;
    } catch {
      return null;
    }
  })();

  const videoJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description || video.title,
    thumbnailUrl: video.thumbnail_url ? [video.thumbnail_url] : [],
    uploadDate: video.published_at
      ? new Date(video.published_at).toISOString()
      : undefined,
    duration: video.duration_seconds
      ? `PT${video.duration_seconds}S`
      : undefined,
    // Search engines want the file, not the third-party page it came from.
    contentUrl:
      playbackSource.kind === "direct" ? playbackSource.url : undefined,
    embedUrl: playbackSource.kind === "embed" ? playbackSource.url : undefined,
    publisher: {
      "@type": "Organization",
      name: "erobabe",
      logo: {
        "@type": "ImageObject",
        url: "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png",
      },
    },
    isFamilyFriendly: false,
  };

  return (
    <div className="pt-4">
      <ViewTracker videoId={video.id} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd).replace(/</g, "\\u003c") }}
      />

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-accent"
      >
        ← Back to home
      </Link>

      {/* Instant play starts before React hydrates: connect to the host the
          player will use, and fetch the poster only when one is displayed. */}
      {posterOrigin && <link rel="preconnect" href={posterOrigin} />}
      {posterOrigin && <link rel="dns-prefetch" href={posterOrigin} />}
      {mediaOrigin && <link rel="preconnect" href={mediaOrigin} />}
      {embedOrigin && <link rel="preconnect" href={embedOrigin} />}
      {showsPoster && video.thumbnail_url && (
        <link
          rel="preload"
          as="image"
          href={video.thumbnail_url}
          fetchPriority="high"
        />
      )}

      <VideoPlayer
        provider={video.provider}
        id={video.id}
        title={video.title}
        poster={video.thumbnail_url}
        playableUrl={playableUrl}
        embedUrl={video.embed_url}
      />

      <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
        {video.title}
      </h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular-nums">
            {(video.view_count || 0).toLocaleString("en-US")} views
          </span>
        </span>
        <span aria-hidden>•</span>
        <span>{formatTimeAgo(video.published_at)}</span>
        {video.duration_seconds && (
          <>
            <span aria-hidden>•</span>
            <span>{formatDuration(video.duration_seconds)}</span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VideoActions title={video.title} videoId={video.id} />
        <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {video.category && (
            <Link
              href={`/category/${video.category.slug}`}
              className="rounded-full border border-accent/45 bg-accent/8 px-2.5 py-[3px] text-[10.5px] font-semibold text-accent"
            >
              {video.category.label}
            </Link>
          )}
          {video.quality && (
            <span className="rounded-full border border-white/10 bg-card px-2.5 py-[3px] text-[10.5px] font-semibold text-ink-2">
              {video.quality}
            </span>
          )}
        </span>
      </div>

      {video.description && (
        <p className="mt-4 max-w-[640px] text-[13px] leading-relaxed text-ink-2">
          {video.description}
        </p>
      )}

      <VideoComments key={video.id} videoId={video.id} />
      {/* Each shelf has its own boundary: a slow feed streams in late instead
          of holding up the player or the other shelves. */}
      <Suspense fallback={<WatchShelfFallback title="More like this" />}>
        <RelatedVideos video={video} />
      </Suspense>
      <Suspense fallback={<WatchShelfFallback title="Recommended for you" />}>
        <RecommendedForYou video={video} />
      </Suspense>
      <Suspense fallback={<WatchShelfFallback title="Most Liked" />}>
        <MostLiked video={video} />
      </Suspense>
      <Suspense fallback={<WatchShelfFallback title="Top Categories" />}>
        <TopCategories video={video} />
      </Suspense>
      <LatestVideoFeed key={video.id} videoId={video.id} />
    </div>
  );
}
