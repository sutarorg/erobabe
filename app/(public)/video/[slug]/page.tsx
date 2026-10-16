import VideoComments from "@/src/components/VideoComments";
import LatestVideoFeed from "@/src/components/LatestVideoFeed";
import WatchCategories from "@/src/components/WatchCategories";
import { watchFeed } from "@/lib/public/watch-feed";
import { getPublicCategories } from "@/lib/public/catalog";
import ViewTracker from "@/src/components/ViewTracker";
import { createClient } from "@/lib/supabase/server";
import { selectPlaybackSource } from "@/lib/video/playback";
import { SITE_URL, formatDuration, formatTimeAgo } from "@/lib/site";
import VideoActions from "@/src/components/VideoActions";
import VideoPlayer from "@/src/components/VideoPlayer";
import FourRowVideoGrid from "@/src/components/FourRowVideoGrid";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import { Eye } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: video } = await supabase
    .from("videos")
    .select("title, description, thumbnail_url, published_at, duration_seconds")
    .eq("slug", slug)
    .eq("requires_reupload", false)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .single();

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

export default async function VideoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: video } = await supabase
    .from("videos")
    .select(
      `
      id,
      slug,
      title,
      description,
      thumbnail_url,
      provider,
      provider_file_id,
      bunny_library_id,
      playable_url,
      embed_url,
      duration_seconds,
      quality,
      view_count,
      published_at,
      category_id,
      category:categories(label, slug)
    `,
    )
    .eq("slug", slug)
    .eq("requires_reupload", false)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .single();

  if (!video) {
    notFound();
  }

  // Fetch related videos same category
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
    .eq("category_id", video.category_id)
    .neq("id", video.id)
    .order("published_at", { ascending: false })
    .limit(16);

  const [recommended, rated, categories] = await Promise.all([
    watchFeed("recommended", video.id),
    watchFeed("rated", video.id),
    getPublicCategories(),
  ]);

  // A direct file is fetched by the browser from its own host: open that
  // connection, and start the poster, while the document is still parsing.
  const playbackSource = selectPlaybackSource(
    video.playable_url,
    video.embed_url,
    video.provider,
    video.bunny_library_id,
    video.provider_file_id,
  );
  let mediaOrigin: string | null = null;
  if (playbackSource.kind === "direct") {
    try {
      mediaOrigin = new URL(playbackSource.url).origin;
    } catch {
      mediaOrigin = null;
    }
  }
  // A Bunny video opens straight into the Bunny player, so warm the embed host
  // instead of the poster: the thumbnail is not shown before playback anymore.
  const embedOrigin =
    playbackSource.kind === "embed" && video.provider === "bunny"
      ? "https://iframe.mediadelivery.net"
      : null;
  const showsPoster = playbackSource.kind !== "embed";

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
    contentUrl: playbackSource.kind === "direct" ? playbackSource.url : undefined,
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
        libraryId={video.bunny_library_id}
        videoId={video.provider_file_id}
        id={video.id}
        title={video.title}
        poster={video.thumbnail_url}
        playableUrl={video.playable_url}
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
              href={`/category/${(video.category as any).slug}`}
              className="rounded-full border border-accent/45 bg-accent/8 px-2.5 py-[3px] text-[10.5px] font-semibold text-accent"
            >
              {(video.category as any).label}
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
      {[
        { title: "More like this", videos: (related || []).map((v: any) => ({ ...v, description: null, category_label: null, category_slug: null })) },
        { title: "Recommended", videos: recommended.videos },
        { title: "Top Rated", videos: rated.videos },
      ].map(section => <section key={section.title} className="mt-8 border-t border-line pt-5">
        <h2 className="text-[15px] font-semibold">{section.title}</h2>
        <FourRowVideoGrid className="video-grid mt-3.5">
          {section.videos.map((v: any) => <PublicVideoCard key={v.id} video={v} />)}
        </FourRowVideoGrid>
        {!section.videos.length && <p className="mt-3 text-sm text-ink-3">No videos available yet.</p>}
      </section>)}
      <WatchCategories
        categories={categories}
        activeCategory={(video.category as any)?.label ?? null}
      />
      <LatestVideoFeed key={video.id} videoId={video.id} />
    </div>
  );
}
