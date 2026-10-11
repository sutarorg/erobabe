import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const BrowserClient = (await import("@/app/(public)/browser/BrowserClient")).default;

const videos = [
  {
    id: "clip",
    slug: "clip",
    title: "Night Drive",
    description: null,
    thumbnail_url: "https://example.com/t.jpg",
    duration_seconds: 90,
    view_count: 12,
    published_at: "2026-01-01T00:00:00.000Z",
    quality: "HD",
    category_label: "Mature",
    category_slug: "mature",
  },
  {
    id: "other",
    slug: "other",
    title: "Studio Session",
    description: null,
    thumbnail_url: null,
    duration_seconds: 60,
    view_count: 3,
    published_at: null,
    quality: "HD",
    category_label: "Amateur",
    category_slug: "amateur",
  },
];

const categories = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera" },
];

describe("/browser page", () => {
  it("lists videos and filters by category without a round trip", () => {
    render(<BrowserClient videos={videos} categories={categories} />);
    expect(screen.getByText("All videos")).toBeTruthy();
    expect(screen.getByText("Night Drive")).toBeTruthy();
    expect(screen.getByText("Studio Session")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mature" }));
    expect(screen.getByText("Night Drive")).toBeTruthy();
    expect(screen.queryByText("Studio Session")).toBeNull();
  });
});
