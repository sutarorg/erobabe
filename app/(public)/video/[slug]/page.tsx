import { createClient } from "@/lib/supabase/server";
import { SITE_URL, formatDuration, formatTimeAgo } from "@/lib/site";
import VideoActions from "@/src/components/VideoActions";
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
    .select("id, slug, title, thumbnail_url, duration_seconds, quality")
    .eq("status", "published")
    .eq("visibility", "public")
    .neq("id", video.id)
    .limit(20);

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

      {/* Real player */}
      <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
        {video.embed_url ? (
          <iframe
            src={video.embed_url}
            title={video.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        ) : video.playable_url ? (
          <video
            controls
            poster={video.thumbnail_url || undefined}
            className="h-full w-full"
            preload="metadata"
          >
            <source src={video.playable_url} />
            Your browser does not support the video tag.
          </video>
        ) : (
          <>
            <img src={video.thumbnail_url || ""} alt={video.title} className="h-full w-full object-cover opacity-55" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-white">
                Video processing — check back soon
              </div>
            </div>
          </>
        )}
      </div>

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
          <div className="mt-3.5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {related.map((v: any) => (
              <Link key={v.id} href={`/video/${v.slug}`} className="group">
                <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
                  <img src={v.thumbnail_url} alt={v.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                  {v.duration_seconds && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                      {formatDuration(v.duration_seconds)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-tight group-hover:text-accent">{v.title}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
