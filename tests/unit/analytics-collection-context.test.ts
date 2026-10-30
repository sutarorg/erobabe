// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyUserAgent, isAutomatedUserAgent } from "@/lib/analytics/user-agent";
import {
  isTrackablePath,
  normalizePath,
  normalizeReferrer,
  pageLabel,
  parseUtm,
  pathToSlug,
  referrerLabel,
  slugToPath,
} from "@/lib/analytics/path";
import { countryLabel, readGeo } from "@/lib/analytics/geo";
import { analyticsVisitorHash, requestSiteHost } from "@/lib/analytics/visitor";

afterEach(() => vi.unstubAllEnvs());

describe("user-agent reduction", () => {
  it("classifies desktops, phones and tablets", () => {
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    expect(classifyUserAgent(chrome)).toEqual({ device: "desktop", browser: "Chrome", os: "Windows" });

    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(classifyUserAgent(iphone)).toEqual({ device: "mobile", browser: "Safari", os: "iOS" });

    const ipad =
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(classifyUserAgent(ipad).device).toBe("tablet");

    const androidTablet = "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    expect(classifyUserAgent(androidTablet).device).toBe("tablet");

    const androidPhone =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect(classifyUserAgent(androidPhone)).toMatchObject({ device: "mobile", os: "Android" });

    const edge = `${chrome} Edg/126.0`;
    expect(classifyUserAgent(edge).browser).toBe("Edge");
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
    expect(classifyUserAgent(firefox)).toMatchObject({ browser: "Firefox", os: "Linux" });
  });

  it("recognises crawlers, monitors and scripted clients", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
      "",
    ]) {
      expect(isAutomatedUserAgent(ua)).toBe(true);
    }
    expect(
      isAutomatedUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
      ),
    ).toBe(false);
  });
});

describe("path and referrer normalisation", () => {
  it("keeps one canonical form of a public path", () => {
    expect(normalizePath("/latest/")?.path).toBe("/latest");
    expect(normalizePath("/video//abc/")?.path).toBe("/video/abc");
    expect(normalizePath("//video/abc")).toBeNull();
    expect(normalizePath("/")?.path).toBe("/");
    expect(normalizePath("/video/abc?t=12#comments")?.path).toBe("/video/abc");
    expect(normalizePath("/video/abc/", "?utm_source=newsletter&utm_medium=email")?.utm).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: null,
    });
  });

  it("refuses private surfaces and foreign URLs", () => {
    for (const path of ["/admin", "/admin/analytics", "/checkout", "/api/track/view", "/_next/static/x", "/auth/sign-out"]) {
      expect(isTrackablePath(path)).toBe(false);
      expect(normalizePath(path)).toBeNull();
    }
    expect(normalizePath("https://evil.example/")).toBeNull();
    expect(normalizePath("//evil.example/")).toBeNull();
    expect(normalizePath("")).toBeNull();
    expect(normalizePath("/page\ninjection")).toBeNull();
  });

  it("reduces a referrer to host and path, dropping self-referrals", () => {
    expect(normalizeReferrer("https://www.google.com/search?q=private+terms")).toEqual({
      host: "google.com",
      path: "/search",
    });
    expect(normalizeReferrer("https://www.erobabe.com/latest", "erobabe.com")).toBeNull();
    expect(normalizeReferrer("https://app.erobabe.com/latest", "erobabe.com")).toBeNull();
    expect(normalizeReferrer("https://preview-123.e2b.app/x")).toBeNull();
    expect(normalizeReferrer("javascript:alert(1)")).toBeNull();
    expect(normalizeReferrer("not a url")).toBeNull();
    expect(normalizeReferrer("")).toBeNull();
    expect(normalizeReferrer(null)).toBeNull();
  });

  it("parses campaign tags defensively", () => {
    expect(parseUtm("?utm_source=reddit&utm_campaign=october")).toEqual({
      source: "reddit",
      medium: null,
      campaign: "october",
    });
    expect(parseUtm("").source).toBeNull();
    expect(parseUtm("?utm_source=" + "x".repeat(200))?.source?.length).toBe(80);
  });

  it("labels referrers and pages for humans", () => {
    expect(referrerLabel("www.google.com")).toBe("Google");
    expect(referrerLabel("t.co")).toBe("X (Twitter)");
    expect(referrerLabel("news.example.org")).toBe("news.example.org");
    expect(referrerLabel(null)).toBe("Direct");
    expect(pageLabel("/")).toBe("Home");
    expect(pageLabel("/latest")).toBe("Latest");
    expect(pageLabel("/video/some-slug")).toBe("Video · some-slug");
    expect(pageLabel("/category/asian")).toBe("Category · asian");
    expect(pageLabel("/faq")).toBe("/faq");
  });

  it("round-trips between a path and its catch-all slug", () => {
    expect(pathToSlug("/video/abc")).toEqual(["video", "abc"]);
    expect(slugToPath(["video", "abc"])).toBe("/video/abc");
    expect(slugToPath(undefined)).toBe("/");
    expect(pathToSlug("/")).toEqual([]);
  });
});

describe("coarse geography", () => {
  it("reads only valid edge headers", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "us",
      "x-vercel-ip-country-region": "California",
      "x-vercel-ip-city": "Los%20Angeles",
    });
    expect(readGeo(headers)).toEqual({ country: "US", region: "California", city: "Los Angeles" });

    const junk = new Headers({ "x-vercel-ip-country": "United States", "x-vercel-ip-city": "x".repeat(200) });
    expect(readGeo(junk)).toMatchObject({ country: null });
    expect(readGeo(junk).city?.length).toBe(80);
  });

  it("names countries from their codes", () => {
    expect(countryLabel("US")).toBe("United States");
    expect(countryLabel("GB")).toBe("United Kingdom");
    expect(countryLabel("ZZ")).toBe("ZZ");
    expect(countryLabel(null)).toBe("(not set)");
  });
});

describe("visitor hashing", () => {
  it("is stable for the same network + browser and different across them", () => {
    vi.stubEnv("ANALYTICS_HASH_SECRET", "test-secret");
    const first = new Request("https://example.com", {
      headers: { "x-real-ip": "203.0.113.9", "user-agent": "Mozilla/5.0 Chrome/126" },
    });
    const same = new Request("https://example.com/other", {
      headers: { "x-real-ip": "203.0.113.9", "user-agent": "Mozilla/5.0 Chrome/126" },
    });
    const otherNetwork = new Request("https://example.com", {
      headers: { "x-real-ip": "198.51.100.4", "user-agent": "Mozilla/5.0 Chrome/126" },
    });
    const otherBrowser = new Request("https://example.com", {
      headers: { "x-real-ip": "203.0.113.9", "user-agent": "Mozilla/5.0 Firefox/127" },
    });

    const hash = analyticsVisitorHash(first);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(analyticsVisitorHash(same)).toBe(hash);
    expect(analyticsVisitorHash(otherNetwork)).not.toBe(hash);
    expect(analyticsVisitorHash(otherBrowser)).not.toBe(hash);
    // The raw address never appears in the key.
    expect(hash).not.toContain("203.0.113.9");
  });

  it("refuses to hash without a secret", () => {
    vi.stubEnv("ANALYTICS_HASH_SECRET", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => analyticsVisitorHash(new Request("https://example.com"))).toThrow(/Service unavailable/);
  });

  it("derives the site host from origin or host header", () => {
    expect(
      requestSiteHost(new Request("https://example.com", { headers: { origin: "https://www.erobabe.com" } })),
    ).toBe("www.erobabe.com");
    expect(requestSiteHost(new Request("https://example.com", { headers: { host: "erobabe.com:443" } }))).toBe(
      "erobabe.com",
    );
    expect(requestSiteHost(new Request("https://example.com"))).toBeNull();
  });
});
