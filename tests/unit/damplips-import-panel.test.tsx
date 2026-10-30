import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/videos",
}));

import DamplipsImportPanel from "@/app/admin/(dashboard)/videos/DamplipsImportPanel";

afterEach(cleanup);

const counts = [
  // 60 visitors can watch; the other 60 are still waiting for review.
  { id: "1", slug: "amateur", label: "Amateur", published: 60, total: 120 },
  // Everything published.
  { id: "2", slug: "pov", label: "POV", published: 40, total: 40 },
  // Nothing yet.
  { id: "3", slug: "mature", label: "Mature", published: 0, total: 0 },
];

function row(label: string) {
  return screen.getByText(label).closest("label") as HTMLElement;
}

describe("Sync from damplips counts", () => {
  it("shows the number of videos a visitor can watch in each category", () => {
    render(<DamplipsImportPanel counts={counts} />);
    expect(within(row("Amateur")).getByText("60")).toBeTruthy();
    expect(within(row("POV")).getByText("40")).toBeTruthy();
    expect(within(row("Mature")).getByText("0")).toBeTruthy();
  });

  it("discloses a review backlog beside the published number", () => {
    render(<DamplipsImportPanel counts={counts} />);
    expect(within(row("Amateur")).getByText("120 total")).toBeTruthy();
    // Nothing to disclose when every row is live.
    expect(within(row("POV")).queryByText(/total/)).toBeNull();
  });

  it("colours the published count against the target", () => {
    render(<DamplipsImportPanel counts={counts} />);
    // 40 published but the panel asks for 110 → still short.
    expect(within(row("POV")).getByText("40").className).toContain("text-amber-300");
    expect(within(row("Mature")).getByText("0").className).toContain("text-amber-300");
  });

  it("explains both numbers on hover", () => {
    render(<DamplipsImportPanel counts={counts} />);
    const badge = within(row("Amateur")).getByTitle(/60 published videos in Amateur/);
    expect(badge.getAttribute("title")).toContain("120 rows in the catalog");
    // 120 rows already clears the 110 target, so a sync cannot top this up —
    // say why rather than leaving the amber number unexplained.
    expect(badge.getAttribute("title")).toContain(
      "60 not published yet, so a sync adds only new posts",
    );
  });

  it("does not claim a backlog is blocking a category that has none", () => {
    render(<DamplipsImportPanel counts={counts} />);
    const badge = within(row("POV")).getByTitle(/40 published videos in POV/);
    expect(badge.getAttribute("title")).not.toContain("not published yet");
  });

  it("totals published videos and names the catalog rows behind them", () => {
    render(<DamplipsImportPanel counts={counts} />);
    const text = document.body.textContent || "";
    expect(text).toContain("100 published videos across these categories, out of 160 rows in the catalog");
    // The default target is 110, so all three categories are short.
    expect(text).toContain("3 categories have fewer than 110 published videos");
  });

  it("says nothing is missing when every category publishes enough", () => {
    render(
      <DamplipsImportPanel
        counts={[
          { id: "1", slug: "pov", label: "POV", published: 400, total: 400 },
          { id: "2", slug: "mature", label: "Mature", published: 300, total: 340 },
        ]}
      />,
    );
    expect(document.body.textContent).toContain(
      "Every selected category already publishes at least the number you are asking for",
    );
  });

  it("keeps the missing-migration hint when counts could not be read", () => {
    render(<DamplipsImportPanel counts={[]} />);
    expect(screen.getByText(/00000000000026_damplips_embeds\.sql/)).toBeTruthy();
  });
});
