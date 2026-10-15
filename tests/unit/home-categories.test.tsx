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
  it("shows 6 category cards on mobile with More as the last card, and 8 on desktop without horizontal scrolling", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const grid = container.querySelector(".category-grid");
    expect(grid).toBeTruthy();
    expect(grid?.className).toMatch(/\bgrid\b/);
    // Six columns on mobile (five featured + More) and eight columns on desktop.
    expect(grid?.className).toContain("grid-cols-6");
    expect(grid?.className).toContain("sm:grid-cols-8");
    expect(grid?.className).not.toMatch(/overflow-x-auto|snap-x/);
    expect(grid?.children).toHaveLength(8);

    const links = within(grid as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(8);
    const mobileVisibleLinks = links.filter((link) => !link.className.includes("hidden"));
    expect(mobileVisibleLinks).toHaveLength(6);
    expect(mobileVisibleLinks.map((link) => link.textContent?.trim())).toEqual([
      "Mature",
      "Amateur",
      "POV",
      "Lesbian",
      "Kinky",
      "More",
    ]);
    expect(mobileVisibleLinks[5].textContent?.trim()).toBe("More");
    expect(mobileVisibleLinks[5].getAttribute("href")).toBe("/categories");
    expect(links[7].textContent?.trim()).toBe("More");
    expect(links[7].getAttribute("href")).toBe("/categories");
  });

  it("keeps icons and hides admin-uploaded thumbnails", () => {
    const withImage = DATABASE_CATEGORIES.map((category) =>
      category.slug === "mature" ? { ...category, image: "https://cdn.example.com/categories/mature.jpg" } : category
    );
    const { container } = render(<Categories categories={withImage} />);
    const grid = container.querySelector(".category-grid") as HTMLElement;

    const images = grid.querySelectorAll("img");
    expect(images).toHaveLength(0);
    expect(grid.querySelectorAll("svg")).toHaveLength(8);
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
