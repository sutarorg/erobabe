export type StreamtapeRelayHealth = {
  ok: boolean;
  latencyMs: number | null;
  message: string;
};

/**
 * Probe the relay's tiny health endpoint from the server. Video upload bodies
 * are never sent through this check or through a Next.js route.
 */
export async function checkStreamtapeRelayHealth(
  relayOrigin: string,
  timeoutMs = 3_000
): Promise<StreamtapeRelayHealth> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${relayOrigin}/health`, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: `Relay health check returned HTTP ${response.status}. Confirm the URL points to the running relay and that GET /health is public.`,
      };
    }

    const body: unknown = await response.json().catch(() => null);
    const healthy =
      body !== null &&
      typeof body === "object" &&
      "result" in body &&
      body.result !== null &&
      typeof body.result === "object" &&
      "ok" in body.result &&
      body.result.ok === true;

    if (!healthy) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: "The URL responded, but it is not the Streamtape relay health endpoint. Check STREAMTAPE_RELAY_URL and GET /health.",
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: "Relay is reachable and its /health check passed.",
    };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: controller.signal.aborted
        ? `Relay health check timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        : "Could not reach the relay. Confirm its public HTTPS URL, host availability and TLS certificate.",
    };
  } finally {
    clearTimeout(timer);
  }
}
