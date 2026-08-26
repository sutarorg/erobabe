import { applyDiscovery, installCatalog, mergeRemoteCategories, THUMBS, type Video, type CategorySlug } from "./videos";
import { formatDuration, formatViews, timeAgo } from "@/lib/format";

/**
 * Bridges the static frontend with the live CMS backend.
 * On boot we probe /api/public/health: when a configured backend
 * answers, the entire site swaps from the built-in demo dataset to
 * the published videos stored in Supabase — no redeploys required.
 * When the backend is absent (pure static hosting), the demo
 * catalog stays active so the product remains fully browsable.
 */

export interface RemoteVideo {
  id: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  title: string;
  description: string;
  category: string | null;
  categoryName: string | null;
  durationS: number;
  views: number;
  likeRatio: number;
  tags: string[];
  thumbnailUrl: string | null;
  videoUrl: string | null;
  hlsUrl: string | null;
  featured: boolean;
  trending: boolean;
  editorsPick: boolean;
  publishedAt: string;
  createdAt: string;
  sourceSize: number;
}

let dynamic = false;
export const isDynamic = () => dynamic;

/** Site settings pulled from the backend (hero toggle, announcement…). */
export const publicSettings: {
  siteTitle: string | null;
  announcement: string | null;
  heroEnabled: boolean;
  featuredVideoId: string | null;
  ageText: string | null;
} = {
  siteTitle: null,
  announcement: null,
  heroEnabled: true,
  featuredVideoId: null,
  ageText: null,
};

const FALLBACK_THUMBS = Object.values(THUMBS);

function mapRemote(rv: RemoteVideo, index: number): Video {
  const publishedMs = rv.publishedAt ? Date.parse(rv.publishedAt) : Date.now();
  const daysAgo = Number.isNaN(publishedMs) ? 0 : Math.max(0, Math.floor((Date.now() - publishedMs) / 86_400_000));
  return {
    // Slug drives every public URL so each video has its own clean page.
    id: rv.slug || rv.id,
    uuid: rv.id,
    seoTitle: rv.seoTitle,
    seoDescription: rv.seoDescription,
    title: rv.title,
    category: (rv.category as CategorySlug) ?? "studio",
    duration: rv.durationS ?? 0,
    durationLabel: formatDuration(rv.durationS ?? 0),
    views: rv.views ?? 0,
    viewsLabel: formatViews(rv.views ?? 0),
    daysAgo,
    dateLabel: timeAgo(daysAgo),
    likeRatio: rv.likeRatio ?? 95,
    thumbnail: rv.thumbnailUrl ?? FALLBACK_THUMBS[index % FALLBACK_THUMBS.length],
    videoUrl: rv.hlsUrl ?? rv.videoUrl ?? "",
    tags: rv.tags?.length ? rv.tags : [rv.categoryName ?? "Featured"],
    performer: "Erobabe Studio",
    description: rv.description || "A studio feature from the EroBabe catalog.",
    featured: rv.featured,
    trending: rv.trending,
    hot: (rv.views ?? 0) >= 10_000,
    isNew: daysAgo <= 14,
    editorsPick: rv.editorsPick,
    score: (rv.views ?? 0) / Math.pow(daysAgo + 2, 0.78),
  };
}

export async function bootstrapCatalog(): Promise<void> {
  try {
    const health = await fetch("/api/public/health", { cache: "no-store" });
    const h: { ok?: boolean } | null = await health.json().catch(() => null);
    if (!health.ok || !h?.ok) return;

    const [vRes, cRes, sRes] = await Promise.all([
      fetch("/api/public/videos?limit=300&sort=new"),
      fetch("/api/public/categories"),
      fetch("/api/public/settings"),
    ]);
    if (!vRes.ok) return;

    const vData = (await vRes.json()) as { videos: RemoteVideo[]; featuredId: string | null };
    dynamic = true;

    const mapped = vData.videos.map(mapRemote);
    installCatalog(mapped);

    // Discovery line-ups come from the analytics ranking engine.
    try {
      const dRes = await fetch("/api/public/discovery", { cache: "no-store" });
      if (dRes.ok) {
        const d = (await dRes.json()) as {
          featured: string[]; trending: string[]; rising: string[]; editors: string[];
        };
        applyDiscovery(d);
      }
    } catch {
      /* Local ranking already installed as the fallback. */
    }

    if (cRes.ok) {
      const c = (await cRes.json()) as {
        categories: { slug: string; name: string; blurb: string; gradient: string; imageUrl: string | null; count: number }[];
      };
      mergeRemoteCategories(
        c.categories.map((x) => ({ slug: x.slug, name: x.name, blurb: x.blurb, gradient: x.gradient, image: x.imageUrl }))
      );
    }

    if (sRes.ok) {
      const s = (await sRes.json()) as Partial<typeof publicSettings>;
      publicSettings.siteTitle = s.siteTitle ?? null;
      publicSettings.announcement = s.announcement ?? null;
      publicSettings.heroEnabled = s.heroEnabled !== false;
      publicSettings.featuredVideoId = s.featuredVideoId ?? null;
      publicSettings.ageText = s.ageText ?? null;
      if (s.siteTitle) document.title = document.title.replace("EroBabe", s.siteTitle);
    }
  } catch {
    /* Backend unreachable — the demo catalog stays active. */
  }
}

/** Real view tracking — deduped server-side per viewer/day. Never breaks playback. */
export function trackView(videoId: string) {
  if (!dynamic) return;
  try {
    void fetch(`/api/public/videos/${videoId}/view`, { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* no-op */
  }
}

/** Watch-time + completion signals that feed the ranking engine. */
export function trackProgress(videoId: string, watchSeconds: number, completion: number) {
  if (!dynamic || watchSeconds < 3) return;
  const body = JSON.stringify({ watchSeconds: Math.round(watchSeconds), completion: Math.round(completion) });
  const url = `/api/public/videos/${videoId}/progress`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  } catch {
    /* no-op */
  }
}

/** Like / unlike engagement signal. */
export function trackLike(videoId: string, liked: boolean) {
  if (!dynamic) return;
  try {
    void fetch(`/api/public/videos/${videoId}/like`, {
      method: "POST",
      body: JSON.stringify({ liked }),
      keepalive: true,
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  } catch {
    /* no-op */
  }
}
