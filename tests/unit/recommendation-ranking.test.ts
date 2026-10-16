import { describe, expect, it } from "vitest";
import { ALGORITHM_VERSION, RECOMMENDATION_WEIGHTS, isAfterLatestCursor, isAfterLikeCursor, isAfterRankCursor, mostLikedScore, rankCandidates, type RecommendationCandidate } from "@/lib/recommendations/ranking";

const items: RecommendationCandidate[] = [
  { id: "a1", slug: "a1", title: "Gentle sunset scene", category_id: "a", category_label: "A", published_at: "2026-10-15T00:00:00.000Z", view_count: 20 },
  { id: "a2", slug: "a2", title: "Gentle sunset scene extended", category_id: "a", category_label: "A", published_at: "2026-10-14T00:00:00.000Z", view_count: 30 },
  { id: "b1", slug: "b1", title: "Quiet coastal evening", category_id: "b", category_label: "B", published_at: "2026-10-15T00:00:00.000Z", view_count: 5 },
  { id: "c1", slug: "c1", title: "Studio portrait", category_id: "c", category_label: "C", published_at: "2026-10-13T00:00:00.000Z", view_count: 9000 },
];
const fixedNow = Date.parse("2026-10-16T00:00:00.000Z");

describe("versioned recommendation ranking", () => {
  it("uses distinct, normalized surface weights", () => {
    expect(ALGORITHM_VERSION).toBe("erobabe-rec-v1");
    for (const weights of Object.values(RECOMMENDATION_WEIGHTS)) expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(RECOMMENDATION_WEIGHTS.up_next.contextRelevance).toBeGreaterThan(RECOMMENDATION_WEIGHTS.recommended.contextRelevance);
  });

  it("applies explicit category preferences and explicit video feedback", () => {
    const result = rankCandidates(items, { surface: "recommended", now: fixedNow, preferredCategoryIds: new Set(["b"]), interestedVideoIds: new Set(["b1"]), limit: 4 });
    expect(result[0].id).toBe("b1");
    expect(result[0].reason).toMatch(/interesting|category/i);
  });

  it("hard-suppresses rejected videos and do-not-recommend categories", () => {
    const result = rankCandidates(items, { surface: "recommended", now: fixedNow, rejectedVideoIds: new Set(["b1"]), suppressedCategoryIds: new Set(["a"]), limit: 10 });
    expect(result.map((item) => item.id)).toEqual(["c1"]);
  });

  it("prioritizes current-video context on Up Next without returning the current item", () => {
    const result = rankCandidates(items, { surface: "up_next", now: fixedNow, current: items[0], limit: 4 });
    expect(result.map((item) => item.id)).not.toContain("a1");
    expect(result[0].id).toBe("a2");
  });

  it("uses bounded novelty and exposure fatigue rather than unbounded raw view counts", () => {
    const allNew = rankCandidates(items, { surface: "recommended", now: fixedNow, limit: 4 });
    const exposed = rankCandidates(items, { surface: "recommended", now: fixedNow, exposedVideoIds: new Set([allNew[0].id]), watchedVideoIds: new Set([allNew[0].id]), limit: 4 });
    expect(exposed[0].id).not.toBe(allNew[0].id);
    expect(allNew.every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
  });

  it("diversifies equal candidates across categories and suppresses near-duplicates", () => {
    const similar: RecommendationCandidate[] = [
      { id: "x1", slug: "x1", title: "Quiet velvet evening", category_id: "x", published_at: "2026-10-15T00:00:00.000Z" },
      { id: "x2", slug: "x2", title: "Quiet velvet evening again", category_id: "x", published_at: "2026-10-14T00:00:00.000Z" },
      { id: "y1", slug: "y1", title: "A completely different scene", category_id: "y", published_at: "2026-10-14T00:00:00.000Z" },
    ];
    const result = rankCandidates(similar, { surface: "featured", now: fixedNow, limit: 3 });
    expect(result[0].category_id).not.toBe(result[1].category_id);
    expect(new Set(result.map((item) => item.id)).size).toBe(3);
  });

  it("is deterministic for ties and safely handles empty or missing metadata", () => {
    const tied = [
      { id: "z", slug: "z", title: "No metadata" },
      { id: "b", slug: "b", title: "No metadata" },
      { id: "a", slug: "a", title: "No metadata" },
    ];
    expect(rankCandidates(tied, { surface: "recommended", now: fixedNow }).map((item) => item.id)).toEqual(["a", "b", "z"]);
    expect(rankCandidates([], { surface: "up_next" })).toEqual([]);
  });

  it("does not turn like counts into fake star ratings and discounts small counts logarithmically", () => {
    expect(mostLikedScore(1)).toBeGreaterThan(0);
    expect(mostLikedScore(100)).toBeGreaterThan(mostLikedScore(1));
    expect(mostLikedScore(-1)).toBe(0);
    expect(Number.isFinite(mostLikedScore(undefined))).toBe(true);
  });

  it("provides cold-start discovery without claiming a learned personal profile", () => {
    const result = rankCandidates(items, { surface: "recommended", now: fixedNow, limit: 4 });
    expect(result).toHaveLength(4);
    expect(new Set(result.map((item) => item.category_id)).size).toBeGreaterThan(1);
    expect(result.some((item) => item.reason === "A fresh discovery" || item.reason === "Recently published")).toBe(true);
  });

  it("handles a new video, stale metadata and a single-category catalog safely", () => {
    const freshMissing: RecommendationCandidate = { id: "new", slug: "new", title: "New item", published_at: "2026-10-16T00:00:00.000Z" };
    const stale: RecommendationCandidate = { id: "stale", slug: "stale", title: "Old item", published_at: "2024-01-01T00:00:00.000Z" };
    const oneCategory = [freshMissing, stale].map((item) => ({ ...item, category_id: "only" }));
    const result = rankCandidates(oneCategory, { surface: "featured", now: fixedNow, limit: 10 });
    expect(result.map((item) => item.id)).toEqual(["new", "stale"]);
    expect(result.every((item) => Number.isFinite(item.score))).toBe(true);
    expect(result[1].features.freshness).toBeLessThan(0.001);
  });

  it("uses stable keyset predicates for score, likes and equal publication timestamps", () => {
    const scorePage = [
      { id: "a", score: 0.8 }, { id: "b", score: 0.8 }, { id: "c", score: 0.7 },
    ];
    expect(scorePage.filter((item) => isAfterRankCursor(item, { date: "0.8", id: "a" })).map((item) => item.id)).toEqual(["b", "c"]);
    const likePage = [
      { id: "a", like_count: 4 }, { id: "b", like_count: 4 }, { id: "c", like_count: 3 },
    ];
    expect(likePage.filter((item) => isAfterLikeCursor(item, { date: "4", id: "a" })).map((item) => item.id)).toEqual(["b", "c"]);
    const latestPage = [
      { id: "c", published_at: "2026-10-16T00:00:00.000Z" },
      { id: "b", published_at: "2026-10-15T00:00:00.000Z" },
      { id: "a", published_at: "2026-10-15T00:00:00.000Z" },
    ];
    expect(latestPage.filter((item) => isAfterLatestCursor(item, { date: "2026-10-15T00:00:00.000Z", id: "b" })).map((item) => item.id)).toEqual(["a"]);
  });
});
