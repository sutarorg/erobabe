import { describe, expect, it, vi } from "vitest";

/**
 * The public header's active item is derived from the pathname, and every page
 * that is not one of the four primary destinations must leave the header
 * un-highlighted — that is what used to light up "Home" on /about and /privacy.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

import { navForPath } from "@/app/(public)/PublicLayoutClient";

describe("navForPath", () => {
  it.each([
    ["/", "home"],
    ["/categories", "categories"],
    ["/category/mature", "categories"],
    ["/latest", "latest"],
    ["/popular", "toprated"],
  ])("maps %s to %s", (path, expected) => {
    expect(navForPath(path)).toBe(expected);
  });

  it.each([
    "/about",
    "/privacy",
    "/terms",
    "/contact",
    "/faq",
    "/content-removal",
    "/video/midnight-velvet",
    "/advertiser",
  ])("leaves the header un-highlighted on %s", (path) => {
    expect(navForPath(path)).toBeNull();
  });

  it("treats a missing pathname as home", () => {
    expect(navForPath(null)).toBe("home");
  });
});
