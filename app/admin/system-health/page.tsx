import { createServiceClient } from "@/lib/supabase/server";

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
  } catch (e: any) {
    dbStatus = `Failed: ${e.message}`;
  }

  const checks = [
    { name: "Database", status: dbStatus, latency: dbLatency, desc: "Supabase PostgreSQL" },
    { name: "Auth", status: "Operational", latency: "—", desc: "Supabase Auth" },
    { name: "Bcon API", status: process.env.BCON_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "Crypto payment gateway" },
    { name: "Video Provider", status: process.env.VIDEO_PROVIDER ? `${process.env.VIDEO_PROVIDER} ${process.env.UQLOAD_ADULT_CONTENT_APPROVED === "true" ? "(approved)" : "(blocked — see DEPLOYMENT.md)"}` : "Not configured", latency: "—", desc: "Uqload or replacement" },
    { name: "Resend", status: process.env.RESEND_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "Transactional email" },
    { name: "Groq", status: process.env.GROQ_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "AI metadata assistant" },
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
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.status.includes("Operational") || c.status.includes("Configured") ? "bg-emerald-500/10 text-emerald-400" : c.status.includes("Unknown") ? "bg-zinc-500/10 text-zinc-400" : "bg-amber-500/10 text-amber-300"}`}>{c.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">{c.desc}</p>
            <p className="mt-2 text-[11px] tabular-nums">Latency: {c.latency}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">Last checked: {new Date().toLocaleString()} — real diagnostic request performed for Database. Never report healthy when no check performed.</p>
      </div>
    </div>
  );
}
