import { selectPlaybackSource } from "@/lib/video/playback";
import { tryCreateServiceClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteUrl = getSiteUrl();

  let videos: any[] = [];
  try {
    const supabase = tryCreateServiceClient();
    if (supabase) {
      for (let offset = 0; offset < 45000; offset += 1000) {
        const { data, error } = await supabase
          .from("videos")
          .select(
            "slug, title, description, thumbnail_url, published_at, duration_seconds, updated_at, provider, provider_file_id, bunny_library_id, playable_url, embed_url",
          )
          .eq("requires_reupload", false)
          .eq("status", "published")
          .eq("visibility", "public")
          .eq("rights_status", "cleared")
          .eq("moderation_status", "approved")
          .order("published_at", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        videos.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
    }
  } catch (e) {
    console.warn("video-sitemap: supabase error", e);
  }

  const xmlEntries = videos
    .flatMap((v) => {
      const source = selectPlaybackSource(v.playable_url, v.embed_url, v.provider, v.bunny_library_id, v.provider_file_id);
      if (!v.thumbnail_url || !v.title || (source.kind !== "direct" && source.kind !== "embed")) return [];
      const loc = `${siteUrl}/video/${v.slug}`;
      const thumb = v.thumbnail_url
        ? `<video:thumbnail_loc>${escapeXml(v.thumbnail_url)}</video:thumbnail_loc>`
        : "";
      const title = `<video:title>${escapeXml(v.title)}</video:title>`;
      const desc = `<video:description>${escapeXml((v.description || v.title).slice(0, 200))}</video:description>`;
      const pubDate = v.published_at
        ? `<video:publication_date>${new Date(v.published_at).toISOString()}</video:publication_date>`
        : "";
      const duration = v.duration_seconds
        ? `<video:duration>${v.duration_seconds}</video:duration>`
        : "";
      const playerLoc = source.kind === "direct"
        ? `<video:content_loc>${escapeXml(source.url)}</video:content_loc>`
        : `<video:player_loc>${escapeXml(source.url)}</video:player_loc>`;

      return `
  <url>
    <loc>${escapeXml(loc)}</loc>
    <video:video>
      ${thumb}
      ${title}
      ${desc}
      ${playerLoc}
      ${duration}
      ${pubDate}
      <video:family_friendly>no</video:family_friendly>
      <video:requires_subscription>no</video:requires_subscription>
    </video:video>
  </url>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${xmlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=30, must-revalidate",
    },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
