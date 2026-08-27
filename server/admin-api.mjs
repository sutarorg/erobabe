import { dbApi, objectKey, hasSlugColumn, hasColumn } from "./db.mjs";
import {
  createMultipartUpload, presignPart, presignSinglePut, completeMultipartUpload,
  abortMultipartUpload, putObject, deleteObject, publicUrlFor, r2ConfigMissing,
} from "./r2.mjs";
import { categoryIndex, invalidateCategoryCache, shapeVideo } from "./public-api.mjs";
import { publishDueVideos } from "./scheduler.mjs";
import {
  json, readJson, HttpError, badRequest, unauthorized, notFound,
  parseCookies, serializeCookie, createSessionToken, verifySessionToken,
  verifyPassword, hashPassword, rateLimit, clientIp, timingSafeStr, assertCsrf, ENV, slugify,
} from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Admin API — every route below requires a valid session cookie
 * except login and the processing webhook callback.
 * ────────────────────────────────────────────────────────────── */

const COOKIE = "eb_admin_session";
const SESSION_TTL = 60 * 60 * 12; // 12h
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MULTIPART_THRESHOLD = 64 * 1024 * 1024; // 64 MB
const CHUNK = 16 * 1024 * 1024; // 16 MB parts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let DUMMY_HASH = null;
const dummyHash = () => (DUMMY_HASH ??= hashPassword("dummy-password"));

function requireConfig() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD_SCRYPT"].filter((k) => !ENV(k));
  if (missing.length) throw new HttpError(503, `Admin backend not configured. Missing: ${missing.join(", ")}`, "config");
}

function requireAdmin(req) {
  requireConfig();
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  const payload = verifySessionToken(cookies[COOKIE], ENV("SESSION_SECRET"));
  if (!payload) throw unauthorized("Session expired — please sign in again");
  return payload;
}

const isHttps = (req) => new URL(req.url).protocol === "https:";
const nowIso = () => new Date().toISOString();

async function logActivity(actor, action, entity, entityId, meta = {}) {
  try {
    await dbApi.insert("activity_log", { actor, action, entity, entity_id: String(entityId ?? ""), meta });
  } catch {
    /* activity logging must never break mutations */
  }
}

const cleanTags = (tags) =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().slice(0, 24)).filter(Boolean))].slice(0, 12)
    : [];

const cleanText = (v, max, fallback = "") => String(v ?? fallback).trim().slice(0, max);

async function getVideoOr404(id) {
  if (!UUID_RE.test(id)) throw notFound("Video not found");
  const row = await dbApi.one("videos", `id=eq.${id}`);
  if (!row) throw notFound("Video not found");
  return row;
}

/**
 * Build a unique, URL-safe slug for /watch/{slug}. Each published video
 * therefore gets its own crawlable, canonical page automatically.
 */
async function uniqueSlug(title, excludeId = null) {
  // No-op until migration 0002 adds the column — uploads must never fail.
  if (!(await hasSlugColumn())) return null;
  const base = slugify(title || "") || "video";
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const { data } = await dbApi.select(
        "videos",
        `slug=eq.${encodeURIComponent(candidate)}&select=id&limit=1`
      );
      if (!data.find((r) => r.id !== excludeId)) return candidate;
    } catch {
      return null;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Adds `slug` to a patch/insert only when the column exists. */
const withSlug = (obj, slug) => (slug ? { ...obj, slug } : obj);

async function withCategory(row) {
  const cats = await categoryIndex();
  const cat = cats.find((c) => c.id === row.category_id);
  return { ...row, category_slug: cat?.slug ?? null, category_name: cat?.name ?? null };
}

const today = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

/* ══════════════ route handlers ══════════════ */

async function login(req) {
  requireConfig();
  const ip = clientIp(req.headers);
  const rl = rateLimit(`login:${ip}`, 5, 60_000);
  if (!rl.ok) {
    const e = new HttpError(429, "Too many attempts — try again shortly", "rate_limited");
    e.retryAfterSec = rl.retryAfterSec;
    throw e;
  }

  const body = await readJson(req);
  const username = cleanText(body.username, 100);
  const userOk = timingSafeStr(username, ENV("ADMIN_USERNAME"));
  // Always run scrypt to avoid user-enumeration timing side channel.
  const passOk = verifyPassword(String(body.password ?? ""), userOk ? ENV("ADMIN_PASSWORD_SCRYPT") : dummyHash());
  if (!(userOk && passOk)) {
    await logActivity("anonymous", "auth.login_failed", "session", ip, { username });
    throw unauthorized("Invalid username or password");
  }

  const token = createSessionToken(username, ENV("SESSION_SECRET"), SESSION_TTL);
  await logActivity(username, "auth.login", "session", ip, {});
  return json(
    { ok: true, user: { username } },
    {
      headers: {
        "set-cookie": serializeCookie(COOKIE, token, { maxAgeSec: SESSION_TTL, secure: isHttps(req) }),
      },
    }
  );
}

async function logout(req) {
  const admin = requireAdmin(req);
  await logActivity(admin.sub, "auth.logout", "session", clientIp(req.headers), {});
  return json(
    { ok: true },
    { headers: { "set-cookie": serializeCookie(COOKIE, "", { maxAgeSec: 0, secure: isHttps(req) }) } }
  );
}

async function me(req) {
  const admin = requireAdmin(req);
  return json({ user: { username: admin.sub } });
}

/* ── Overview / analytics ── */

async function overview() {
  const count = async (q) => (await dbApi.select("videos", `${q}&limit=0`, { count: true })).total ?? 0;
  const [total, published, drafts, processing, all, events, activity, top] = await Promise.all([
    count("select=id"),
    count("select=id&status=eq.published"),
    dbApi.select("videos", "select=id&status=in.(draft,ready)&limit=0", { count: true }).then((r) => r.total ?? 0),
    count("select=id&status=in.(uploading,processing)"),
    dbApi.select(
      "videos",
      // Impressions/clicks arrive with migration 0006 and are simply absent before it.
      `select=views,source_size${(await hasColumn("videos", "impressions")) ? ",impressions" : ""}${(await hasColumn("videos", "clicks")) ? ",clicks" : ""}&limit=5000`
    ),
    dbApi.select("analytics_events", `created_day=gte.${today(13)}&select=created_day&limit=200000`),
    dbApi.select("activity_log", "order=created_at.desc&limit=8"),
    dbApi.select("videos", "status=eq.published&order=views.desc&limit=5&select=id,title,views,thumbnail_url"),
  ]);

  const seriesMap = new Map();
  for (let i = 13; i >= 0; i--) seriesMap.set(today(i), 0);
  for (const e of events.data) seriesMap.set(e.created_day, (seriesMap.get(e.created_day) ?? 0) + 1);

  let totalViews = 0;
  let bytes = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  for (const v of all.data) {
    totalViews += v.views ?? 0;
    bytes += v.source_size ?? 0;
    totalImpressions += v.impressions ?? 0;
    totalClicks += v.clicks ?? 0;
  }

  return json({
    totals: {
      videos: total,
      published,
      drafts,
      processing,
      views: totalViews,
      storageBytes: bytes,
      objects: all.data.length,
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    },
    series: [...seriesMap.entries()].map(([day, views]) => ({ day, views })),
    recentActivity: activity.data,
    topVideos: top.data,
  });
}

async function analytics(req, url) {
  const days = [7, 14, 30].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 14;
  const [events, top, all] = await Promise.all([
    dbApi.select("analytics_events", `created_day=gte.${today(days - 1)}&select=created_day,video_id&limit=400000`),
    dbApi.select("videos", "order=views.desc&limit=10&select=id,title,views,thumbnail_url,status,duration_s"),
    dbApi.select("videos", "select=source_size,views,status&limit=5000"),
  ]);
  const seriesMap = new Map();
  for (let i = days - 1; i >= 0; i--) seriesMap.set(today(i), 0);
  let rangeViews = 0;
  for (const e of events.data) {
    seriesMap.set(e.created_day, (seriesMap.get(e.created_day) ?? 0) + 1);
    rangeViews++;
  }
  const perVideo = new Map();
  for (const e of events.data) perVideo.set(e.video_id, (perVideo.get(e.video_id) ?? 0) + 1);
  return json({
    series: [...seriesMap.entries()].map(([day, views]) => ({ day, views })),
    rangeViews,
    topVideos: top.data,
    rangeTop: [...perVideo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, views]) => ({ id, views })),
    traffic: {
      impressions: all.data.reduce((n, v) => n + (v.impressions ?? 0), 0),
      clicks: all.data.reduce((n, v) => n + (v.clicks ?? 0), 0),
      ctr:
        all.data.reduce((n, v) => n + (v.impressions ?? 0), 0) > 0
          ? (all.data.reduce((n, v) => n + (v.clicks ?? 0), 0) /
              all.data.reduce((n, v) => n + (v.impressions ?? 0), 0)) *
            100
          : 0,
    },
    storage: {
      bytes: all.data.reduce((n, v) => n + (v.source_size ?? 0), 0),
      objects: all.data.length,
      lifetimeViews: all.data.reduce((n, v) => n + (v.views ?? 0), 0),
    },
  });
}

/* ── Traffic analytics (referral sources, search / social / direct) ── */

async function traffic(req, url) {
  const days = [7, 14, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const since = today(days - 1);

  let rows = [];
  try {
    const res = await dbApi.select(
      "analytics_events",
      `created_day=gte.${since}&select=created_day,source,referrer_host,device&limit=400000`
    );
    rows = res.data;
  } catch {
    // Migration 0005 not applied yet — report an empty, well-formed payload.
    return json({ available: false, days, total: 0, sources: [], referrers: [], devices: [], series: [] });
  }

  const sourceCounts = new Map();
  const refCounts = new Map();
  const deviceCounts = new Map();
  const seriesMap = new Map();
  for (let i = days - 1; i >= 0; i--) seriesMap.set(today(i), { day: today(i), direct: 0, search: 0, social: 0, referral: 0, internal: 0 });

  for (const r of rows) {
    const src = r.source || "direct";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
    if (r.referrer_host) refCounts.set(r.referrer_host, (refCounts.get(r.referrer_host) ?? 0) + 1);
    deviceCounts.set(r.device || "unknown", (deviceCounts.get(r.device || "unknown") ?? 0) + 1);
    const bucket = seriesMap.get(r.created_day);
    if (bucket && bucket[src] !== undefined) bucket[src] += 1;
  }

  const total = rows.length;
  const toList = (map) =>
    [...map.entries()]
      .map(([name, count]) => ({ name, count, share: total ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);

  return json({
    available: true,
    days,
    total,
    sources: toList(sourceCounts),
    referrers: toList(refCounts).slice(0, 12),
    devices: toList(deviceCounts),
    series: [...seriesMap.values()],
  });
}

/* ── Per-video analytics: performance, retention, audience, discovery ── */

async function videoAnalytics(req, url, id) {
  const row = await getVideoOr404(id);
  const days = [7, 14, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const since = today(days - 1);

  const cols = ["created_day", "viewer_hash"];
  const extra = ["watch_seconds", "completion", "source", "referrer_host", "device"];
  for (const c of extra) if (await hasColumn("analytics_events", c)) cols.push(c);
  // Impressions and clicks live on the video row itself.
  const hasImpressions = await hasColumn("videos", "impressions");
  const hasClicks = await hasColumn("videos", "clicks");

  const { data: events } = await dbApi
    .select("analytics_events", `video_id=eq.${row.id}&created_day=gte.${since}&select=${cols.join(",")}&limit=200000`)
    .catch(() => ({ data: [] }));

  const seriesMap = new Map();
  for (let i = days - 1; i >= 0; i--) seriesMap.set(today(i), 0);
  const viewers = new Set();
  const sourceCounts = new Map();
  const refCounts = new Map();
  const deviceCounts = new Map();
  let watchTotal = 0;
  let watchCount = 0;
  let completionSum = 0;
  let completionCount = 0;
  const completions = [];

  for (const e of events) {
    seriesMap.set(e.created_day, (seriesMap.get(e.created_day) ?? 0) + 1);
    viewers.add(e.viewer_hash);
    sourceCounts.set(e.source || "direct", (sourceCounts.get(e.source || "direct") ?? 0) + 1);
    if (e.referrer_host) refCounts.set(e.referrer_host, (refCounts.get(e.referrer_host) ?? 0) + 1);
    deviceCounts.set(e.device || "unknown", (deviceCounts.get(e.device || "unknown") ?? 0) + 1);
    if (e.watch_seconds > 0) {
      watchTotal += e.watch_seconds;
      watchCount += 1;
    }
    if (e.completion > 0) {
      completionSum += e.completion;
      completionCount += 1;
      completions.push(e.completion);
    }
  }

  // Retention curve: share of tracked sessions still watching at each decile.
  const retention = Array.from({ length: 11 }, (_, i) => {
    const pct = i * 10;
    const reached = completions.filter((c) => c >= pct).length;
    return { pct, share: completions.length ? reached / completions.length : 0 };
  });

  const rangeViews = events.length;
  const avgWatch = watchCount ? watchTotal / watchCount : 0;
  const avgCompletion = completionCount ? completionSum / completionCount : 0;
  const duration = row.duration_s ?? 0;
  const toList = (map, total) =>
    [...map.entries()]
      .map(([name, count]) => ({ name, count, share: total ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);

  return json({
    video: {
      id: row.id,
      slug: row.slug ?? null,
      title: row.title,
      status: row.status,
      thumbnail_url: row.thumbnail_url,
      duration_s: duration,
      views: row.views ?? 0,
      likes: row.likes ?? 0,
      like_ratio: row.like_ratio ?? 0,
      published_at: row.published_at,
      created_at: row.created_at,
      tags: row.tags ?? [],
    },
    days,
    performance: {
      rangeViews,
      lifetimeViews: row.views ?? 0,
      uniqueViewers: viewers.size,
      repeatRate: rangeViews ? Math.max(0, 1 - viewers.size / rangeViews) : 0,
      avgWatchSeconds: avgWatch,
      totalWatchSeconds: watchTotal,
      avgCompletion,
      trackedSessions: watchCount,
      impressions: hasImpressions ? (row.impressions ?? 0) : null,
      clicks: hasClicks ? (row.clicks ?? 0) : null,
      ctr:
        hasImpressions && (row.impressions ?? 0) > 0
          ? ((row.clicks ?? 0) / (row.impressions ?? 1)) * 100
          : 0,
    },
    engagement: {
      likes: row.likes ?? 0,
      // Same derivation the public site uses, so the numbers always agree.
      likeRatio:
        row.likes == null
          ? (row.like_ratio ?? 0)
          : (row.views ?? 0) > 0
            ? Math.min(100, (Number(row.likes) / Number(row.views)) * 100)
            : 0,
      engagementRate: (row.views ?? 0) > 0 ? (row.likes ?? 0) / (row.views ?? 1) : 0,
      viewsPerDay: rangeViews / days,
    },
    retention,
    series: [...seriesMap.entries()].map(([day, views]) => ({ day, views })),
    discovery: {
      sources: toList(sourceCounts, rangeViews),
      referrers: toList(refCounts, rangeViews).slice(0, 8),
    },
    audience: { devices: toList(deviceCounts, rangeViews) },
  });
}

/* ── Duplicate detection ── */

async function checkDuplicate(req) {
  const body = await readJson(req);
  const hash = cleanText(body.hash, 80);
  const title = cleanText(body.title, 160);
  if (!hash && !title) throw badRequest("A content hash or title is required");

  const cols = `id,title,status,thumbnail_url,created_at${(await hasSlugColumn()) ? ",slug" : ""}`;
  const hashSupported = await hasColumn("videos", "content_hash");

  // 1. Exact file match — the strongest signal.
  if (hash && hashSupported) {
    const byHash = await dbApi
      .one("videos", `content_hash=eq.${encodeURIComponent(hash)}&select=${cols}&order=created_at.asc`)
      .catch(() => null);
    if (byHash) return json({ available: true, duplicate: byHash, reason: "file" });
  }

  // 2. Same title — catches re-encodes and re-exports of the same video,
  //    which produce different bytes and so never match by hash.
  if (title) {
    const needle = title.replace(/[%,()]/g, " ").trim();
    if (needle) {
      const byTitle = await dbApi
        .one("videos", `title=ilike.${encodeURIComponent(needle)}&select=${cols}&order=created_at.asc`)
        .catch(() => null);
      if (byTitle) return json({ available: true, duplicate: byTitle, reason: "title" });
    }
  }

  return json({ available: hashSupported, duplicate: null, reason: null });
}

/* ── Scheduled publishing ── */

async function scheduleVideo(req, id) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);
  if (!(await hasColumn("videos", "scheduled_publish_at"))) {
    throw new HttpError(503, "Scheduling requires migration 0007", "config");
  }
  const body = await readJson(req);
  const at = body.at ? new Date(body.at) : null;
  if (at && Number.isNaN(at.getTime())) throw badRequest("Invalid schedule time");

  const patch = {
    scheduled_publish_at: at ? at.toISOString() : null,
    updated_at: nowIso(),
  };
  // A scheduled video waits as a draft until its slot arrives.
  if (at && row.status === "published") patch.status = "draft";
  if (at && ["uploading", "processing"].includes(row.status)) {
    throw badRequest("Video is still uploading or processing");
  }
  const updated = await dbApi.update("videos", `id=eq.${row.id}`, patch);
  await logActivity(admin.sub, at ? "video.schedule" : "video.unschedule", "video", row.id, {
    title: row.title,
    at: at?.toISOString() ?? null,
  });
  return json({ video: await withCategory(updated?.[0] ?? row) });
}

async function listScheduled() {
  if (!(await hasColumn("videos", "scheduled_publish_at"))) {
    return json({ available: false, scheduled: [] });
  }
  const cols = `id,title,status,thumbnail_url,scheduled_publish_at,bulk_batch`;
  const { data } = await dbApi.select(
    "videos",
    `scheduled_publish_at=not.is.null&select=${cols}&order=scheduled_publish_at.asc&limit=200`
  );
  return json({ available: true, scheduled: data });
}

/* ── Videos ── */

async function listVideos(req, url) {
  const page = Math.max(Number(url.searchParams.get("page") ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 24) || 24, 1), 100);
  const parts = ["select=*"];

  const status = url.searchParams.get("status");
  if (status === "drafts") parts.push("status=in.(draft,ready)");
  else if (status && ["uploading", "draft", "processing", "ready", "published", "unpublished"].includes(status))
    parts.push(`status=eq.${status}`);

  const q = url.searchParams.get("q")?.trim();
  if (q) parts.push(`or=(title.ilike.*${encodeURIComponent(q)}*,description.ilike.*${encodeURIComponent(q)}*)`);
  const tag = url.searchParams.get("tag")?.trim();
  if (tag) parts.push(`tags=cs.{${encodeURIComponent(tag)}}`);
  const category = url.searchParams.get("category");
  if (category) {
    const cats = await categoryIndex();
    const cat = cats.find((c) => c.slug === category);
    parts.push(cat ? `category_id=eq.${cat.id}` : "category_id=is.null");
  }

  const sortMap = {
    newest: "created_at.desc", oldest: "created_at.asc", views: "views.desc",
    title: "title.asc", published: "published_at.desc.nullslast",
  };
  parts.push(`order=${sortMap[url.searchParams.get("sort")] ?? sortMap.newest}`);

  const { data, total } = await dbApi.select("videos", parts.join("&"), {
    count: true,
    range: [(page - 1) * limit, page * limit - 1],
  });
  const cats = await categoryIndex();
  const byId = new Map(cats.map((c) => [c.id, c]));
  return json({
    items: data.map((r) => {
      const cat = byId.get(r.category_id);
      return { ...r, category_slug: cat?.slug ?? null, category_name: cat?.name ?? null };
    }),
    total: total ?? 0,
    page,
    pages: Math.max(Math.ceil((total ?? 0) / limit), 1),
    limit,
  });
}

async function getVideo(req, id) {
  const row = await getVideoOr404(id);
  return json({ video: await withCategory(row) });
}

async function patchVideo(req, id) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);
  const body = await readJson(req);
  const patch = { updated_at: nowIso() };

  if ("title" in body) {
    const t = cleanText(body.title, 120);
    if (!t) throw badRequest("Title is required");
    patch.title = t;
    // Keep published URLs stable for SEO; refresh the slug while still a draft.
    if (t !== row.title && (row.status !== "published" || !row.slug)) {
      const s = await uniqueSlug(t, row.id);
      if (s) patch.slug = s;
    }
  }
  if ("slug" in body) {
    const requested = slugify(cleanText(body.slug, 80));
    if (requested && requested !== row.slug) {
      const s = await uniqueSlug(requested, row.id);
      if (s) patch.slug = s;
    }
  }
  if ("description" in body) patch.description = cleanText(body.description, 2000);
  if ("tags" in body) patch.tags = cleanTags(body.tags);
  if ("durationS" in body) patch.duration_s = Math.min(Math.max(Number(body.durationS) || 0, 0), 86400);
  if ("likeRatio" in body) patch.like_ratio = Math.min(Math.max(Number(body.likeRatio) || 0, 0), 100);
  // Editor's Pick is the only manual discovery control. Featured / Trending /
  // Rising Now are decided by the ranking engine from live analytics, so any
  // inbound values for them are deliberately ignored.
  const pickKey = ["editorsPick", "editors_pick"].find((a) => a in body);
  if (pickKey !== undefined) patch.editors_pick = !!body[pickKey];
  if ("seoTitle" in body) patch.seo_title = cleanText(body.seoTitle, 150) || null;
  if ("seoDescription" in body) patch.seo_description = cleanText(body.seoDescription, 300) || null;
  if ("categoryId" in body) {
    if (body.categoryId === null) patch.category_id = null;
    else {
      if (!UUID_RE.test(String(body.categoryId))) throw badRequest("Invalid category");
      const cat = await dbApi.one("categories", `id=eq.${body.categoryId}`);
      if (!cat) throw badRequest("Category does not exist");
      patch.category_id = cat.id;
    }
  }

  const updated = await dbApi.update("videos", `id=eq.${row.id}`, patch);
  await logActivity(admin.sub, "video.update", "video", row.id, { title: patch.title ?? row.title });
  return json({ video: await withCategory(updated?.[0] ?? { ...row, ...patch }) });
}

async function setStatus(req, id, action) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);

  if (action === "publish") {
    if (!row.video_url && !row.hls_url) throw badRequest("This video has no media attached — upload a file first");
    if (["uploading", "processing"].includes(row.status)) throw badRequest("Video is still uploading or processing");
    // Guarantee a canonical slug exists before the page goes live.
    const ensuredSlug = row.slug ? null : await uniqueSlug(row.title, row.id);
    const updated = await dbApi.update(
      "videos",
      `id=eq.${row.id}`,
      withSlug(
        {
          status: "published",
          published_at: row.published_at ?? nowIso(),
          updated_at: nowIso(),
        },
        ensuredSlug
      )
    );
    await logActivity(admin.sub, "video.publish", "video", row.id, { title: row.title });
    return json({ video: await withCategory(updated?.[0] ?? row) });
  }

  // unpublish
  const updated = await dbApi.update("videos", `id=eq.${row.id}`, { status: "unpublished", updated_at: nowIso() });
  await logActivity(admin.sub, "video.unpublish", "video", row.id, { title: row.title });
  return json({ video: await withCategory(updated?.[0] ?? row) });
}

async function deleteVideo(req, id) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);

  // Best-effort storage cleanup (record persists correctly even if R2 is unreachable).
  if (!r2ConfigMissing()) {
    try {
      if (row.upload_id && row.upload_key) await abortMultipartUpload(row.upload_key, row.upload_id);
      if (row.video_key) await deleteObject(row.video_key);
      if (row.thumbnail_key) await deleteObject(row.thumbnail_key);
    } catch { /* best effort */ }
  }

  await dbApi.remove("videos", `id=eq.${row.id}`);
  await logActivity(admin.sub, "video.delete", "video", row.id, { title: row.title });
  return json({ ok: true });
}

async function bulk(req, body) {
  const admin = requireAdmin(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => UUID_RE.test(String(x))).slice(0, 100) : [];
  if (!ids.length) throw badRequest("No valid ids supplied");
  const action = String(body.action ?? "");

  let done = 0;
  for (const id of ids) {
    try {
      if (action === "publish") {
        const row = await getVideoOr404(id);
        if (row.video_url || row.hls_url) {
          await dbApi.update("videos", `id=eq.${id}`, { status: "published", published_at: nowIso(), updated_at: nowIso() });
          done++;
        }
      } else if (action === "unpublish") {
        await dbApi.update("videos", `id=eq.${id}`, { status: "unpublished", updated_at: nowIso() });
        done++;
      } else if (action === "delete") {
        await deleteVideo(req, id);
        done++;
      } else {
        throw badRequest("Unknown bulk action");
      }
    } catch { /* continue with remaining ids */ }
  }
  await logActivity(admin.sub, `video.bulk.${action}`, "video", ids.join(",").slice(0, 200), { count: done });
  return json({ ok: true, done, total: ids.length });
}

/* ── Uploads (direct-to-R2, resumable multipart) ── */

function planChunk(size) {
  return Math.max(CHUNK, Math.ceil(size / 9500 / (1024 * 1024)) * 1024 * 1024);
}

async function createUpload(req) {
  const admin = requireAdmin(req);
  if (r2ConfigMissing()) throw new HttpError(503, "Storage not configured — set R2_* environment variables", "config");

  const body = await readJson(req);
  const size = Number(body.size) || 0;
  const contentType = cleanText(body.contentType, 100) || "video/mp4";
  const fileName = cleanText(body.fileName, 160) || "video.mp4";
  if (size <= 0) throw badRequest("File size is missing");
  if (size > MAX_UPLOAD_BYTES) throw badRequest("File exceeds the 2 GB limit");
  if (!contentType.startsWith("video/")) throw badRequest("Only video files are allowed");

  const key = objectKey("videos", fileName.replace(/\.[a-z0-9]+$/i, "")) + (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4");
  const replaceId = UUID_RE.test(String(body.replaceId ?? "")) ? String(body.replaceId) : null;

  let uploadId = null;
  let chunkSize = null;
  if (size > MULTIPART_THRESHOLD) {
    uploadId = await createMultipartUpload(key, contentType);
    chunkSize = planChunk(size);
  }

  let row;
  if (replaceId) {
    const existing = await getVideoOr404(replaceId);
    const updated = await dbApi.update("videos", `id=eq.${existing.id}`, {
      upload_key: key, upload_id: uploadId, content_type: contentType, source_size: size, updated_at: nowIso(),
    });
    row = updated?.[0] ?? existing;
  } else {
    const initialTitle =
      cleanText(body.title, 120) ||
      fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 120);
    const insert = {
      title: initialTitle,
      status: "uploading",
      upload_key: key,
      upload_id: uploadId,
      source_size: size,
      content_type: contentType,
      duration_s: Number(body.durationS) > 0 ? Math.round(Number(body.durationS)) : null,
      tags: [],
    };
    // Fingerprint + batch id land with migration 0007.
    const hash = cleanText(body.contentHash, 80);
    if (hash && (await hasColumn("videos", "content_hash"))) insert.content_hash = hash;
    const batch = cleanText(body.bulkBatch, 40);
    if (batch && (await hasColumn("videos", "bulk_batch"))) insert.bulk_batch = batch;

    // Every upload gets its own /video/{slug} page once migration 0002 is applied.
    row = await dbApi.insert("videos", withSlug(insert, await uniqueSlug(initialTitle)));
  }

  await logActivity(admin.sub, "upload.start", "video", row.id, { fileName, size, mode: uploadId ? "multipart" : "single" });

  if (!uploadId) {
    return json({ mode: "single", videoId: row.id, key, url: presignSinglePut(key), replace: !!replaceId });
  }

  const partCount = Math.ceil(size / chunkSize);
  const parts = [];
  for (let n = 1; n <= partCount; n++) parts.push({ partNumber: n, url: presignPart(key, uploadId, n), size: Math.min(chunkSize, size - (n - 1) * chunkSize) });
  return json({ mode: "multipart", videoId: row.id, key, uploadId, chunkSize, parts, replace: !!replaceId });
}

async function presignParts(req, id) {
  requireAdmin(req);
  const row = await getVideoOr404(id);
  if (!row.upload_id || !row.upload_key) throw badRequest("This upload is not resumable");
  const body = await readJson(req);
  const nums = Array.isArray(body.partNumbers) ? body.partNumbers.map(Number).filter((n) => n > 0 && n < 10000).slice(0, 500) : [];
  if (!nums.length) throw badRequest("No part numbers supplied");
  return json({ parts: nums.map((n) => ({ partNumber: n, url: presignPart(row.upload_key, row.upload_id, n) })) });
}

async function completeUpload(req, id) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);
  if (!row.upload_key) throw badRequest("No upload in progress for this video");
  const body = await readJson(req);

  if (row.upload_id) {
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length) throw badRequest("Missing multipart part list");
    const clean = parts
      .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag ?? "") }))
      .filter((p) => p.partNumber > 0 && p.etag)
      .sort((a, b) => a.partNumber - b.partNumber);
    await completeMultipartUpload(row.upload_key, row.upload_id, clean);
  }

  const videoUrl = publicUrlFor(row.upload_key);
  const previousKey = row.video_key && row.video_key !== row.upload_key ? row.video_key : null;
  const mode = ENV("PROCESSING_MODE", "original");
  const nextStatus = mode === "original" ? "ready" : "processing";

  const patch = {
    video_key: row.upload_key,
    upload_key: null,
    upload_id: null,
    video_url: videoUrl,
    status: nextStatus,
    updated_at: nowIso(),
  };
  if (Number(body.durationS) > 0) patch.duration_s = Math.round(Number(body.durationS));

  const updated = await dbApi.update("videos", `id=eq.${row.id}`, patch);

  // Replace flow — remove the previous object best-effort.
  if (previousKey && !r2ConfigMissing()) {
    deleteObject(previousKey).catch(() => {});
  }

  await logActivity(admin.sub, nextStatus === "ready" ? "video.ready" : "video.processing", "video", row.id, {
    mode, size: row.source_size,
  });

  return json({ ok: true, video: await withCategory(updated?.[0] ?? { ...row, ...patch }), processingMode: mode });
}

async function abortUpload(req, id) {
  const admin = requireAdmin(req);
  const row = await getVideoOr404(id);
  if (row.upload_id && row.upload_key && !r2ConfigMissing()) {
    try { await abortMultipartUpload(row.upload_key, row.upload_id); } catch { /* best effort */ }
  }
  const wasNew = row.status === "uploading";
  await dbApi.update("videos", `id=eq.${row.id}`, {
    upload_key: null, upload_id: null,
    ...(wasNew ? { status: "draft" } : {}),
    updated_at: nowIso(),
  });
  await logActivity(admin.sub, "upload.abort", "video", row.id, {});
  return json({ ok: true, wasNew });
}

/* ── Media (thumbnails / category art through the small-payload path) ── */

async function uploadMedia(req) {
  const admin = requireAdmin(req);
  if (r2ConfigMissing()) throw new HttpError(503, "Storage not configured — set R2_* environment variables", "config");
  const body = await readJson(req);
  const m = String(body.dataUrl ?? "").match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw badRequest("dataUrl must be a jpeg/png/webp data URL");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0 || buf.length > 4 * 1024 * 1024) throw badRequest("Image must be smaller than 4 MB");

  const ext = m[1] === "jpg" ? "jpeg" : m[1];
  const key = objectKey("media") + `.${ext}`;
  await putObject(key, buf, `image/${ext}`);
  const url = publicUrlFor(key);

  if (body.kind === "thumbnail" && UUID_RE.test(String(body.refId ?? ""))) {
    await dbApi.update("videos", `id=eq.${body.refId}`, { thumbnail_key: key, thumbnail_url: url, updated_at: nowIso() });
  }
  await logActivity(admin.sub, "media.upload", "media", key, { bytes: buf.length });
  return json({ ok: true, url, key });
}

/* ── Categories / tags ── */

async function listCategories() {
  const cats = await categoryIndex();
  const { data: vids } = await dbApi.select("videos", "select=category_id&limit=10000");
  const counts = new Map();
  for (const v of vids) counts.set(v.category_id, (counts.get(v.category_id) ?? 0) + 1);
  return json({ categories: cats.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })) });
}

async function createCategory(req) {
  const admin = requireAdmin(req);
  const body = await readJson(req);
  const name = cleanText(body.name, 60);
  if (!name) throw badRequest("Name is required");
  const slug = cleanText(body.slug, 64) || slugifyName(name);
  const insert = {
    name, slug,
    blurb: cleanText(body.blurb, 160) || null,
    gradient: cleanText(body.gradient, 120) || "from-zinc-500/70 via-zinc-800/40",
    image_url: cleanText(body.imageUrl, 300) || null,
    sort: Number(body.sort) || 0,
  };
  // `icon` arrives with migration 0004 — skip it gracefully until then.
  const icon = cleanText(body.icon, 40);
  if (icon && (await hasColumn("categories", "icon"))) insert.icon = icon;
  const row = await dbApi.insert("categories", insert);
  invalidateCategoryCache();
  await logActivity(admin.sub, "category.create", "category", row.id ?? slug, { name });
  return json({ category: row });
}
const slugifyName = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);

async function patchCategory(req, id) {
  const admin = requireAdmin(req);
  if (!UUID_RE.test(id)) throw notFound("Category not found");
  const body = await readJson(req);
  const patch = {};
  if ("name" in body) patch.name = cleanText(body.name, 60);
  if ("slug" in body) patch.slug = slugifyName(cleanText(body.slug, 64));
  if ("blurb" in body) patch.blurb = cleanText(body.blurb, 160) || null;
  if ("gradient" in body) patch.gradient = cleanText(body.gradient, 120);
  if ("imageUrl" in body) patch.image_url = cleanText(body.imageUrl, 300) || null;
  if ("sort" in body) patch.sort = Number(body.sort) || 0;
  if ("icon" in body && (await hasColumn("categories", "icon"))) {
    patch.icon = cleanText(body.icon, 40) || null;
  }
  const updated = await dbApi.update("categories", `id=eq.${id}`, patch);
  invalidateCategoryCache();
  await logActivity(admin.sub, "category.update", "category", id, { name: patch.name });
  return json({ category: updated?.[0] });
}

async function deleteCategory(req, id) {
  const admin = requireAdmin(req);
  if (!UUID_RE.test(id)) throw notFound("Category not found");
  const inUse = await dbApi.select("videos", `category_id=eq.${id}&select=id&limit=1`);
  if (inUse.data.length) throw badRequest("Category is in use — reassign its videos first");
  await dbApi.remove("categories", `id=eq.${id}`);
  invalidateCategoryCache();
  await logActivity(admin.sub, "category.delete", "category", id, {});
  return json({ ok: true });
}

async function listTags() {
  const { data } = await dbApi.select("videos", "select=tags&limit=10000");
  const freq = new Map();
  for (const row of data) for (const t of row.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  return json({ tags: [...freq.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
}

async function removeTag(req) {
  const admin = requireAdmin(req);
  const body = await readJson(req);
  const tag = cleanText(body.tag, 24);
  if (!tag) throw badRequest("tag is required");
  const { data } = await dbApi.select("videos", `tags=cs.{${encodeURIComponent(tag)}}&select=id,tags`);
  for (const row of data) {
    await dbApi.update("videos", `id=eq.${row.id}`, { tags: (row.tags ?? []).filter((t) => t !== tag), updated_at: nowIso() });
  }
  await logActivity(admin.sub, "tag.delete", "tag", tag, { videos: data.length });
  return json({ ok: true, removed: data.length });
}

/* ── Settings / activity ── */

async function getSettings() {
  const { data } = await dbApi.select("settings", "key=eq.site&limit=1");
  return json({ settings: data?.[0]?.value ?? {} });
}

async function patchSettings(req) {
  const admin = requireAdmin(req);
  const body = await readJson(req);
  const value = {};
  if ("siteTitle" in body) value.site_title = cleanText(body.siteTitle, 80);
  if ("announcement" in body) value.announcement = cleanText(body.announcement, 200) || null;
  if ("heroEnabled" in body) value.hero_enabled = !!body.heroEnabled;
  if ("featuredVideoId" in body) {
    value.featured_video_id = body.featuredVideoId && UUID_RE.test(String(body.featuredVideoId)) ? body.featuredVideoId : null;
  }
  if ("ageText" in body) value.age_text = cleanText(body.ageText, 400) || null;

  const existing = await dbApi.one("settings", "key=eq.site&limit=1");
  const merged = { ...(existing?.value ?? {}), ...value };
  if (existing) await dbApi.update("settings", "key=eq.site", { value: merged, updated_at: nowIso() });
  else await dbApi.insert("settings", { key: "site", value: merged });
  await logActivity(admin.sub, "settings.update", "settings", "site", { fields: Object.keys(value) });
  return json({ settings: merged });
}

async function listActivity(url) {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);
  const { data } = await dbApi.select("activity_log", `order=created_at.desc&limit=${limit}`);
  return json({ activity: data });
}

/* ── External processing webhook (ffmpeg worker / Cloudflare Stream bridge) ── */

async function processCallback(req) {
  const secret = ENV("PROCESSING_WEBHOOK_SECRET");
  if (!secret) throw new HttpError(503, "Processing webhook not configured", "config");
  if (!timingSafeStr(req.headers.get("x-process-secret") ?? "", secret)) throw unauthorized("Invalid webhook secret");

  const body = await readJson(req);
  const row = await getVideoOr404(String(body.videoId ?? ""));
  const patch = { status: "ready", updated_at: nowIso() };
  if (typeof body.hlsUrl === "string" && body.hlsUrl) patch.hls_url = cleanText(body.hlsUrl, 400);
  if (Array.isArray(body.renditions)) patch.renditions = body.renditions.slice(0, 12);
  if (Number(body.durationS) > 0) patch.duration_s = Math.round(Number(body.durationS));
  if (typeof body.thumbnailUrl === "string" && body.thumbnailUrl) patch.thumbnail_url = cleanText(body.thumbnailUrl, 400);
  const updated = await dbApi.update("videos", `id=eq.${row.id}`, patch);
  await logActivity("processor", "video.processed", "video", row.id, { hls: !!patch.hls_url });
  return json({ ok: true, video: updated?.[0] });
}

/* ══════════════ router ══════════════ */

export async function handleAdmin(req, url, path) {
  const seg = path.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const [first, second, third] = [seg[0] ?? "", seg[1] ?? "", seg[2] ?? ""];
  const m = req.method;

  // Unauthenticated routes
  if (first === "auth" && second === "login" && m === "POST") return login(req);
  if (first === "process" && second === "callback" && m === "POST") return processCallback(req);

  // Everything below requires a session.
  const ip = clientIp(req.headers);
  if (m !== "GET") {
    const wl = rateLimit(`write:${ip}`, 120, 60_000);
    if (!wl.ok) throw new HttpError(429, "Too many requests — slow down", "rate_limited");
  }
  requireAdmin(req);
  assertCsrf(req);

  if (first === "auth" && second === "logout" && m === "POST") return logout(req);
  if (first === "auth" && second === "me" && m === "GET") return me(req);
  if (first === "overview" && m === "GET") return overview();
  if (first === "analytics" && !second && m === "GET") return analytics(req, url);
  if (first === "analytics" && second === "traffic" && m === "GET") return traffic(req, url);

  if (first === "videos" && !second && m === "GET") return listVideos(req, url);
  if (first === "videos" && second === "bulk" && m === "POST") return bulk(req, await readJson(req));
  if (first === "videos" && second === "check-duplicate" && m === "POST") return checkDuplicate(req);
  if (first === "schedule" && m === "GET") return listScheduled();
  if (first === "publish-due" && m === "POST") {
    const result = await publishDueVideos();
    return json({ ok: true, ...result });
  }
  if (first === "videos" && UUID_RE.test(second ?? "")) {
    if (!third) {
      if (m === "GET") return getVideo(req, second);
      if (m === "PATCH") return patchVideo(req, second);
      if (m === "DELETE") return deleteVideo(req, second);
    }
    if ((third === "publish" || third === "unpublish") && m === "POST") return setStatus(req, second, third);
    if (third === "analytics" && m === "GET") return videoAnalytics(req, url, second);
    if (third === "schedule" && m === "POST") return scheduleVideo(req, second);
  }

  if (first === "uploads" && !second && m === "POST") return createUpload(req);
  if (first === "uploads" && UUID_RE.test(second ?? "")) {
    if (third === "parts" && m === "POST") return presignParts(req, second);
    if (third === "complete" && m === "POST") return completeUpload(req, second);
    if (third === "abort" && m === "POST") return abortUpload(req, second);
  }

  if (first === "media" && m === "POST") return uploadMedia(req);

  if (first === "categories") {
    if (!second && m === "GET") return listCategories();
    if (!second && m === "POST") return createCategory(req);
    if (UUID_RE.test(second ?? "") && m === "PATCH") return patchCategory(req, second);
    if (UUID_RE.test(second ?? "") && m === "DELETE") return deleteCategory(req, second);
  }

  if (first === "tags") {
    if (!second && m === "GET") return listTags();
    if (second === "remove" && m === "POST") return removeTag(req);
  }

  if (first === "settings") {
    if (m === "GET") return getSettings();
    if (m === "PATCH") return patchSettings(req);
  }

  if (first === "activity" && m === "GET") return listActivity(url);

  return json({ error: "Not found", code: "not_found" }, { status: 404 });
}
