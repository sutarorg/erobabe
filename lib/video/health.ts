import { getVideoProvider } from "@/lib/video/provider";

/** Configuration-only check of the video provider — it never calls UFOLOAD and never prints a secret. */
export function inspectVideoProvider(env: Record<string, string | undefined> = process.env): { status: string; detail: string } {
  const reconcile =
    (env.CRON_SECRET || "").trim().length >= 16
      ? "Reconcile endpoint armed (CRON_SECRET set) — an external scheduler must still call POST /api/videos/reconcile."
      : "No CRON_SECRET: unfinished videos only advance while an admin has the upload page open.";
  try {
    const provider = getVideoProvider(env.VIDEO_PROVIDER, { env });
    const { enabled, problems } = provider.readiness();
    if (!enabled) {
      return {
        status: `${provider.name} (blocked — see DEPLOYMENT.md)`,
        detail: `${problems.map((problem) => problem.message).join(" ")} ${reconcile}`,
      };
    }
    return {
      status: `Configured — ${provider.name} (approval flag set)`,
      detail: `Direct chunked upload and async URL import. The approval flag is the operator's statement that UFOLOAD confirmed in writing; this check does not verify it. ${reconcile}`,
    };
  } catch (error) {
    const known = error as { message?: string; details?: string };
    return { status: "Misconfigured", detail: known.details || known.message || "The video provider is not configured." };
  }
}
