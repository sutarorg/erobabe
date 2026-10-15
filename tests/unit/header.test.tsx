import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Header, { dashboardHrefFor } from "@/src/components/Header";

function renderHeader(
  options: {
    navActive?: "home" | null;
    menuOpen?: boolean;
    user?: { name: string; role?: string } | null;
  } = {},
) {
  const { navActive = "home", menuOpen = false, user = null } = options;
  return render(
    <Header
      navActive={navActive}
      onNavigate={vi.fn()}
      query=""
      onQueryChange={vi.fn()}
      searchOpen={false}
      onSearchOpenChange={vi.fn()}
      menuOpen={menuOpen}
      onMenuOpenChange={vi.fn()}
      user={user}
      onSignInClick={vi.fn()}
      onSignOut={vi.fn()}
      useLinks
    />,
  );
}

describe("public header navigation", () => {
  it("shows primary navigation at desktop widths and keeps the dropdown for compact widths", () => {
    const { unmount } = renderHeader();

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(primary.className).toContain("min-[1000px]:flex");
    // Wider spacing between the header buttons.
    expect(primary.className).toContain("gap-2");
    expect(primary.className).not.toMatch(/\bgap-1\b/);

    const menuToggle = screen.getByRole("button", { name: "Open menu" });
    expect(menuToggle.className).toContain("min-[1000px]:hidden");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();

    unmount();
    renderHeader({ menuOpen: true });
    const compactNavigation = screen.getByRole("navigation", {
      name: "Mobile",
    });
    expect(compactNavigation.className).toContain("min-[1000px]:hidden");
  });

  it("highlights Home only on the home page", () => {
    const { unmount } = renderHeader({ navActive: "home" });
    const home = screen.getByRole("link", { name: /^Home$/ });
    expect(home.getAttribute("aria-current")).toBe("page");

    unmount();
    // /about, /privacy, /terms and the watch page are not Home.
    renderHeader({ navActive: null });
    const inactiveHome = screen.getByRole("link", { name: /^Home$/ });
    expect(inactiveHome.getAttribute("aria-current")).toBeNull();
    for (const label of ["Categories", "Latest", "Popular"]) {
      expect(
        screen
          .getByRole("link", { name: new RegExp(`^${label}$`) })
          .getAttribute("aria-current"),
      ).toBeNull();
    }
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("offers Sign in when nobody is signed in", () => {
    renderHeader({ user: null });
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
  });

  it("shows Dashboard instead of Sign in for a signed-in advertiser", () => {
    renderHeader({
      user: { name: "advertiser@example.com", role: "advertiser" },
    });
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();

    const dashboard = screen.getByRole("link", { name: /dashboard/i });
    expect(dashboard.getAttribute("href")).toBe("/advertiser");
    expect(dashboard.className).toContain("border");
    expect(dashboard.className).toContain("border-line");
    expect(dashboard.className).toContain("bg-transparent");
    expect(dashboard.className).not.toContain("bg-accent");
    // Signing out must still be one click away.
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("sends an admin to the admin dashboard", () => {
    renderHeader({ user: { name: "owner@example.com", role: "admin" } });
    expect(
      screen.getByRole("link", { name: /dashboard/i }).getAttribute("href"),
    ).toBe("/admin");
  });
});

describe("dashboardHrefFor", () => {
  it("routes by role and defaults to the advertiser portal", () => {
    expect(dashboardHrefFor({ name: "a", role: "admin" })).toBe("/admin");
    expect(dashboardHrefFor({ name: "a", role: "advertiser" })).toBe(
      "/advertiser",
    );
    expect(dashboardHrefFor({ name: "a" })).toBe("/advertiser");
    expect(dashboardHrefFor(null)).toBe("/advertiser");
  });
});
