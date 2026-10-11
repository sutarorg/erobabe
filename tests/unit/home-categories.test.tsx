import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import Categories from "@/src/components/Categories";

const DATABASE_CATEGORIES = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera" },
  { id: "3", label: "POV", slug: "pov", icon: "eye" },
  { id: "4", label: "Lesbian", slug: "lesbian", icon: "users" },
  { id: "5", label: "Kinky", slug: "kinky", icon: "mask" },
  { id: "6", label: "Mature 18+", slug: "mature-18plus", icon: "wine" },
  { id: "7", label: "Couples", slug: "couples", icon: "heart" },
  { id: "8", label: "Boudoir", slug: "boudoir", icon: "sparkles" },
  { id: "9", label: "Romantic", slug: "romantic", icon: "heart" },
  { id: "10", label: "Solo", slug: "solo", icon: "user" },
  { id: "11", label: "Roleplay", slug: "roleplay", icon: "drama" },
  { id: "12", label: "Massage", slug: "massage", icon: "flower" },
];

describe("homepage categories", () => {
  it("lays the seven cards out in one horizontal row ending with More", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const row = container.querySelector(".category-row");
    expect(row).toBeTruthy();
    expect(row?.className).toMatch(/\bflex\b/);
    // A single row: side-by-side flex items that scroll sideways when the
    // panel is narrow, never a stacked vertical column.
    expect(row?.className).toMatch(/flex-row|overflow-x-auto/);
    expect(row?.className).not.toMatch(/grid-cols-1/);

    const links = within(row as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links.slice(0, 6).map((link) => link.textContent?.trim())).toEqual([
      "Mature",
      "Amateur",
      "POV",
      "Lesbian",
      "Kinky",
      "Mature 18+",
    ]);
    expect(links[6].textContent?.trim()).toBe("More");
    expect(links[6].getAttribute("href")).toBe("/categories");
  });

  it("gives every card the same flexible width so the row stays even", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const row = container.querySelector(".category-row") as HTMLElement;

    const cards = within(row).getAllByRole("link");
    for (const card of cards) {
      expect(card.className).toMatch(/\bflex-1\b/);
      expect(card.className).toMatch(/min-w-\[132px\]/);
    }
  });
});
