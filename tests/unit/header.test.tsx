import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Header from "@/src/components/Header";

function renderHeader(menuOpen = false) {
  return render(
    <Header
      navActive="home"
      onNavigate={vi.fn()}
      query=""
      onQueryChange={vi.fn()}
      searchOpen={false}
      onSearchOpenChange={vi.fn()}
      menuOpen={menuOpen}
      onMenuOpenChange={vi.fn()}
      user={null}
      onSignInClick={vi.fn()}
      onSignOut={vi.fn()}
    />
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
    renderHeader(true);
    const compactNavigation = screen.getByRole("navigation", { name: "Mobile" });
    expect(compactNavigation.className).toContain("min-[1000px]:hidden");
  });
});
