import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_VIDEO_PROVIDER,
  InternalProvider,
  UfoloadProvider,
  getVideoProvider,
} from "@/lib/video/provider";

/**
 * Provider-selection tests.
 *
 * The migration's rule is that configuration fails closed: an unknown
 * `VIDEO_PROVIDER` must never quietly fall back to the retired Uqload
 * integration (or to any other provider nobody is watching), and the provider
 * factory is the single place that decides.
 */

const previousEnv = { ...process.env };

beforeEach(() => {
  delete process.env.VIDEO_PROVIDER;
});

afterEach(() => {
  process.env = { ...previousEnv };
});

describe("getVideoProvider", () => {
  it("defaults to UFOLOAD", () => {
    expect(DEFAULT_VIDEO_PROVIDER).toBe("ufoload");
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(UfoloadProvider);
    expect(provider.name).toBe("ufoload");
  });

  it("returns the internal placeholder when it is asked for explicitly", () => {
    const provider = getVideoProvider("internal");
    expect(provider).toBeInstanceOf(InternalProvider);
    expect(provider.name).toBe("internal");
  });

  it("reads the provider from the environment, case-insensitively", () => {
    process.env.VIDEO_PROVIDER = "UFOLOAD";
    expect(getVideoProvider().name).toBe("ufoload");
  });

  it("fails closed for the retired provider instead of falling back", () => {
    expect(() => getVideoProvider("uqload")).toThrow(/Unknown VIDEO_PROVIDER/);
    expect(() => getVideoProvider("uqload")).toThrow(/Uqload support has been removed/);
  });

  it("fails closed for a typo, naming the variable to fix", () => {
    process.env.VIDEO_PROVIDER = "ufolo";
    let message = "";
    try {
      getVideoProvider();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/VIDEO_PROVIDER=ufoload/);
  });
});

describe("internal provider", () => {
  it("is always enabled and answers a playable status for its own ids", async () => {
    const provider = new InternalProvider();
    expect(provider.isEnabled()).toBe(true);
    await expect(provider.getFileInfo("abc")).resolves.toMatchObject({ fileId: "abc", canPlay: true, status: 200 });
    await expect(provider.deleteFile("abc")).resolves.toBe(true);
  });
});

describe("ufoload provider availability", () => {
  it("is disabled until both the key and the approval flag are configured", () => {
    delete process.env.UFOLOAD_API_KEY;
    delete process.env.UFOLOAD_ADULT_CONTENT_APPROVED;

    const provider = new UfoloadProvider();
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/UFOLOAD_API_KEY/);

    process.env.UFOLOAD_API_KEY = "ufo_test_0123456789";
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/UFOLOAD_ADULT_CONTENT_APPROVED/);

    process.env.UFOLOAD_ADULT_CONTENT_APPROVED = "true";
    expect(provider.isEnabled()).toBe(true);
    expect(provider.disabledReason()).toBeNull();
  });

  it("builds documented embed and watch addresses from an identifier", () => {
    const provider = new UfoloadProvider();
    expect(provider.getEmbedUrl("aBcD1234xyz")).toBe("https://ufoload.com/e/aBcD1234xyz");
    expect(provider.getPlayableUrl("aBcD1234xyz")).toBe("https://ufoload.com/v/aBcD1234xyz");
  });
});
