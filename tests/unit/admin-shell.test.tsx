import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ pathname: "/admin/analytics" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/src/components/PortalSidebar", () => ({
  default: ({ email, children }: { email: string; children: React.ReactNode }) => (
    <aside data-testid="sidebar">
      <span>{email}</span>
      {children}
    </aside>
  ),
}));

import AdminShell from "@/app/admin/(dashboard)/AdminShell";

beforeEach(() => {
  document.documentElement.className = "dark";
  navigation.pathname = "/admin/analytics";
});

afterEach(() => {
  cleanup();
});

describe("admin frame scrolling", () => {
  it("scrolls inside its own column", () => {
    const { container } = render(<AdminShell email="staff@example.com">Page</AdminShell>);

    const shell = container.querySelector(".admin-shell") as HTMLElement;
    expect(shell).toBeTruthy();
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.getByText("Page")).toBeTruthy();

    // Exactly one *visible* scrollbar in the frame: the content column. The
    // sidebar's own nav may scroll, but it hides its bar (`no-scrollbar`), so
    // the panel is never competing with a second scrollbar.
    const scrollers = Array.from(shell.querySelectorAll<HTMLElement>("*")).filter((node) =>
      /(^|\s)overflow-y-auto(\s|$)/.test(node.className),
    );
    const visible = scrollers.filter((node) => !node.className.includes("no-scrollbar"));
    expect(visible).toHaveLength(1);
    expect(visible[0].hasAttribute("data-admin-scroll")).toBe(true);
    expect(visible[0].className).toContain("overscroll-contain");
    expect(visible[0].className).toContain("center-scroll");
  });

  it("locks the document while it is mounted, so the browser draws no second bar", () => {
    const { unmount } = render(<AdminShell email="staff@example.com">Page</AdminShell>);
    expect(document.documentElement.classList.contains("admin-viewport-lock")).toBe(true);

    unmount();
    expect(document.documentElement.classList.contains("admin-viewport-lock")).toBe(false);
  });

  it("starts each page at the top of the column", () => {
    const { container, rerender } = render(<AdminShell email="staff@example.com">Page</AdminShell>);
    const main = container.querySelector("[data-admin-scroll]") as HTMLElement;
    main.scrollTop = 480;

    navigation.pathname = "/admin/analytics/traffic";
    rerender(<AdminShell email="staff@example.com">Next page</AdminShell>);

    expect(main.scrollTop).toBe(0);
    expect(screen.getByText("Next page")).toBeTruthy();
  });
});
