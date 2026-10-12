import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_VIDEO_PROVIDER,
  InternalProvider,
  getVideoProvider,
} from "@/lib/video/provider";

/**
 * Provider-selection tests.
 *
 * Configuration fails closed: an unknown `VIDEO_PROVIDER` must never quietly
 * fall back to a retired integration (or to any provider nobody is watching),
 * and the provider factory is the single place that decides.
 */

const previousEnv = { ...process.env };

beforeEach(() => {
  delete process.env.VIDEO_PROVIDER;
});

afterEach(() => {
  process.env = { ...previousEnv };
});

describe("getVideoProvider", () => {
  it("defaults to direct_url", () => {
    expect(DEFAULT_VIDEO_PROVIDER).toBe("direct_url");
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(InternalProvider);
    expect(provider.name).toBe("internal");
  });

  it("returns the internal placeholder when it is asked for explicitly", () => {
    const provider = getVideoProvider("internal");
    expect(provider).toBeInstanceOf(InternalProvider);
    expect(provider.name).toBe("internal");
  });

  it("accepts direct_url as the active provider", () => {
    process.env.VIDEO_PROVIDER = "direct_url";
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(InternalProvider);
  });

  it("fails closed for the retired Streamtape provider, pointing at the replacement", () => {
    expect(() => getVideoProvider("streamtape")).toThrow(/retired/);
    expect(() => getVideoProvider("streamtape")).toThrow(/VIDEO_PROVIDER=direct_url/);
  });

  it("fails closed for the retired UFOLOAD provider, pointing at the replacement", () => {
    expect(() => getVideoProvider("ufoload")).toThrow(/retired/);
    expect(() => getVideoProvider("ufoload")).toThrow(/VIDEO_PROVIDER=direct_url/);
  });

  it("fails closed for the long-retired Uqload provider instead of falling back", () => {
    expect(() => getVideoProvider("uqload")).toThrow(/Unknown VIDEO_PROVIDER/);
  });

  it("fails closed for a typo, naming the variable to fix", () => {
    process.env.VIDEO_PROVIDER = "direct_urll";
    let message = "";
    try {
      getVideoProvider();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/VIDEO_PROVIDER=direct_url/);
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