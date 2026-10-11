import { tryCreateServiceClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteUrl = getSiteUrl();

  let videos: any[] = [];
  try {
    const supabase = tryCreateServiceClient();
    if (supabase) {
      const { data } = await supabase
        .from("videos")
        .select("slug, title, description, thumbnail_url, published_at, duration_seconds, updated_at")
        .eq("status", "published")
        .eq("visibility", "public")
        .eq("rights_status", "cleared")
        .eq("moderation_status", "approved")
        .order("published_at", { ascending: false })
        .limit(5000);
      videos = data || [];
    }
  } catch (e) {
    console.warn("video-sitemap: supabase error", e);
  }

  const xmlEntries = videos
    .map((v) => {
      const loc = `${siteUrl}/video/${v.slug}`;
      const thumb = v.thumbnail_url ? `<video:thumbnail_loc>${escapeXml(v.thumbnail_url)}</video:thumbnail_loc>` : "";
      const title = `<video:title>${escapeXml(v.title)}</video:title>`;
      const desc = `<video:description>${escapeXml((v.description || v.title).slice(0, 200))}</video:description>`;
      const pubDate = v.published_at ? `<video:publication_date>${new Date(v.published_at).toISOString()}</video:publication_date>` : "";
      const duration = v.duration_seconds ? `<video:duration>${v.duration_seconds}</video:duration>` : "";
      const playerLoc = `<video:player_loc>${escapeXml(`${siteUrl}/video/${v.slug}`)}</video:player_loc>`;

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
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
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
