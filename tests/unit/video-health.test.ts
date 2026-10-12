import { describe, it, expect } from "vitest";
import { inspectVideoProvider } from "@/lib/video/health";

/** What Admin → System Health says about the video provider (configuration only — it never calls UFOLOAD). */

const KEY = "ufo_HEALTHCHECK_KEY_never_printed_123456";
const base = { VIDEO_PROVIDER: "ufoload", UFOLOAD_API_KEY: KEY, UFOLOAD_ADULT_CONTENT_APPROVED: "true", CRON_SECRET: "a-long-random-cron-secret-0123456789" };

describe("system health: video provider", () => {
  it("shows blocked — with the written-approval requirement — while the flag is not set", () => {
    const result = inspectVideoProvider({ ...base, UFOLOAD_ADULT_CONTENT_APPROVED: "false" });
    expect(result.status).toBe("ufoload (blocked — see DEPLOYMENT.md)");
    expect(result.detail).toMatch(/Written approval from UFOLOAD is required/);
  });

  it("names a missing API key", () => {
    const result = inspectVideoProvider({ ...base, UFOLOAD_API_KEY: "" });
    expect(result.status).toMatch(/blocked/);
    expect(result.detail).toMatch(/UFOLOAD_API_KEY is not set/);
  });

  it("reports configured when both are set — worded as the operator's flag, never as UFOLOAD's approval", () => {
    const result = inspectVideoProvider(base);
    expect(result.status).toBe("Configured — ufoload (approval flag set)");
    expect(result.status).not.toMatch(/approved by/i);
    expect(result.detail).toMatch(/does not verify it/);
  });

  it("says plainly whether the reconcile endpoint has a secret — and that a scheduler is still needed", () => {
    expect(inspectVideoProvider(base).detail).toMatch(/CRON_SECRET set\) — an external scheduler must still call/);
    expect(inspectVideoProvider({ ...base, CRON_SECRET: "" }).detail).toMatch(/No CRON_SECRET/);
    expect(inspectVideoProvider({ ...base, CRON_SECRET: "too-short" }).detail).toMatch(/No CRON_SECRET/);
  });

  it("reports an unknown or retired provider as misconfigured, not as a working fallback", () => {
    for (const name of ["bunny", "uqload", "internal"]) {
      const result = inspectVideoProvider({ ...base, VIDEO_PROVIDER: name });
      expect(result.status).toBe("Misconfigured");
      expect(result.detail).toMatch(/VIDEO_PROVIDER=ufoload/);
    }
  });

  it("treats an unset VIDEO_PROVIDER as ufoload", () => {
    expect(inspectVideoProvider({ ...base, VIDEO_PROVIDER: undefined }).status).toBe("Configured — ufoload (approval flag set)");
  });

  it("never prints the API key", () => {
    for (const env of [base, { ...base, UFOLOAD_ADULT_CONTENT_APPROVED: "false" }, { ...base, VIDEO_PROVIDER: KEY }]) {
      const result = inspectVideoProvider(env);
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });
});
