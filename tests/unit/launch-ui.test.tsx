import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AdminNav from "@/app/admin/(dashboard)/AdminNav";
import { homeSections } from "@/lib/public/selection";
import type { PublicVideo } from "@/lib/public/catalog";
import { activeHref } from "@/src/components/DashboardNav";
import { Film } from "lucide-react";
let path = "/admin/videos";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
afterEach(cleanup);
describe("production portal navigation", () => {
  it("expands Content with only Videos active, and offers no upload route", () => {
    render(<AdminNav />);
    expect(screen.getByRole("button", { name: "Content" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Uploads are retired: the library is curated in place.
    expect(screen.queryByRole("link", { name: /upload/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Categories" })).not.toHaveAttribute(
      "aria-current",
    );
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByRole("button", { name: "Content" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
  it("does not select prefix collisions or the admin dashboard for nested routes", () => {
    const links = [
      { href: "/admin", label: "Overview", icon: Film },
      { href: "/admin/campaigns", label: "Campaigns", icon: Film },
    ];
    expect(activeHref("/admin/campaigns/new", links)).toBe("/admin/campaigns");
    expect(activeHref("/admin/campaigns-archive", links)).toBeUndefined();
    expect(activeHref("/admin/profile", links)).toBeUndefined();
  });
});
describe("distinct home sections", () => {
  it("orders newest separately from older featured rows without duplication", () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) =>
        ({
          slug: `v${i}`,
          published_at: new Date(2026, 0, i + 1).toISOString(),
          view_count: i % 7,
        }) as PublicVideo,
    );
    const { latest, featured } = homeSections(rows);
    expect(latest).toHaveLength(16);
    expect(featured).toHaveLength(16);
    expect(latest[0].slug).toBe("v39");
    expect(featured.some((f) => latest.some((l) => l.slug === f.slug))).toBe(
      false,
    );
    expect(featured.map((v) => v.view_count)).toEqual(
      featured.map((v) => v.view_count).sort((a, b) => b - a),
    );
  });
  it("keeps at least ten recent cards when the catalog has ten or more videos", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      slug: `v${i}`,
      published_at: new Date(2026, 0, i + 1).toISOString(),
      view_count: i,
    }) as PublicVideo);
    expect(homeSections(rows).latest).toHaveLength(10);
  });
  it("handles an empty or one-video catalog honestly", () => {
    expect(homeSections([])).toEqual({ latest: [], featured: [] });
    expect(homeSections([{ slug: "only" } as PublicVideo]).featured).toEqual(
      [],
    );
  });
});
