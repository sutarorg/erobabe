import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { MIN_VIDEOS_PER_CATEGORY, categoryCounts, type ImportService } from "@/lib/damplips/importer";
import DamplipsImportPanel from "./DamplipsImportPanel";
import VideoManager, {
  type AdminCategory,
  type AdminVideo,
} from "./VideoManager";

const ADMIN_VIDEO_PAGE = 1000;

const ADMIN_VIDEO_COLUMNS =
  "id, slug, title, status, visibility, provider, requires_reupload, thumbnail_url, playable_url, embed_url, source_url, view_count, created_at, carousel_position, carousel_title, carousel_description, category_id, category:categories(label)";

async function loadAllAdminVideos(supabase: ReturnType<typeof createServiceClient>) {
  const videos: any[] = [];
  let from = 0;
  for (;;) {
    const { data } = await supabase
      .from("videos")
      .select(ADMIN_VIDEO_COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, from + ADMIN_VIDEO_PAGE - 1);
    const batch = data || [];
    videos.push(...batch);
    if (batch.length < ADMIN_VIDEO_PAGE) break;
    from += ADMIN_VIDEO_PAGE;
  }
  return videos;
}

export default async function AdminVideosPage() {
  const supabase = createServiceClient();
  const [videos, { data: categories }] = await Promise.all([
    loadAllAdminVideos(supabase),
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
      source_url: video.source_url || null,
      view_count: Number(video.view_count) || 0,
      created_at: String(video.created_at || new Date().toISOString()),
      category_id: video.category_id ? String(video.category_id) : null,
      category_label: category?.label ? String(category.label) : null,
      carousel_position: video.carousel_position
        ? Number(video.carousel_position)
        : null,
      carousel_title: video.carousel_title
        ? String(video.carousel_title)
        : null,
      carousel_description: video.carousel_description
        ? String(video.carousel_description)
        : null,
    };
  });

  const categoryOptions: AdminCategory[] = (categories || []).map(
    (category: any) => ({
      id: String(category.id),
      label: String(category.label),
    }),
  );

  let counts: Awaited<ReturnType<typeof categoryCounts>> = [];
  try {
    counts = await categoryCounts(supabase as unknown as ImportService);
  } catch {
    counts = [];
  }
  const filled = counts.filter((entry) => entry.count >= MIN_VIDEOS_PER_CATEGORY).length;
  const withThumbnails = rows.filter((video) => video.thumbnail_url).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold">Videos</h1>
          <p className="mt-1 text-[12px] text-ink-3">
            Every video in the library is embedded from damplips.com — nothing is
            uploaded here. Curate the catalog: replace a poster, publish or hide
            a video, place it in the homepage carousel, or remove it.{" "}
            {rows.length > 0 && (
              <span className="tabular-nums">
                {rows.length} videos · {withThumbnails} with a thumbnail
                {counts.length ? ` · ${filled}/${counts.length} categories at ${MIN_VIDEOS_PER_CATEGORY}+` : ""}
              </span>
            )}
          </p>
        </div>
        <Link
          href="/admin/system-health"
          className="inline-flex h-9 items-center rounded-md border border-line px-4 text-[13px] font-semibold"
        >
          Catalog health
        </Link>
      </div>

      <DamplipsImportPanel counts={counts} />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px] font-medium">No videos in the library yet</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Run the damplips import above to fill each category with at least{" "}
            {MIN_VIDEOS_PER_CATEGORY} embedded videos.
          </p>
        </div>
      ) : (
        <VideoManager initialVideos={rows} categories={categoryOptions} />
      )}
    </div>
  );
}
