import { describe, expect, it } from "vitest";
import {
  adForPosition,
  adsForPositions,
  hashSeed,
  orderedAds,
  rotatableAds,
  rotationSeed,
  type RotatableAd,
} from "@/lib/ads/rotation";

function ad(id: string): RotatableAd {
  return {
    id,
    title: `Ad ${id}`,
    image_url: `https://cdn.example.com/${id}.png`,
    destination_url: `https://example.com/${id}`,
  };
}

const pool = Array.from({ length: 10 }, (_, index) => ad(`ad-${index + 1}`));

describe("mobile ad rotation", () => {
  it("returns nothing when no advertisement is active", () => {
    expect(orderedAds([], "visitor")).toEqual([]);
    expect(adForPosition([], 0)).toBeNull();
    expect(adsForPositions([], 4)).toEqual([null, null, null, null]);
  });

  it("fills every position with the same creative when only one ad is active", () => {
    const ordered = orderedAds([ad("only")], "visitor");
    expect(adsForPositions(ordered, 12).every((entry) => entry?.id === "only")).toBe(true);
  });

  it("spreads every active ad evenly across the banner positions", () => {
    const ordered = orderedAds(pool, "visitor-a");
    const shown = adsForPositions(ordered, 10).map((entry) => entry?.id);
    expect(new Set(shown).size).toBe(10);
    // Twenty positions show each ad exactly twice — no creative is favoured.
    const counts = new Map<string, number>();
    for (const entry of adsForPositions(ordered, 20)) {
      counts.set(String(entry?.id), (counts.get(String(entry?.id)) || 0) + 1);
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 10 }, () => 2));
  });

  it("gives two visitors different assignments for the same position", () => {
    const first = adsForPositions(orderedAds(pool, "visitor-a"), 10).map((entry) => entry?.id);
    const second = adsForPositions(orderedAds(pool, "visitor-b"), 10).map((entry) => entry?.id);
    expect(first).not.toEqual(second);
    // …while each visitor's order is stable between renders.
    expect(adsForPositions(orderedAds(pool, "visitor-a"), 10).map((entry) => entry?.id)).toEqual(first);
  });

  it("rotates on a daily seed and ignores unusable creatives", () => {
    expect(rotationSeed("token", new Date("2026-10-29T10:00:00Z"))).toBe("token:2026-10-29");
    expect(rotationSeed("", new Date("2026-10-29T10:00:00Z"))).toBe("erobabe-visitor:2026-10-29");
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));

    const mixed = rotatableAds([
      ad("keep"),
      ad("keep"),
      { ...ad("bad-destination"), destination_url: "javascript:alert(1)" },
      { ...ad("no-image"), image_url: "" },
    ]);
    expect(mixed.map((entry) => entry.id)).toEqual(["keep"]);
  });
});
