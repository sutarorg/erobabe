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

describe("formatTimeAgo", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("renders the requested relative wording", async () => {
    const { formatTimeAgo } = await import("@/lib/site");
    expect(formatTimeAgo(ago(2 * DAY))).toBe("2 days ago");
    expect(formatTimeAgo(ago(1 * DAY))).toBe("1 day ago");
    expect(formatTimeAgo(ago(3 * HOUR))).toBe("3 hours ago");
    expect(formatTimeAgo(ago(5 * MINUTE))).toBe("5 minutes ago");
    expect(formatTimeAgo(ago(10 * 1000))).toBe("Just now");
  });

  it("scales up through weeks, months and years", async () => {
    const { formatTimeAgo } = await import("@/lib/site");
    expect(formatTimeAgo(ago(10 * DAY))).toBe("1 week ago");
    expect(formatTimeAgo(ago(60 * DAY))).toBe("2 months ago");
    expect(formatTimeAgo(ago(800 * DAY))).toBe("2 years ago");
  });

  it("never prints an invalid date", async () => {
    const { formatTimeAgo } = await import("@/lib/site");
    expect(formatTimeAgo(null)).toBe("Recently");
    expect(formatTimeAgo(undefined)).toBe("Recently");
    expect(formatTimeAgo("not-a-date")).toBe("Recently");
    expect(formatTimeAgo(new Date(Date.now() + DAY))).toBe("Just now");
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
