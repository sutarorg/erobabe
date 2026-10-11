import { describe, it, expect } from "vitest";
import { Camera, Flame, Heart, HeartHandshake, UserRound, VenetianMask, Wine } from "lucide-react";
import { CATEGORY_ICONS, resolveCategoryIcon } from "@/src/components/categoryIcons";

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
