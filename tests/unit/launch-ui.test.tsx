import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AdminNav from "@/app/admin/(dashboard)/AdminNav";
import AdvertiserNav from "@/app/advertiser/AdvertiserNav";
import { homeSections } from "@/lib/public/selection";
import type { PublicVideo } from "@/lib/public/catalog";
import { activeHref } from "@/src/components/DashboardNav";
import { Film } from "lucide-react";
let path = "/admin/videos/upload";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
afterEach(cleanup);
describe("production portal navigation", () => {
  it("expands Content with only Upload Videos active on the nested route", () => {
    render(<AdminNav />);
    expect(screen.getByRole("button", { name: "Content" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Upload Videos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Videos" })).not.toHaveAttribute(
      "aria-current",
    );
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.getByRole("button", { name: "Content" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
  it("has exactly six advertiser primary links, with Billing active for legacy invoice URL", () => {
    path = "/advertiser/invoices";
    render(<AdvertiserNav />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview",
      "Book Ad Space",
      "My Campaigns",
      "Analytics",
      "Billing",
      "Help & Support",
    ]);
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("does not select prefix collisions or Overview for profile", () => {
    const links = [
      { href: "/advertiser", label: "Overview", icon: Film },
      { href: "/advertiser/campaigns", label: "Campaigns", icon: Film },
    ];
    expect(activeHref("/advertiser/campaigns/new", links)).toBe(
      "/advertiser/campaigns",
    );
    expect(activeHref("/advertiser/campaigns-archive", links)).toBeUndefined();
    expect(activeHref("/advertiser/profile", links)).toBeUndefined();
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
  it("handles an empty or one-video catalog honestly", () => {
    expect(homeSections([])).toEqual({ latest: [], featured: [] });
    expect(homeSections([{ slug: "only" } as PublicVideo]).featured).toEqual(
      [],
    );
  });
});
