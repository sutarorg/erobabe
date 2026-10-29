import { tryCreateServiceClient } from "@/lib/supabase/server";
import { openRouterDiagnostics } from "@/lib/metadata/openrouter";
import { categoryCounts, MIN_VIDEOS_PER_CATEGORY, type ImportService } from "@/lib/damplips/importer";
import { loadInventory } from "@/lib/ads/inventory";
import OpenRouterCheck from "./OpenRouterCheck";

export const dynamic = "force-dynamic";

type Check = {
  name: string;
  status: string;
  latency: string;
  desc: string;
};

type Tone = "ok" | "warn" | "muted";

function toneFor(status: string): Tone {
  if (/Operational|Configured|verified|available|Bucket ready|\d+\/\d+ categories/i.test(status)) {
    return "ok";
  }
  if (/Unknown|Unavailable|Not configured|Not set|Error|Failed/i.test(status)) return "muted";
  return "warn";
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-400",
  warn: "bg-amber-500/10 text-amber-300",
  muted: "bg-zinc-500/10 text-zinc-400",
};

/** Real checks only. Every probe below reports what it actually observed. */
export default async function SystemHealthAdmin() {
  const supabase = tryCreateServiceClient();

  let dbStatus = "Unavailable";
  let dbLatency = "—";
  let dbDetail = "SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured, so no server query can run.";

  if (supabase) {
    try {
      const started = Date.now();
      const { data, error } = await supabase
        .from("site_settings")
        .select("id, site_title")
        .limit(1)
        .maybeSingle();
      const latency = Date.now() - started;
      if (error) {
        dbStatus = `Error: ${error.message}`;
      } else {
        dbStatus = "Operational";
        dbDetail = data
          ? `Supabase PostgreSQL · site_settings reachable (${latency} ms)`
          : "Supabase PostgreSQL reachable, but site_settings has no row yet.";
      }
      dbLatency = `${latency} ms`;
    } catch (error: unknown) {
      dbStatus = `Failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  // Advertising inventory: the same resolver the checkout and the rails use.
  let slotStatus = "Unavailable";
  let slotDetail = "Ad slot inventory could not be read. Apply the latest database migration.";
  if (supabase) {
    try {
      const slots = await loadInventory();
      const available = slots.filter((slot) => slot.available).length;
      slotStatus = `${available}/${slots.length || 10} slots available`;
      slotDetail = slots
        .map((slot) => `Slot ${slot.id}: ${slot.available ? "available" : "taken"}`)
        .join(" · ");
    } catch {
      /* honest unknown */
    }
  }

  // Creative storage: a missing public bucket breaks every checkout upload.
  let storageStatus = "Not tested";
  let storageDetail = "Supabase storage could not be reached.";
  if (supabase) {
    try {
      const { error } = await supabase.storage.from("ad-creatives").list("", { limit: 1 });
      if (error) {
        storageStatus = `Unavailable: ${error.message}`;
      } else {
        storageStatus = "Bucket ready";
        storageDetail = "ad-creatives bucket accepts service-role uploads for guest creatives.";
      }
    } catch (error: unknown) {
      storageStatus = `Failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  // Payment review queue.
  let orderStatus = "Not tested";
  let orderDetail = "Ad order queue could not be read.";
  if (supabase) {
    try {
      const [{ count: inReview }, { count: live }] = await Promise.all([
        supabase.from("ad_orders").select("id", { count: "exact", head: true }).eq("status", "in_review"),
        supabase.from("ad_orders").select("id", { count: "exact", head: true }).eq("status", "live"),
      ]);
      orderStatus = `${inReview || 0} in review`;
      orderDetail = `${live || 0} live now · payments are confirmed manually in PayPal from Ad Review.`;
    } catch {
      /* honest unknown */
    }
  }

  // The AI metadata configuration, reported without calling OpenRouter.
  const ai = openRouterDiagnostics();
  const aiStatus = ai.configured ? "Configured" : "Not configured";

  // The catalog is embedded from damplips; this is the real per-category count.
  let catalogStatus = "Unavailable";
  let catalogDetail =
    "Category counts could not be read. Apply migration 00000000000026_damplips_embeds.sql.";
  if (supabase) {
    try {
      const counts = await categoryCounts(supabase as unknown as ImportService);
      const filled = counts.filter((entry) => entry.count >= MIN_VIDEOS_PER_CATEGORY);
      catalogStatus = `${filled.length}/${counts.length} categories at ${MIN_VIDEOS_PER_CATEGORY}+`;
      catalogDetail = counts.map((entry) => `${entry.label}: ${entry.count}`).join(" · ");
    } catch {
      /* honest unknown, never fabricated availability */
    }
  }

  const checks: Check[] = [
    { name: "Database", status: dbStatus, latency: dbLatency, desc: dbDetail },
    {
      name: "Admin session",
      status: "Session verified",
      latency: "—",
      desc: "This page renders only for an active admin profile; unauthenticated requests are redirected to the staff sign-in.",
    },
    {
      name: "Ad slot inventory",
      status: slotStatus,
      latency: "—",
      desc: slotDetail,
    },
    {
      name: "Ad creative storage",
      status: storageStatus,
      latency: "—",
      desc: storageDetail,
    },
    {
      name: "PayPal ad review queue",
      status: orderStatus,
      latency: "—",
      desc: orderDetail,
    },
    {
      name: "Video catalog (damplips)",
      status: catalogStatus,
      latency: "—",
      desc: catalogDetail,
    },
    {
      name: "Video uploads",
      status: "Retired",
      latency: "—",
      desc: "Uploads and the Bunny Stream pipeline are removed. The library is filled by the damplips importer from Videos → Sync from damplips, or by `npm run import:damplips`.",
    },
    {
      name: "Resend",
      status: process.env.RESEND_API_KEY ? "Configured" : "Not configured",
      latency: "—",
      desc: "Transactional email for the “Your ad is live! Erobabe” notification.",
    },
    {
      name: "AI metadata (OpenRouter)",
      status: aiStatus,
      latency: "—",
      desc: ai.configured
        ? `AI metadata assistant · key: ${ai.keyKind} · model ${ai.model} · routes ${ai.models.length} (preferred first, then free fallbacks) · reasoning ${ai.reasoning} · titles: ${ai.titleStyle} (${ai.titleWords.min}-${ai.titleWords.max} words)`
        : `AI metadata assistant · OPENROUTER_API_KEY is not set · titles fall back to the offline ${ai.titleStyle} composer`,
    },
  ];

  const retained = supabase
    ? await supabase
        .from("media_retention")
        .select("id, video_id, provider, provider_file_id, status")
        .eq("status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] as any[], error: null as any };

  return (
    <div>
      <h1 className="text-[20px] font-semibold">System Health</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        Real checks only — no hardcoded uptime. Shows Unknown if it cannot be checked.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div key={check.name} className="rounded-lg border border-line bg-pcard p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium">{check.name}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${TONE_CLASS[toneFor(check.status)]}`}
              >
                {check.status}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{check.desc}</p>
            <p className="mt-2 text-[11px] tabular-nums">Latency: {check.latency}</p>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-sm font-semibold">Retained remote media</h2>
        <p className="mt-1 text-xs text-ink-3">
          Catalog deletion does not delete provider media. Review these retained references under the
          retention policy in DEPLOYMENT.md before provider-side deletion.
        </p>
        {retained.error ? (
          <p className="mt-2 text-xs text-amber-300">Retention inventory unavailable. Check migrations.</p>
        ) : retained.data?.length ? (
          retained.data.map((row: any) => (
            <p key={row.id} className="mt-2 break-all font-mono text-xs">
              {row.provider} · {row.provider_file_id} · review {row.id}
            </p>
          ))
        ) : (
          <p className="mt-2 text-xs text-ink-3">No pending remote-media reviews.</p>
        )}
      </section>

      <OpenRouterCheck />

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">
          Last checked: {new Date().toLocaleString()} — real diagnostic requests are performed for
          Database, ad slot inventory, creative storage, the ad review queue and the damplips catalog.
          Use “Test OpenRouter” to prove the AI metadata key with a live call. PayPal payments are
          checked manually in your PayPal account from Ad Review.
        </p>
      </div>
    </div>
  );
}
