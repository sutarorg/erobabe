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

  it("uses taller mobile height, hides next/previous buttons on mobile, and changes slide on horizontal swipe", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Hero slides={[]} />);
    const carousel = screen.getByRole("region", { name: "Featured highlights" });
    expect(carousel.className).toContain("h-[320px]");

    const prevButton = screen.getByRole("button", { name: "Previous slide" });
    const nextButton = screen.getByRole("button", { name: "Next slide" });
    expect(prevButton.parentElement?.className).toContain("hidden");
    expect(prevButton.parentElement?.className).toContain("sm:flex");
    expect(nextButton.parentElement?.className).toContain("hidden");

    const slideDivs = Array.from(carousel.children).filter(
      (el) => el.tagName === "DIV" && el.hasAttribute("aria-hidden"),
    );
    expect(slideDivs[0].getAttribute("aria-hidden")).toBe("false");

    // Swipe left -> next slide
    fireEvent.touchStart(carousel, {
      touches: [{ clientX: 250, clientY: 120 }],
    });
    fireEvent.touchEnd(carousel, {
      changedTouches: [{ clientX: 120, clientY: 122 }],
    });
    expect(slideDivs[1].getAttribute("aria-hidden")).toBe("false");

    // Swipe right -> previous slide
    fireEvent.touchStart(carousel, {
      touches: [{ clientX: 120, clientY: 120 }],
    });
    fireEvent.touchEnd(carousel, {
      changedTouches: [{ clientX: 250, clientY: 122 }],
    });
    expect(slideDivs[0].getAttribute("aria-hidden")).toBe("false");
  });
});
