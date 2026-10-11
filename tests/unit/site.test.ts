import { describe, it, expect, afterEach, vi } from "vitest";
import { categorySlug, fmtUSD, SLOT_PRICE_CENTS } from "@/lib/site";

describe("site helpers", () => {
  it("categorySlug converts label to URL-safe slug", () => {
    expect(categorySlug("Mature 18+")).toBe("mature-18plus");
    expect(categorySlug("Couples")).toBe("couples");
    expect(categorySlug("Mature")).toBe("mature");
  });

  it("fmtUSD formats cents to USD", () => {
    expect(fmtUSD(9900)).toBe("$99.00");
    expect(fmtUSD(19800)).toBe("$198.00");
  });

  it("slot price is 9900 cents", () => {
    expect(SLOT_PRICE_CENTS).toBe(9900);
  });
});

describe("getSiteUrl", () => {
  const KEY = "NEXT_PUBLIC_SITE_URL";
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    vi.resetModules();
  });

  async function load(value?: string) {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    vi.resetModules();
    const mod = await import("@/lib/site");
    return mod.getSiteUrl();
  }

  it("adds the missing protocol", async () => {
    expect(await load("erobabe.vercel.app")).toBe("https://erobabe.vercel.app");
  });

  it("strips paths, trailing slashes and query strings", async () => {
    expect(await load("https://erobabe.com/")).toBe("https://erobabe.com");
    expect(await load("https://erobabe.com/some/path?x=1")).toBe("https://erobabe.com");
  });

  it("falls back for missing, placeholder or malformed values", async () => {
    expect(await load(undefined)).toBe("https://erobabe.com");
    expect(await load("your-domain.com")).toBe("https://erobabe.com");
    expect(await load("https:////")).toBe("https://erobabe.com");
    expect(await load("localhost")).toBe("https://erobabe.com");
  });
});
