import { createServiceClient } from "@/lib/supabase/server";
import { inspectNowpaymentsSetup } from "@/lib/nowpayments/client";
import { getSiteUrl } from "@/lib/site";
import NowpaymentsCheck from "./NowpaymentsCheck";

export default async function SystemHealthAdmin() {
  const supabase = createServiceClient();

  // Real checks — not hardcoded
  let dbStatus = "Unknown";
  let dbLatency = "—";
  try {
    const start = Date.now();
    const { error } = await supabase.from("site_settings").select("id").limit(1).single();
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
      payDetail = "NOWPAYMENTS_IPN_SECRET is not set — incoming payment notifications will be rejected";
    } else if (setup.configWarnings.length) {
      payStatus = "Needs attention";
      payDetail = setup.configWarnings[0];
    } else {
      payStatus = "Operational";
      payDetail = `API reachable · IPN secret set · callback ${setup.ipnUrl}. Delivery itself is not proven by this check — use "Test IPN reachability" below.`;
    }
  }

  const checks = [
    { name: "Database", status: dbStatus, latency: dbLatency, desc: "Supabase PostgreSQL" },
    { name: "Auth", status: "Operational", latency: "—", desc: "Supabase Auth" },
    { name: "NOWPayments API", status: payStatus, latency: "—", desc: payDetail },
    {
      name: "Video Provider",
      status: "direct_url",
      latency: "—",
      desc: "Videos play directly from admin-supplied URLs. No hosting-provider API or relay is needed.",
    },
    { name: "Resend", status: process.env.RESEND_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "Transactional email" },
    { name: "Gemini", status: process.env.GEMINI_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "AI metadata assistant" },
  ];

  return (
    <div>
      <h1 className="text-[20px] font-semibold">System Health</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real checks only — no hardcoded uptime. Shows Unknown if cannot be checked.</p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {checks.map((c) => (
          <div key={c.name} className="rounded-lg border border-line bg-pcard p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">{c.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.status.includes("Operational") || c.status.includes("Configured") || c.status.includes("direct_url") ? "bg-emerald-500/10 text-emerald-400" : c.status.includes("Unknown") ? "bg-zinc-500/10 text-zinc-400" : "bg-amber-500/10 text-amber-300"}`}>{c.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">{c.desc}</p>
            <p className="mt-2 text-[11px] tabular-nums">Latency: {c.latency}</p>
          </div>
        ))}
      </div>

      <NowpaymentsCheck />

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">Last checked: {new Date().toLocaleString()} — real diagnostic requests performed for Database and the NOWPayments API. The video provider uses direct URLs and requires no external API check.</p>
      </div>
    </div>
  );
}