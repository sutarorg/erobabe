import { createServiceClient } from "@/lib/supabase/server";
import { openRouterDiagnostics } from "@/lib/metadata/openrouter";
import { categoryCounts, MIN_VIDEOS_PER_CATEGORY, type ImportService } from "@/lib/damplips/importer";
import OpenRouterCheck from "./OpenRouterCheck";

export default async function SystemHealthAdmin() {
  const supabase = createServiceClient();

  // Real checks — not hardcoded
  let dbStatus = "Unknown";
  let dbLatency = "—";
  try {
    const start = Date.now();
    const { error } = await supabase
      .from("site_settings")
      .select("id")
      .limit(1)
      .single();
    const latency = Date.now() - start;
    dbStatus = error ? `Error: ${error.message}` : "Operational";
    dbLatency = `${latency} ms`;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    dbStatus = `Failed: ${message}`;
  }

  // Real AI metadata configuration check — reported without calling OpenRouter
  // (the "Test OpenRouter" button below performs the live probe on demand).
  const ai = openRouterDiagnostics();
  const aiStatus = ai.configured ? "Configured" : "Not configured";

  // The catalog is embedded from damplips; this is the real per-category count.
  let catalogStatus = "Unavailable";
  let catalogDetail = "Category counts could not be read. Apply migration 00000000000026_damplips_embeds.sql.";
  let catalogCounts: Awaited<ReturnType<typeof categoryCounts>> = [];
  try {
    catalogCounts = await categoryCounts(supabase as unknown as ImportService);
    const filled = catalogCounts.filter((entry) => entry.count >= MIN_VIDEOS_PER_CATEGORY);
    catalogStatus = `${filled.length}/${catalogCounts.length} categories at ${MIN_VIDEOS_PER_CATEGORY}+`;
    catalogDetail = catalogCounts
      .map((entry) => `${entry.label}: ${entry.count}`)
      .join(" · ");
  } catch {
    /* Honest unknown, never fabricated availability. */
  }

  const checks = [
    {
      name: "Database",
      status: dbStatus,
      latency: dbLatency,
      desc: "Supabase PostgreSQL",
    },
    {
      name: "Auth",
      status: "Not tested",
      latency: "—",
      desc: "Current administrator session passed authorization. Registration, recovery and email delivery require staging acceptance.",
    },
    {
      name: "PayPal ad checkout",
      status: "Manual review",
      latency: "—",
      desc: "Guest checkout uses the published PayPal QR. Staff verify each payment in PayPal before approving the ad; no payment-gateway API or advertiser account is required.",
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
      desc: "Transactional email",
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

  const { data: retainedMedia, error: retentionError } = await supabase
    .from("media_retention")
    .select("id, video_id, provider, provider_file_id, status")
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">System Health</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        Real checks only — no hardcoded uptime. Shows Unknown if cannot be
        checked.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-sm font-semibold">Retained remote media</h2>
        <p className="mt-1 text-xs text-ink-3">
          Catalog deletion does not delete provider media. Review these retained
          references under the retention policy in DEPLOYMENT.md before
          provider-side deletion.
        </p>
        {retentionError ? (
          <p className="mt-2 text-xs text-amber-300">
            Retention inventory unavailable. Check migrations.
          </p>
        ) : retainedMedia?.length ? (
          retainedMedia.map((row: any) => (
            <p key={row.id} className="mt-2 break-all font-mono text-xs">
              {row.provider} · {row.provider_file_id} · review {row.id}
            </p>
          ))
        ) : (
          <p className="mt-2 text-xs text-ink-3">
            No pending remote-media reviews.
          </p>
        )}
      </section>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {checks.map((c) => (
          <div
            key={c.name}
            className="rounded-lg border border-line bg-pcard p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">{c.name}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${c.status.includes("Operational") || c.status.includes("Configured") || c.status.includes("categories at") ? "bg-emerald-500/10 text-emerald-400" : c.status.includes("Unknown") || c.status.includes("Unavailable") ? "bg-zinc-500/10 text-zinc-400" : "bg-amber-500/10 text-amber-300"}`}
              >
                {c.status}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">{c.desc}</p>
            <p className="mt-2 text-[11px] tabular-nums">
              Latency: {c.latency}
            </p>
          </div>
        ))}
      </div>

      <OpenRouterCheck />

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">
          Last checked: {new Date().toLocaleString()} — real diagnostic requests
          are performed for Database and the damplips catalog. Use “Test
          OpenRouter” to prove the AI metadata key with a live call. PayPal
          payments are checked manually in your PayPal account from Ad Review.
        </p>
      </div>
    </div>
  );
}
