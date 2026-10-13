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
  it("shows all eight category cards in one horizontal row without horizontal scrolling", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const grid = container.querySelector(".category-grid");
    expect(grid).toBeTruthy();
    expect(grid?.className).toMatch(/\bgrid\b/);
    // Eight columns for eight cards (seven featured + More) — a single row.
    expect(grid?.className).toContain("grid-cols-8");
    expect(grid?.className).not.toMatch(/grid-cols-[1-7]\b|grid-cols-9|grid-cols-10|grid-cols-11|grid-cols-12/);
    expect(grid?.className).not.toMatch(/overflow-x-auto|snap-x/);
    expect(grid?.children).toHaveLength(8);

    const links = within(grid as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links.slice(0, 7).map((link) => link.textContent?.trim())).toEqual([
      "Mature",
      "Amateur",
      "POV",
      "Lesbian",
      "Kinky",
      "Mature 18+",
      "Couples",
    ]);
    expect(links[6].getAttribute("href")).toBe("/category/couples");
    expect(links[7].textContent?.trim()).toBe("More");
    expect(links[7].getAttribute("href")).toBe("/categories");
  });

  it("swaps the icon for the admin-uploaded thumbnail on cards that have one", () => {
    const withImage = DATABASE_CATEGORIES.map((category) =>
      category.slug === "mature" ? { ...category, image: "https://cdn.example.com/categories/mature.jpg" } : category
    );
    const { container } = render(<Categories categories={withImage} />);
    const grid = container.querySelector(".category-grid") as HTMLElement;

    const images = grid.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("https://cdn.example.com/categories/mature.jpg");
    // The remaining cards keep their Lucide icons.
    expect(grid.querySelectorAll("svg").length).toBeGreaterThanOrEqual(7);
    // Geometry is unchanged: the image occupies the icon's box.
    expect(images[0].className).toMatch(/h-4 w-4|h-5 w-5/);
  });

  it("lets each card shrink to its grid track instead of forcing overflow", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const grid = container.querySelector(".category-grid") as HTMLElement;

    const cards = within(grid).getAllByRole("link");
    for (const card of cards) {
      expect(card.className).toMatch(/\bmin-w-0\b/);
      expect(card.className).not.toMatch(/min-w-\[132px\]/);
    }
  });
});
