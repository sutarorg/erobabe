import { dbApi, dbConfigMissing, enc, hasSlugColumn } from "./db.mjs";
import { json, clientIp, sha256hex, ENV } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Public read-only API consumed by the EroBabe frontend.
 * Only exposes rows with status = 'published'.
 * ────────────────────────────────────────────────────────────── */

const VIDEO_COLS_BASE =
  "id,title,description,status,duration_s,views,like_ratio,tags,thumbnail_url,video_url,hls_url,featured,trending,editors_pick,seo_title,seo_description,published_at,created_at,source_size,category_id";

/** Adds `slug` only when migration 0002 has been applied. */
async function videoCols() {
  return (await hasSlugColumn()) ? `${VIDEO_COLS_BASE},slug` : VIDEO_COLS_BASE;
}

let catCache = { at: 0, list: [] };

export async function categoryIndex() {
  if (Date.now() - catCache.at < 60_000 && catCache.list.length) return catCache.list;
  const { data } = await dbApi.select("categories", "order=sort.asc");
  catCache = { at: Date.now(), list: data };
  return data;
}

export function invalidateCategoryCache() {
  catCache = { at: 0, list: [] };
}

export function shapeVideo(row, cats) {
  const cat = cats.find((c) => c.id === row.category_id);
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    title: row.title,
    description: row.description ?? "",
    category: cat?.slug ?? null,
    categoryName: cat?.name ?? null,
    durationS: row.duration_s ?? 0,
    views: row.views ?? 0,
    likeRatio: row.like_ratio ?? 90,
    tags: row.tags ?? [],
    thumbnailUrl: row.thumbnail_url ?? null,
    videoUrl: row.video_url ?? null,
    hlsUrl: row.hls_url ?? null,
    featured: !!row.featured,
    trending: !!row.trending,
    editorsPick: !!row.editors_pick,
    publishedAt: row.published_at ?? row.created_at,
    createdAt: row.created_at,
    sourceSize: row.source_size ?? 0,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i;

/** Resolve a published video by its SEO slug or, as a fallback, its uuid. */
async function findPublished(ref, cols) {
  if (!ref) return null;
  const select = cols ?? (await videoCols());
  if ((await hasSlugColumn()) && SLUG_RE.test(ref)) {
    const bySlug = await dbApi
      .one("videos", `slug=eq.${encodeURIComponent(ref)}&status=eq.published&select=${select}`)
      .catch(() => null);
    if (bySlug) return bySlug;
  }
  if (UUID_RE.test(ref)) {
    return dbApi.one("videos", `id=eq.${ref}&status=eq.published&select=${select}`).catch(() => null);
  }
  return null;
}

async function siteSettings() {
  const { data } = await dbApi.select("settings", "key=eq.site&limit=1");
  return data?.[0]?.value ?? {};
}

export async function handlePublic(req, url, path) {
  const seg = path.replace(/^\/api\/public\/?/, "").split("/").filter(Boolean);
  const first = seg[0] ?? "";

  /* Health / capability probe — the frontend uses this to decide between
     the dynamic catalog and the built-in demo dataset. Never throws. */
  if (first === "health" && req.method === "GET") {
    const missing = dbConfigMissing() ? ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !ENV(k)) : [];
    const ok = missing.length === 0;
    return json({
      ok,
      backend: "supabase",
      missing,
      // Surfaces whether migration 0002 (SEO slugs) has been applied.
      slugs: ok ? await hasSlugColumn().catch(() => false) : false,
    });
  }

  if (dbConfigMissing()) return json({ error: "Backend not configured", code: "config" }, { status: 503 });

  /* ── GET /api/public/settings ── */
  if (first === "settings" && req.method === "GET") {
    const s = await siteSettings();
    return json({
      siteTitle: s.site_title ?? null,
      announcement: s.announcement ?? null,
      heroEnabled: s.hero_enabled !== false,
      featuredVideoId: s.featured_video_id ?? null,
      ageText: s.age_text ?? null,
    });
  }

  /* ── GET /api/public/categories ── */
  if (first === "categories" && req.method === "GET") {
    const cats = await categoryIndex();
    const { data: vids } = await dbApi.select("videos", "status=eq.published&select=category_id&limit=5000");
    const counts = new Map();
    for (const v of vids) counts.set(v.category_id, (counts.get(v.category_id) ?? 0) + 1);
    return json({
      categories: cats.map((c) => ({
        id: c.id, slug: c.slug, name: c.name, blurb: c.blurb ?? "",
        gradient: c.gradient ?? "from-zinc-500/70 via-zinc-800/40",
        imageUrl: c.image_url ?? null, sort: c.sort ?? 0,
        count: counts.get(c.id) ?? 0,
      })),
    });
  }

  /* ── GET /api/public/videos ── */
  if (first === "videos" && seg.length === 1 && req.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 500);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
    const parts = ["status=eq.published", `select=${await videoCols()}`];

    const category = url.searchParams.get("category");
    const cats = await categoryIndex();
    if (category) {
      const cat = cats.find((c) => c.slug === category);
      parts.push(cat ? `category_id=eq.${cat.id}` : "category_id=eq.00000000-0000-0000-0000-000000000000");
    }
    const q = url.searchParams.get("q")?.trim();
    if (q) parts.push(`or=(title.ilike.*${enc(q)}*,description.ilike.*${enc(q)}*)`);
    const tag = url.searchParams.get("tag")?.trim();
    if (tag) parts.push(`tags=cs.{${enc(tag)}}`);
    const ids = url.searchParams.get("ids")?.split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    if (ids?.length) parts.push(`id=in.(${ids.join(",")})`);

    const sort = url.searchParams.get("sort") ?? "new";
    parts.push(sort === "popular" ? "order=views.desc" : "order=published_at.desc");
    parts.push(`limit=${limit}`, `offset=${offset}`);

    const { data } = await dbApi.select("videos", parts.join("&"));
    const s = await siteSettings().catch(() => ({}));
    return json({ videos: data.map((r) => shapeVideo(r, cats)), featuredId: s.featured_video_id ?? null });
  }

  /* ── GET /api/public/videos/:idOrSlug ── */
  if (first === "videos" && seg.length === 2 && req.method === "GET") {
    const ref = decodeURIComponent(seg[1]);
    const row = await findPublished(ref);
    if (!row) return json({ error: "Not found", code: "not_found" }, { status: 404 });
    const cats = await categoryIndex();
    return json({ video: shapeVideo(row, cats) });
  }

  /* ── POST /api/public/videos/:idOrSlug/view — real tracking with daily dedupe ── */
  if (first === "videos" && seg.length === 3 && seg[2] === "view" && req.method === "POST") {
    const ref = decodeURIComponent(seg[1]);
    const row = await findPublished(ref, "id");
    if (!row) return json({ ok: false }, { status: 404 });
    const hash = sha256hex(
      `${clientIp(req.headers)}|${req.headers.get("user-agent") ?? ""}|${row.id}`
    ).slice(0, 32);
    try {
      await dbApi.rpc("track_view", { v: row.id, h: hash });
    } catch {
      /* View tracking must never break playback */
    }
    return json({ ok: true });
  }

  return json({ error: "Not found", code: "not_found" }, { status: 404 });
}
