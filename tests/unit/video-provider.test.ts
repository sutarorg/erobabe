import { describe, it, expect, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { getVideoProvider, SUPPORTED_VIDEO_PROVIDERS, UfoloadProvider } from "@/lib/video/provider";
import { VideoProviderConfigError } from "@/lib/video/errors";

/**
 * Provider selection. UFOLOAD is the only active provider, an unknown value
 * fails closed with a config error, and nothing ever falls back to Uqload.
 * (The provider's own API contract is tested in ufoload-provider.test.ts.)
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function configError(run: () => unknown): VideoProviderConfigError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(VideoProviderConfigError);
    return error as VideoProviderConfigError;
  }
  throw new Error("expected getVideoProvider to throw");
}

describe("getVideoProvider", () => {
  it("returns the UFOLOAD provider for VIDEO_PROVIDER=ufoload, ignoring case and spaces", () => {
    for (const name of ["ufoload", "UFOLOAD", "  UfoLoad  "]) {
      const provider = getVideoProvider(name);
      expect(provider).toBeInstanceOf(UfoloadProvider);
      expect(provider.name).toBe("ufoload");
    }
  });

  it("reads VIDEO_PROVIDER from the environment by default", () => {
    vi.stubEnv("VIDEO_PROVIDER", "ufoload");
    expect(getVideoProvider()).toBeInstanceOf(UfoloadProvider);
  });

  it("uses UFOLOAD when VIDEO_PROVIDER is unset — which still needs a key and the approval flag", () => {
    vi.stubEnv("VIDEO_PROVIDER", "");
    vi.stubEnv("UFOLOAD_API_KEY", "");
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "");
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(UfoloadProvider);
    expect(provider.isEnabled()).toBe(false);
  });

  it("is only enabled with both UFOLOAD_API_KEY and UFOLOAD_ADULT_CONTENT_APPROVED=true", () => {
    vi.stubEnv("VIDEO_PROVIDER", "ufoload");
    vi.stubEnv("UFOLOAD_API_KEY", "ufo_test_value_1234567890");
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "false");
    expect(getVideoProvider().isEnabled()).toBe(false);
    vi.stubEnv("UFOLOAD_ADULT_CONTENT_APPROVED", "true");
    expect(getVideoProvider().isEnabled()).toBe(true);
    vi.stubEnv("UFOLOAD_API_KEY", "");
    expect(getVideoProvider().isEnabled()).toBe(false);
  });

  it("supports exactly one provider", () => {
    expect([...SUPPORTED_VIDEO_PROVIDERS]).toEqual(["ufoload"]);
  });

  it.each(["bunny", "cloudflare", "s3", "internal", "mux", "ufolaod", "uqload-vc"])(
    "fails closed on unknown provider %j with an actionable message",
    (name) => {
      const error = configError(() => getVideoProvider(name));
      expect(error.code).toBe("provider_unknown");
      expect(error.status).toBe(503);
      expect(error.message).toContain(`Unknown VIDEO_PROVIDER "${name}"`);
      expect(error.details).toMatch(/VIDEO_PROVIDER=ufoload/);
      expect(error.details).toMatch(/never falls back/i);
    }
  );

  it("rejects the retired uqload value instead of quietly using it — or anything else", () => {
    const error = configError(() => getVideoProvider("uqload"));
    expect(error.code).toBe("provider_legacy_unsupported");
    expect(error.message).toMatch(/no longer supported/);
    expect(error.details).toMatch(/VIDEO_PROVIDER=ufoload/);
    expect(error.details).toMatch(/Existing Uqload videos keep playing/);
    expect(error.details).toMatch(/no new upload is ever sent to Uqload/i);
  });

  it("never returns an object that talks to Uqload, whatever it is given", () => {
    for (const name of ["uqload", "UQLOAD", "uqload.vc", "", undefined, null, "ufoload", "nonsense"]) {
      try {
        const provider = getVideoProvider(name as string | undefined);
        expect(provider.name).toBe("ufoload");
      } catch (error) {
        expect(error).toBeInstanceOf(VideoProviderConfigError);
      }
    }
  });

  it("does not echo a pasted secret back in the error", () => {
    const error = configError(() => getVideoProvider("ufo_pastedSecretKey1234567890abcdef"));
    expect(error.message).not.toContain("pastedSecretKey");
    expect(error.message).toContain("[redacted]");
  });
});

/**
 * A guard on the code itself: the only place Uqload may still appear in
 * shipped source is prose explaining the migration and the legacy image host
 * kept so historical thumbnails still render.
 */
describe("no runtime path reaches Uqload", () => {
  const root = path.resolve(__dirname, "../..");

  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
      else if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(full);
    }
    return found;
  }

  const runtimeFiles = [
    ...sourceFiles(path.join(root, "lib")),
    ...sourceFiles(path.join(root, "app")),
    ...sourceFiles(path.join(root, "src/utils")),
  ];

  it("has runtime files to scan", () => {
    expect(runtimeFiles.length).toBeGreaterThan(20);
  });

  it("contains no Uqload host, API path, env var or adapter", () => {
    const offenders: string[] = [];
    for (const file of runtimeFiles) {
      const text = readFileSync(file, "utf8");
      if (/uqload\.vc|UQLOAD_[A-Z_]+|class\s+Uqload|\/api\/videos\/uqload|uqload-(session|confirm|match|response)/i.test(text)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the legacy Uqload image host only so old thumbnails still render", () => {
    const config = readFileSync(path.join(root, "next.config.mjs"), "utf8");
    expect(config).toMatch(/\*\*\.uqload\.vc/);
  });
});
