import { createServiceClient } from "@/lib/supabase/server";
import { inspectNowpaymentsSetup } from "@/lib/nowpayments/client";
import { getSiteUrl } from "@/lib/site";
import {
  uploadConfiguration,
  bunnyRequest,
  providerError,
} from "@/lib/video/bunny";
import { openRouterDiagnostics } from "@/lib/metadata/openrouter";
import NowpaymentsCheck from "./NowpaymentsCheck";
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

  // Real NOWPayments check — verifies the API key against the live API.
  let payStatus = "Not configured";
  let payDetail = "Crypto payment gateway";
  if (process.env.NOWPAYMENTS_API_KEY) {
    const setup = await inspectNowpaymentsSetup(getSiteUrl());
    if (setup.error) {
      payStatus = "Unreachable";
      payDetail = setup.error;
    } else if (!setup.ipnSecretConfigured) {
      payStatus = "IPN secret missing";
      payDetail =
        "NOWPAYMENTS_IPN_SECRET is not set — incoming payment notifications will be rejected";
    } else if (setup.configWarnings.length) {
      payStatus = "Needs attention";
      payDetail = setup.configWarnings[0];
    } else {
      payStatus = "Operational";
      payDetail = `API reachable · IPN secret set · callback ${setup.ipnUrl}. Delivery itself is not proven by this check — use "Test IPN reachability" below.`;
    }
  }

  // Real AI metadata configuration check — reported without calling OpenRouter
  // (the "Test OpenRouter" button below performs the live probe on demand).
  const ai = openRouterDiagnostics();
  const aiStatus = ai.configured ? "Configured" : "Not configured";

  let videoStatus = "Configuration blocked";
  try {
    uploadConfiguration();
    await bunnyRequest("?page=1&itemsPerPage=1");
    videoStatus = "Operational — API connected";
  } catch (e) {
    videoStatus = providerError(e).error;
  }

  let videoLifecycle =
    "Unknown — apply the Bunny migration before checking sessions";
  /** Sessions a background publish sweep could still act on. */
  let sweepPending = 0;
  try {
    const { data, error } = await supabase
      .from("bunny_uploads")
      .select("state,provider_status,last_error")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (!error) {
      const rows = (data || []) as {
        state: string;
        provider_status: number | null;
        last_error?: string | null;
      }[];
      const count = (states: string[]) =>
        rows.filter((r) => states.includes(r.state)).length;
      const thumbnails = rows.filter((r) =>
        /thumbnail/i.test(r.last_error || ""),
      ).length;
      sweepPending =
        count(["uploading", "creating"]) + count(["processing"]) + count(["ready"]);
      videoLifecycle = `${count(["uploading", "creating"])} awaiting/uploading · ${count(["processing"])} processing · ${count(["ready"])} ready awaiting save · ${count(["completed"])} completed · ${count(["failed"])} failed · ${count(["cancelled"])} paused · ${thumbnails} thumbnail failures (latest 100 sessions)`;
    }
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
      name: "NOWPayments API",
      status: payStatus,
      latency: "—",
      desc: payDetail,
    },
    {
      name: "Video Provider",
      status: videoStatus,
      latency: "—",
      desc: "Bunny Stream read-only API connectivity. This does not prove TUS upload or playback; verify a real staging upload. Processing and thumbnail failures appear in upload sessions.",
    },
    {
      name: "Bunny upload lifecycle",
      status: "Session diagnostics",
      latency: "—",
      desc: videoLifecycle,
    },
    {
      name: "Background auto-publish",
      status: process.env.CRON_SECRET
        ? "Scheduler can authenticate"
        : "No scheduler secret",
      latency: "—",
      desc: process.env.CRON_SECRET
        ? `CRON_SECRET is set, so a scheduler may call /api/cron/bunny-publish and publish finished uploads with no browser open. ${sweepPending} session(s) currently waiting for it. Run the "Publish finished uploads" GitHub workflow, or curl the endpoint with Authorization: Bearer <secret>, to prove it.`
        : `CRON_SECRET is not set, so /api/cron/bunny-publish answers an active admin session only: an encode that finishes after the upload tab is closed stays unpublished until an administrator confirms the session. ${sweepPending} session(s) are waiting. Set CRON_SECRET on the host and run the "Publish finished uploads" GitHub workflow.`,
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
        ? `AI metadata assistant · key: ${ai.keyKind} · model ${ai.model} · reasoning ${ai.reasoning} · titles: ${ai.titleStyle} (${ai.titleWords.min}-${ai.titleWords.max} words)`
        : `AI metadata assistant · OPENROUTER_API_KEY is not set · titles fall back to the offline ${ai.titleStyle} composer`,
    },
  ];

  const { data: retainedMedia, error: retentionError } = await supabase
    .from("media_retention")
    .select("id, video_id, provider, provider_file_id, library_id, status")
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
          objects under the retention policy in DEPLOYMENT.md before
          provider-side deletion.
        </p>
        {retentionError ? (
          <p className="mt-2 text-xs text-amber-300">
            Retention inventory unavailable. Check migrations.
          </p>
        ) : retainedMedia?.length ? (
          retainedMedia.map((row: any) => (
            <p key={row.id} className="mt-2 break-all font-mono text-xs">
              {row.provider} · library {row.library_id || "legacy"} ·{" "}
              {row.provider_file_id} · review {row.id}
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
                className={`rounded-full px-2 py-0.5 text-[10px] ${c.status.includes("Operational") || c.status.includes("Configured") || c.status.includes("direct_url") ? "bg-emerald-500/10 text-emerald-400" : c.status.includes("Unknown") ? "bg-zinc-500/10 text-zinc-400" : "bg-amber-500/10 text-amber-300"}`}
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

      <NowpaymentsCheck />

      <OpenRouterCheck />

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">
          Last checked: {new Date().toLocaleString()} — real diagnostic requests
          performed for Database and the NOWPayments API. Bunny Stream
          connectivity is checked with a read-only library request. Use “Test
          OpenRouter” to prove the AI metadata key with a live call.
        </p>
      </div>
    </div>
  );
}
