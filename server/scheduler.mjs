import { dbApi, dbConfigMissing, hasColumn } from "./db.mjs";
import { invalidateDiscovery } from "./ranking.mjs";
import { json, slugify } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Scheduled publishing.
 *
 * Bulk uploads land as drafts with a `scheduled_publish_at` stamp one
 * hour apart. Three independent triggers flip them live, so the
 * schedule holds regardless of hosting plan:
 *
 *   1. Platform cron  — /api/cron/publish (daily safety sweep on
 *      Vercel Hobby; hourly on Netlify / paid Vercel plans).
 *   2. Lazy sweep     — public API reads check for due videos at most
 *      once a minute per instance. Works even without cron.
 *   3. Manual         — the CMS calls the same endpoint on demand.
 * ────────────────────────────────────────────────────────────── */

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

async function schedulingReady() {
  return !dbConfigMissing() && (await hasColumn("videos", "scheduled_publish_at"));
}

/**
 * Publish every draft whose scheduled time has passed.
 * Uses the SQL function when present, falling back to row updates.
 */
export async function publishDueVideos() {
  if (!(await schedulingReady())) return { published: 0, titles: [] };

  const nowIso = new Date().toISOString();
  let due = [];
  try {
    const { data } = await dbApi.select(
      "videos",
      `scheduled_publish_at=lte.${nowIso}&status=in.(draft,ready)` +
        `&select=id,title,slug,video_url,hls_url,published_at&order=scheduled_publish_at.asc&limit=50`
    );
    due = data ?? [];
  } catch {
    return { published: 0, titles: [] };
  }

  // Only release videos that actually have playable media attached.
  const ready = due.filter((v) => v.video_url || v.hls_url);
  if (!ready.length) return { published: 0, titles: [] };

  const hasSlug = await hasColumn("videos", "slug");
  const titles = [];

  for (const v of ready) {
    const patch = {
      status: "published",
      published_at: v.published_at ?? nowIso,
      scheduled_publish_at: null,
      updated_at: nowIso,
    };
    // Guarantee a canonical URL before the page becomes indexable.
    if (hasSlug && !v.slug) {
      patch.slug = `${slugify(v.title) || "video"}-${String(v.id).replace(/-/g, "").slice(0, 6)}`;
    }
    try {
      await dbApi.update("videos", `id=eq.${v.id}`, patch);
      titles.push(v.title);
    } catch {
      /* Skip this one; the next sweep will retry it. */
    }
  }

  if (titles.length) {
    invalidateDiscovery();
    try {
      await dbApi.insert("activity_log", {
        actor: "scheduler",
        action: "video.publish_scheduled",
        entity: "video",
        entity_id: "batch",
        meta: { count: titles.length, titles: titles.slice(0, 10) },
      });
    } catch {
      /* logging is best-effort */
    }
  }

  return { published: titles.length, titles };
}

/** Throttled sweep invoked from public API reads (cron-free fallback). */
export function sweepDueVideos() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  void publishDueVideos().catch(() => {});
}

/**
 * GET|POST /api/cron/publish — platform cron entry point.
 *
 * Vercel Hobby only permits one cron invocation per day. The daily job is
 * therefore a recovery sweep; the public-catalog sweep above still releases
 * due videos at one-minute resolution whenever the site receives traffic.
 */
export async function handleCronPublish() {
  const result = await publishDueVideos();
  return json({ ok: true, ...result, at: new Date().toISOString() });
}
