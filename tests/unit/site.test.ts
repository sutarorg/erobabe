import { describe, it, expect } from "vitest";
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
