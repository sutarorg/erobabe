import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ThumbImage from "@/src/components/ThumbImage";

/**
 * A card whose thumbnail cannot load must still render as a card — a blank box
 * is what "the thumbnails are not visible" looks like in production.
 */
const FALLBACK = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

describe("ThumbImage", () => {
  it("renders the given thumbnail", () => {
    render(<ThumbImage src="https://cdn.example.com/thumb.jpg" alt="Clip" />);
    const image = screen.getByAltText("Clip") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://cdn.example.com/thumb.jpg");
    expect(image.dataset.thumbFallback).toBeUndefined();
  });

  it("falls back to the erobabe mark when the image fails to load", () => {
    render(<ThumbImage src="https://cdn.example.com/gone.jpg" alt="Clip" />);
    const image = screen.getByAltText("Clip") as HTMLImageElement;

    fireEvent.error(image);

    expect(image.getAttribute("src")).toBe(FALLBACK);
    expect(image.dataset.thumbFallback).toBe("true");
  });

  it("uses the fallback when there is no thumbnail at all", () => {
    render(<ThumbImage src={null} alt="Clip" />);
    expect((screen.getByAltText("Clip") as HTMLImageElement).getAttribute("src")).toBe(FALLBACK);
  });

  it("retries when a new thumbnail is attached", () => {
    const { rerender } = render(<ThumbImage src="https://cdn.example.com/gone.jpg" alt="Clip" />);
    fireEvent.error(screen.getByAltText("Clip"));
    expect((screen.getByAltText("Clip") as HTMLImageElement).getAttribute("src")).toBe(FALLBACK);

    rerender(<ThumbImage src="https://cdn.example.com/fresh.jpg" alt="Clip" />);
    expect((screen.getByAltText("Clip") as HTMLImageElement).getAttribute("src")).toBe(
      "https://cdn.example.com/fresh.jpg"
    );
  });
});
