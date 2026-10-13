import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "@/src/components/Hero";
import { HERO_SLIDES } from "@/src/data/content";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("Hero carousel", () => {
  it("shows the admin-chosen videos with a Watch now link", () => {
    render(
      <Hero
        slides={[
          {
            id: "evening-in-velvet",
            eyebrow: "Boudoir",
            headline: "Evening in Velvet",
            sub: "A slow portrait.",
            image: "https://cdn.example.com/thumb.jpg",
            alt: "Evening in Velvet",
            href: "/video/evening-in-velvet",
          },
        ]}
      />
    );
    expect(screen.getByText("Evening in Velvet", { selector: "h1" })).toBeTruthy();
    const link = screen.getByText("Watch now").closest("a");
    expect(link?.getAttribute("href")).toBe("/video/evening-in-velvet");
  });

  it("falls back to the default artwork when no slides are chosen", () => {
    render(<Hero slides={[]} />);
    expect(screen.getByText(HERO_SLIDES[0].eyebrow)).toBeTruthy();
    expect(screen.queryByText("Watch now")).toBeNull();
  });
});
