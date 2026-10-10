import { describe, it, expect } from "vitest";
import { getVideoProvider, UqloadProvider, InternalProvider } from "@/lib/video/provider";

describe("video provider", () => {
  it("uqload provider is disabled without approval", () => {
    process.env.UQLOAD_API_KEY = "";
    process.env.UQLOAD_ADULT_CONTENT_APPROVED = "false";
    const provider = new UqloadProvider();
    expect(provider.isEnabled()).toBe(false);
  });

  it("internal provider is always enabled", () => {
    const provider = new InternalProvider();
    expect(provider.isEnabled()).toBe(true);
  });

  it("getVideoProvider returns correct provider", () => {
    const provider = getVideoProvider("internal");
    expect(provider.name).toBe("internal");
  });
});
