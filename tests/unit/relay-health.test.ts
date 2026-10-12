import { afterEach, describe, expect, it, vi } from "vitest";
import { checkStreamtapeRelayHealth } from "@/lib/video/relay-health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkStreamtapeRelayHealth", () => {
  it("reports healthy only when the relay health contract is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 200, result: { ok: true } }), { status: 200 }))
    );

    await expect(checkStreamtapeRelayHealth("https://relay.erobabe.com")).resolves.toMatchObject({
      ok: true,
      message: "Relay is reachable and its /health check passed.",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://relay.erobabe.com/health",
      expect.objectContaining({ method: "GET", cache: "no-store", redirect: "manual" })
    );
  });

  it("does not treat a generic HTTP 200 page as a healthy relay", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })));

    await expect(checkStreamtapeRelayHealth("https://relay.erobabe.com")).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("not the Streamtape relay health endpoint"),
    });
  });

  it("reports unavailable relays without exposing response details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret network details"); }));

    const result = await checkStreamtapeRelayHealth("https://relay.erobabe.com");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not reach the relay");
    expect(result.message).not.toContain("secret network details");
  });
});
