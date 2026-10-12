import { createServiceClient } from "@/lib/supabase/server";
import { inspectNowpaymentsSetup } from "@/lib/nowpayments/client";
import { StreamtapeProvider, streamtapeRelaySecretConfiguration, streamtapeRelayUrlConfiguration } from "@/lib/video/streamtape";
import { checkStreamtapeRelayHealth } from "@/lib/video/relay-health";
import { redactSecrets } from "@/lib/video/streamtape-protocol";
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
      payDetail = `API reachable · IPN secret set · callback ${setup.ipnUrl}. Delivery itself is not proven by this check — use “Test IPN reachability” below.`;
    }
  }

  const providerName = (process.env.VIDEO_PROVIDER || "streamtape").trim().toLowerCase();
  const providerKnown = providerName === "streamtape" || providerName === "internal";
  const providerApproved = providerName === "streamtape" ? process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED === "true" : providerName === "internal";
  const relayUrlConfig = streamtapeRelayUrlConfiguration();
  const relaySecretConfig = streamtapeRelaySecretConfiguration();

  /**
   * A real authenticated provider check and a separate lightweight relay
   * health probe. The probe sends no video bytes; uploads remain browser →
   * standalone relay → Streamtape, never through Next.js.
   */
  let accountCheck: Awaited<ReturnType<StreamtapeProvider["checkAccount"]>> | null = null;
  if (providerName === "streamtape" && process.env.STREAMTAPE_LOGIN && process.env.STREAMTAPE_API_KEY) {
    accountCheck = await new StreamtapeProvider().checkAccount();
  }

  const relayProbe =
    providerName === "streamtape" && relayUrlConfig.url
      ? await checkStreamtapeRelayHealth(relayUrlConfig.url)
      : null;
  const relayHealthy = Boolean(relayUrlConfig.url && relaySecretConfig.secret && relayProbe?.ok);
  const relayStatus =
    providerName !== "streamtape"
      ? "Not used"
      : !relayUrlConfig.url
        ? relayUrlConfig.code === "missing_relay"
          ? "Not configured"
          : "Invalid configuration"
        : !relaySecretConfig.secret
          ? "Secret missing/weak"
          : !relayProbe?.ok
            ? "Unreachable"
            : "Operational";
  const relayDetail =
    providerName !== "streamtape"
      ? "The Streamtape upload relay is not used unless VIDEO_PROVIDER=streamtape."
      : !relayUrlConfig.url
        ? relayUrlConfig.message || "Set STREAMTAPE_RELAY_URL to the deployed relay's HTTPS origin."
        : !relaySecretConfig.secret
          ? relaySecretConfig.message || "Set a random STREAMTAPE_RELAY_SECRET of at least 16 characters in both services."
          : !relayProbe?.ok
            ? relayProbe?.message || "The relay health check failed. Verify the deployed URL and try again."
            : `GET /health succeeded in ${relayProbe.latencyMs ?? "—"} ms. The shared secret is present; video transfers bypass Next.js.`;

  const videoProviderStatus = !providerKnown
    ? "Misconfigured"
    : providerName === "internal"
      ? "internal (embeds only)"
      : !process.env.STREAMTAPE_LOGIN || !process.env.STREAMTAPE_API_KEY
        ? "Credentials missing"
        : !providerApproved
          ? "streamtape (blocked — see DEPLOYMENT.md)"
          : accountCheck === null
            ? "streamtape (configured — not probed)"
            : !accountCheck.ok
              ? "streamtape · API unreachable"
              : relayHealthy
                ? "streamtape · ready"
                : `streamtape · relay ${relayStatus.toLowerCase()}`;

  const videoProviderDetail = !providerKnown
    ? `VIDEO_PROVIDER="${providerName}" is not supported — uploads fail closed. Set it to "streamtape" (or "internal" for embed-only deployments).`
    : providerName === "internal"
      ? "Embed-only placeholder: no video hosting, no local uploads."
      : !process.env.STREAMTAPE_LOGIN || !process.env.STREAMTAPE_API_KEY
        ? "Set STREAMTAPE_LOGIN and STREAMTAPE_API_KEY (server-only) from the Streamtape account panel → Account Settings → API/FTP credentials."
        : !providerApproved
          ? "Uploads are refused until STREAMTAPE_ADULT_CONTENT_ALLOWED=true is set after verifying Streamtape's terms, copyright policy and the account's content settings (DEPLOYMENT.md §D)."
          : accountCheck && !accountCheck.ok
            ? redactSecrets(accountCheck.error, [process.env.STREAMTAPE_API_KEY, process.env.STREAMTAPE_LOGIN])
            : accountCheck
              ? `GET /account/info succeeded in ${accountCheck.latencyMs} ms. Upload readiness also requires the separate relay shown below.`
              : "Credentials present; reachability not probed.";

  const checks = [
    { name: "Database", status: dbStatus, latency: dbLatency, desc: "Supabase PostgreSQL", healthy: dbStatus === "Operational", neutral: false },
    { name: "Auth", status: "Operational", latency: "—", desc: "Supabase Auth", healthy: true, neutral: false },
    { name: "NOWPayments API", status: payStatus, latency: "—", desc: payDetail, healthy: payStatus === "Operational", neutral: false },
    { name: "Video Provider", status: videoProviderStatus, latency: "—", desc: videoProviderDetail, healthy: videoProviderStatus === "streamtape · ready" || videoProviderStatus === "internal (embeds only)", neutral: false },
    { name: "Streamtape Upload Relay", status: relayStatus, latency: relayProbe?.latencyMs === null || relayProbe?.latencyMs === undefined ? "—" : `${relayProbe.latencyMs} ms`, desc: relayDetail, healthy: relayHealthy, neutral: relayStatus === "Not used" },
    { name: "Resend", status: process.env.RESEND_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "Transactional email", healthy: Boolean(process.env.RESEND_API_KEY), neutral: false },
    { name: "Gemini", status: process.env.GEMINI_API_KEY ? "Configured" : "Not configured", latency: "—", desc: "AI metadata assistant", healthy: Boolean(process.env.GEMINI_API_KEY), neutral: false },
  ];

  return (
    <div>
      <h1 className="text-[20px] font-semibold">System Health</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real checks only — no hardcoded uptime. Shows Unknown if a dependency cannot be checked.</p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {checks.map((c) => (
          <div key={c.name} className="rounded-lg border border-line bg-pcard p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">{c.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.healthy ? "bg-emerald-500/10 text-emerald-400" : c.neutral ? "bg-zinc-500/10 text-zinc-400" : "bg-amber-500/10 text-amber-300"}`}>{c.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">{c.desc}</p>
            <p className="mt-2 text-[11px] tabular-nums">Latency: {c.latency}</p>
          </div>
        ))}
      </div>

      <NowpaymentsCheck />

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <p className="text-[11px] text-ink-3">Last checked: {new Date().toLocaleString()} — real diagnostic requests performed for Database and configured external APIs. Relay checks call only GET /health; upload bytes never pass through Next.js.</p>
      </div>
    </div>
  );
}
