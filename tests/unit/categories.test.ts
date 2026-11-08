import { describe, it, expect } from "vitest";
import { Camera, Flame, Heart, HeartHandshake, UserRound, VenetianMask, Wine } from "lucide-react";
import { CATEGORY_ICONS, resolveCategoryIcon } from "@/src/components/categoryIcons";
import {
  DAMPLIPS_LATEST_PATHS,
  matchesCategory,
  sourcePlan,
} from "@/lib/damplips/categories";

describe("category icons", () => {
  it("resolves every icon name stored by the seed migration", () => {
    // supabase/migrations/00000000000002_seed_fixed_data.sql
    const seeded = ["flame", "camera", "eye", "users", "mask", "wine", "heart", "sparkles", "user", "drama", "flower"];
    for (const name of seeded) {
      const icon = CATEGORY_ICONS[name];
      expect(icon, `missing icon for "${name}"`).toBeTruthy();
      // Lucide exports forwardRef objects, so check it is renderable rather
      // than a bare function.
      expect(typeof icon === "function" || "$$typeof" in (icon as object)).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveCategoryIcon("  Camera ")).toBe(Camera);
    expect(resolveCategoryIcon("MASK")).toBe(VenetianMask);
  });

  it("falls back to the slug when no icon is stored", () => {
    expect(resolveCategoryIcon(null, "amateur")).toBe(Camera);
    expect(resolveCategoryIcon("", "mature-18plus")).toBe(Wine);
    expect(resolveCategoryIcon(null, "solo")).toBe(UserRound);
    expect(resolveCategoryIcon(null, "couples")).toBe(HeartHandshake);
  });

  it("keeps Couples and Romantic visually distinct", () => {
    expect(resolveCategoryIcon("heart", "romantic")).toBe(Heart);
    expect(resolveCategoryIcon("heart", "couples")).toBe(Heart);
    expect(resolveCategoryIcon(null, "couples")).toBe(HeartHandshake);
  });

  it("passes a Lucide component straight through", () => {
    expect(resolveCategoryIcon(Camera)).toBe(Camera);
  });

  it("never returns undefined for an unknown value", () => {
    expect(resolveCategoryIcon("not-an-icon", "not-a-slug")).toBe(Flame);
    expect(resolveCategoryIcon(undefined, undefined)).toBe(Flame);
  });
});

describe("damplips category matching", () => {
  it("accepts a post filed under one of the category's own taxonomy slugs", () => {
    // The post's own /c/<slug>/ link is the strongest signal there is.
    expect(matchesCategory("milf", { categorySlugs: ["milf"], title: "An afternoon" })).toBe(true);
    expect(
      matchesCategory("amateur", { categorySlugs: ["amateur-porn"], title: "An afternoon" }),
    ).toBe(true);
    // A sibling candidate slug counts too.
    expect(matchesCategory("lesbian", { categorySlugs: ["girl-girl"] })).toBe(true);
  });

  it("accepts a post whose subject words match the category", () => {
    // Search results and related-video links carry no taxonomy at all.
    expect(matchesCategory("milf", { title: "A MILF teaches the neighbour" })).toBe(true);
    expect(matchesCategory("threesome", { title: "A 3some on the balcony" })).toBe(true);
    expect(matchesCategory("pov", { title: "POV: the morning after" })).toBe(true);
    expect(matchesCategory("big-ass", { title: "She shows off her big booty" })).toBe(true);
    expect(matchesCategory("amateur", { tags: ["homemade couple"] })).toBe(true);
  });

  it("refuses a post that belongs to no part of the category", () => {
    // Not this category: the importer stores it with no category instead of
    // mislabelling it.
    expect(matchesCategory("milf", { title: "Two students in a dorm" })).toBe(false);
    expect(matchesCategory("hentai", { categorySlugs: ["anal"], title: "A garden afternoon" })).toBe(false);
    // Words that say nothing about the subject never match.
    expect(matchesCategory("amateur", { title: "Full HD video scene" })).toBe(false);
    expect(matchesCategory("not-a-category", { title: "milf" })).toBe(false);
  });

  it("walks the newest archives after the searches, as the depth behind a round", () => {
    const plan = sourcePlan("milf");
    const kinds = plan.map((entry) => entry.kind);
    const firstLatest = kinds.indexOf("latest");
    expect(firstLatest).toBeGreaterThan(kinds.lastIndexOf("search"));
    expect(plan.filter((entry) => entry.kind === "latest").length).toBe(
      DAMPLIPS_LATEST_PATHS.length,
    );
    // Every plan entry is still a damplips URL.
    expect(plan.every((entry) => entry.url.startsWith("https://www.damplips.com/"))).toBe(true);
    expect(DAMPLIPS_LATEST_PATHS.length).toBeGreaterThan(0);
  });
});
