import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import VideoManager, {
  type AdminCategory,
  type AdminVideo,
} from "./VideoManager";

export default async function AdminVideosPage() {
  const supabase = createServiceClient();
  const [{ data: videos }, { data: categories }] = await Promise.all([
    supabase
      .from("videos")
      .select(
        "id, slug, title, status, visibility, provider, requires_reupload, thumbnail_url, playable_url, embed_url, view_count, created_at, carousel_position, category_id, provider_progress, provider_error, category:categories(label)",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("categories").select("id, label").order("label"),
  ]);

  const rows: AdminVideo[] = (videos || []).map((video: any) => {
    const category = Array.isArray(video.category)
      ? video.category[0]
      : video.category;
    return {
      id: String(video.id),
      slug: String(video.slug),
      title: String(video.title),
      status: String(video.status || "draft"),
      visibility: video.visibility || null,
      provider: video.provider || null,
      requires_reupload: Boolean(video.requires_reupload),
      thumbnail_url: video.thumbnail_url || null,
      playable_url: video.playable_url || null,
      embed_url: video.embed_url || null,
      view_count: Number(video.view_count) || 0,
      created_at: String(video.created_at || new Date().toISOString()),
      category_id: video.category_id ? String(video.category_id) : null,
      category_label: category?.label ? String(category.label) : null,
      carousel_position: video.carousel_position
        ? Number(video.carousel_position)
        : null,
      provider_progress:
        video.provider_progress == null
          ? null
          : Number(video.provider_progress),
      provider_error: video.provider_error
        ? String(video.provider_error)
        : null,
    };
  });

  const categoryOptions: AdminCategory[] = (categories || []).map(
    (category: any) => ({
      id: String(category.id),
      label: String(category.label),
    }),
  );

  const withThumbnails = rows.filter((video) => video.thumbnail_url).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold">Videos</h1>
          <p className="mt-1 text-[12px] text-ink-3">
            Remote video bytes are retained after catalog deletion; each
            deletion is recorded in media_retention for operator review. Manage
            the video library: encoding uploads appear here immediately and
            publish automatically once Bunny encoding completes. Filter by
            category, manage thumbnails, set the homepage carousel, or delete
            videos.{" "}
            {rows.length > 0 && (
              <span className="tabular-nums">
                {rows.length} videos · {withThumbnails} with a thumbnail
              </span>
            )}
          </p>
        </div>
        <Link
          href="/admin/videos/upload"
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white"
        >
          Upload
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px] font-medium">No videos published yet</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Upload your first video to get started.
          </p>
          <Link
            href="/admin/videos/upload"
            className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white"
          >
            Upload video
          </Link>
        </div>
      ) : (
        <VideoManager initialVideos={rows} categories={categoryOptions} />
      )}
    </div>
  );
}
