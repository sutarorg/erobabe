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
  it("shows seven rows in one column and ends with More", () => {
    const { container } = render(<Categories categories={DATABASE_CATEGORIES} />);
    const grid = container.querySelector(".grid-cols-1");
    expect(grid).toBeTruthy();

    const links = within(grid as HTMLElement).getAllByRole("link");
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
});
