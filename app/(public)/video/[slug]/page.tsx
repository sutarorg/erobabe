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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: video } = await supabase
    .from("videos")
    .select("title, description, thumbnail_url, published_at, duration_seconds")
    .eq("slug", slug)
    .eq("status", "published")
    .eq("visibility", "public")
    .single();

  if (!video) {
    return { title: "Video not found" };
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

export default async function VideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: video } = await supabase
    .from("videos")
    .select(`
      id,
      slug,
      title,
      description,
      thumbnail_url,
      playable_url,
      embed_url,
      duration_seconds,
      quality,
      view_count,
      published_at,
      category:categories(label, slug)
    `)
    .eq("slug", slug)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .single();

  if (!video) {
    notFound();
  }

  // Increment view count via event (server-side)
  // We use service role? For now anon can insert video_events
  await supabase.from("video_events").insert({
    video_id: video.id,
    event_type: "view",
  });

  // Fetch related videos same category
  const { data: related } = await supabase
    .from("videos")
    .select("id, slug, title, thumbnail_url, duration_seconds, quality, view_count, published_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .neq("id", video.id)
    .limit(16);

  // A direct file is fetched by the browser from its own host: open that
  // connection, and start the poster, while the document is still parsing.
  const playbackSource = selectPlaybackSource(video.playable_url, video.embed_url);
  let mediaOrigin: string | null = null;
  if (playbackSource.kind === "direct") {
    try {
      mediaOrigin = new URL(playbackSource.url).origin;
    } catch {
      mediaOrigin = null;
    }
  }

  const videoJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description || video.title,
    thumbnailUrl: video.thumbnail_url ? [video.thumbnail_url] : [],
    uploadDate: video.published_at ? new Date(video.published_at).toISOString() : new Date().toISOString(),
    duration: video.duration_seconds ? `PT${video.duration_seconds}S` : undefined,
    contentUrl: video.playable_url || undefined,
    embedUrl: video.embed_url || `${SITE_URL}/video/${video.slug}`,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
      />

      <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-accent">
        ← Back to home
      </Link>

      {/* Instant play starts before React hydrates: connect to the media host and
          fetch the poster the visitor is about to look at. */}
      {mediaOrigin && <link rel="preconnect" href={mediaOrigin} />}
      {video.thumbnail_url && <link rel="preload" as="image" href={video.thumbnail_url} fetchPriority="high" />}

      <VideoPlayer
        id={video.id}
        title={video.title}
        poster={video.thumbnail_url}
        playableUrl={video.playable_url}
        embedUrl={video.embed_url}
        durationSeconds={video.duration_seconds}
        quality={video.quality}
      />

      <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">{video.title}</h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular-nums">{(video.view_count || 0).toLocaleString("en-US")} views</span>
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
        <VideoActions title={video.title} />
        <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {video.category && (
            <Link href={`/category/${(video.category as any).slug}`} className="rounded-full border border-accent/45 bg-accent/8 px-2.5 py-[3px] text-[10.5px] font-semibold text-accent">
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
        <p className="mt-4 max-w-[640px] text-[13px] leading-relaxed text-ink-2">{video.description}</p>
      )}

      {/* Related */}
      {related && related.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="text-[15px] font-semibold">More like this</h2>
          <FourRowVideoGrid className="video-grid mt-3.5">
            {related.map((v: any) => (
              <PublicVideoCard
                key={v.id}
                video={{
                  id: String(v.slug || v.id),
                  slug: String(v.slug || v.id),
                  title: String(v.title || "Untitled"),
                  description: null,
                  thumbnail_url: v.thumbnail_url || null,
                  duration_seconds: v.duration_seconds ?? null,
                  view_count: Number(v.view_count) || 0,
                  published_at: v.published_at || null,
                  quality: v.quality || null,
                  category_label: null,
                  category_slug: null,
                }}
              />
            ))}
          </FourRowVideoGrid>
        </section>
      )}
    </div>
  );
}
