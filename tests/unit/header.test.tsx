import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Header, { dashboardHrefFor } from "@/src/components/Header";

function renderHeader(
  options: {
    navActive?: "home" | null;
    menuOpen?: boolean;
    searchOpen?: boolean;
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
      searchOpen={options.searchOpen || false}
      onSearchOpenChange={vi.fn()}
      menuOpen={menuOpen}
      onMenuOpenChange={vi.fn()}
      user={user}
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

  it("does not offer Sign in on the public header", () => {
    renderHeader({ user: null });
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
  });

  it("does not offer a removed advertiser dashboard to non-staff accounts", () => {
    renderHeader({
      user: { name: "member@example.com", role: "advertiser" },
    });
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
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
  it("routes staff to admin and returns no dashboard for guests or members", () => {
    expect(dashboardHrefFor({ name: "a", role: "admin" })).toBe("/admin");
    expect(dashboardHrefFor({ name: "a", role: "advertiser" })).toBeNull();
    expect(dashboardHrefFor({ name: "a" })).toBeNull();
    expect(dashboardHrefFor(null)).toBeNull();
  });
});

it("hides the menu control only below sm while search is open", () => {
  renderHeader({ searchOpen: true, menuOpen: true });
  expect(screen.getByRole("button", { name: "Close menu" }).className).toContain("max-sm:hidden");
  expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
});
