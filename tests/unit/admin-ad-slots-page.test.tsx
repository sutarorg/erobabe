import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/ads/inventory", () => ({
  loadInventory: async () =>
    [
      { id: 1, name: "Left Sidebar Top", side: "left", position: 1, price_cents: 9900, status: "available", description: "Premium left rail top placement, 16:9", available: true, ad: null },
      { id: 2, name: "Left Sidebar 2", side: "left", position: 2, price_cents: 9900, status: "available", description: "Left rail second placement, 16:9", available: true, ad: null },
      { id: 3, name: "Left Sidebar 3", side: "left", position: 3, price_cents: 9900, status: "available", description: "Left rail third placement, 16:9", available: true, ad: null },
      { id: 4, name: "Left Sidebar 4", side: "left", position: 4, price_cents: 9900, status: "available", description: "Left rail fourth placement, 16:9", available: true, ad: null },
      { id: 5, name: "Left Sidebar Bottom", side: "left", position: 5, price_cents: 9900, status: "available", description: "Left rail bottom placement, 16:9", available: true, ad: null },
      {
        id: 6,
        name: "Right Sidebar Top",
        side: "right",
        position: 1,
        price_cents: 9900,
        status: "available",
        description: "Premium right rail top placement, 16:9",
        available: false,
        ad: {
          image_url: "https://cdn.example.com/live.png",
          ad_name: "Summer launch",
          destination_url: "https://example.com/offer",
          ends_at: "2026-11-27T00:00:00.000Z",
          source: "order",
          live: true,
        },
      },
      { id: 7, name: "Right Sidebar 2", side: "right", position: 2, price_cents: 9900, status: "available", description: "Right rail second placement, 16:9", available: true, ad: null },
      { id: 8, name: "Right Sidebar 3", side: "right", position: 3, price_cents: 9900, status: "available", description: "Right rail third placement, 16:9", available: true, ad: null },
      { id: 9, name: "Right Sidebar 4", side: "right", position: 4, price_cents: 9900, status: "available", description: "Right rail fourth placement, 16:9", available: true, ad: null },
      { id: 10, name: "Right Sidebar Bottom", side: "right", position: 5, price_cents: 9900, status: "available", description: "Right rail bottom placement, 16:9", available: true, ad: null },
    ],
  slotBoardRows: (rows: any[]) =>
    rows.map((row) => ({
      ...row,
      taken: !row.available,
      label: row.available ? "Available" : "Taken",
    })),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AdSlotsAdmin from "@/app/admin/(dashboard)/ad-slots/page";

afterEach(cleanup);

async function renderPage() {
  render(await AdSlotsAdmin());
  return screen;
}

describe("admin ad slots board", () => {
  it("shows the ten placements as the homepage rails with no status pills", async () => {
    await renderPage();
    expect(screen.getAllByRole("article")).toHaveLength(10);
    // The Available / Taken pills are gone from the cards.
    expect(screen.queryByText("Available")).toBeNull();
    expect(screen.queryByText("Taken")).toBeNull();
    expect(screen.getByLabelText("Slot 6 — Taken")).toBeTruthy();
  });

  it("drops the inventory summary card", async () => {
    const { container } = render(await AdSlotsAdmin());
    expect(container.querySelector('[aria-label="Inventory summary"]')).toBeNull();
    expect(screen.queryByText("Inventory summary")).toBeNull();
    // Five placement cards per rail, exactly like the homepage.
    const rails = container.querySelectorAll("section");
    expect(rails).toHaveLength(2);
    expect(rails[0]?.querySelectorAll("article")).toHaveLength(5);
    expect(rails[1]?.querySelectorAll("article")).toHaveLength(5);
  });

  it("never prints the seeded placement description text", async () => {
    await renderPage();
    expect(screen.queryByText(/Premium left rail top placement/i)).toBeNull();
    expect(screen.queryByText(/Right rail bottom placement/i)).toBeNull();
    expect(screen.queryByText(/16:9$/)).toBeNull();
    // The card footer names the placement instead.
    expect(screen.getAllByText("Left Sidebar Top", { exact: false }).length).toBeGreaterThan(0);
  });

  it("still shows the running creative for a sold placement", async () => {
    await renderPage();
    expect(screen.getByAltText("Summer launch")).toHaveAttribute(
      "src",
      "https://cdn.example.com/live.png",
    );
    // Sold cards keep their figures, open cards keep their price.
    expect(screen.getAllByText("$99.00").length).toBeGreaterThan(0);
  });
});
