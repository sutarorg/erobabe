import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_VIDEO_PROVIDER,
  InternalProvider,
  StreamtapeProvider,
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
  it("defaults to Streamtape", () => {
    expect(DEFAULT_VIDEO_PROVIDER).toBe("streamtape");
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(StreamtapeProvider);
    expect(provider.name).toBe("streamtape");
  });

  it("returns the internal placeholder when it is asked for explicitly", () => {
    const provider = getVideoProvider("internal");
    expect(provider).toBeInstanceOf(InternalProvider);
    expect(provider.name).toBe("internal");
  });

  it("reads the provider from the environment, case-insensitively", () => {
    process.env.VIDEO_PROVIDER = "STREAMTAPE";
    expect(getVideoProvider().name).toBe("streamtape");
  });

  it("fails closed for the retired UFOLOAD provider, pointing at the replacement", () => {
    expect(() => getVideoProvider("ufoload")).toThrow(/retired/);
    expect(() => getVideoProvider("ufoload")).toThrow(/VIDEO_PROVIDER=streamtape/);
  });

  it("fails closed for the long-retired Uqload provider instead of falling back", () => {
    expect(() => getVideoProvider("uqload")).toThrow(/Unknown VIDEO_PROVIDER/);
  });

  it("fails closed for a typo, naming the variable to fix", () => {
    process.env.VIDEO_PROVIDER = "streamtap";
    let message = "";
    try {
      getVideoProvider();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/VIDEO_PROVIDER=streamtape/);
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

describe("streamtape provider availability", () => {
  it("is disabled until credentials and the content-policy gate are configured", () => {
    delete process.env.STREAMTAPE_LOGIN;
    delete process.env.STREAMTAPE_API_KEY;
    delete process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED;

    const provider = new StreamtapeProvider();
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/STREAMTAPE_LOGIN/);

    process.env.STREAMTAPE_LOGIN = "login-abcdef";
    process.env.STREAMTAPE_API_KEY = "key-0123456789";
    expect(provider.isEnabled()).toBe(false);
    expect(provider.disabledReason()).toMatch(/STREAMTAPE_ADULT_CONTENT_ALLOWED/);

    process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED = "true";
    expect(provider.isEnabled()).toBe(true);
    expect(provider.disabledReason()).toBeNull();
  });

  it("builds the documented embed address from a file id", () => {
    const provider = new StreamtapeProvider();
    expect(provider.getEmbedUrl("wg8ad12d3QiJRXG")).toBe("https://streamtape.com/e/wg8ad12d3QiJRXG");
  });
});
