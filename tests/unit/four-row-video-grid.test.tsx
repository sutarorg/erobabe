import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import FourRowVideoGrid from "@/src/components/FourRowVideoGrid";
import { GRID_ROWS, MAX_GRID_COLUMNS, gridItemCount, gridStyle } from "@/src/hooks/useGridColumns";

let width = 0;
let onResize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  width = 1000;
  disconnect.mockReset();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function cards(count = 20) {
  return Array.from({ length: count }, (_, index) => <a href={`/video/clip-${index}`} key={index}>Clip {index}</a>);
}

describe("four-row video sections", () => {
  it.each([
    [350, 2, 8],
    [600, 3, 12],
    [800, 4, 16],
    [1600, 4, 16],
  ])("keeps four rows at a %ipx container width", (containerWidth, columns, count) => {
    width = containerWidth;
    const { container } = render(<FourRowVideoGrid>{cards()}</FourRowVideoGrid>);
    const grid = container.querySelector(".video-grid")!;
    expect(grid).toHaveAttribute("data-grid-rows", "4");
    expect(grid).toHaveStyle({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` });
    expect(screen.getAllByRole("link")).toHaveLength(count);
    expect(count / columns).toBe(GRID_ROWS);
  });

  it("trims the card count on resize instead of spilling into a fifth row", () => {
    const { container, unmount } = render(<FourRowVideoGrid>{cards()}</FourRowVideoGrid>);
    expect(screen.getAllByRole("link")).toHaveLength(16);
    act(() => { width = 600; onResize(); });
    expect(screen.getAllByRole("link")).toHaveLength(12);
    act(() => { width = 350; onResize(); });
    expect(screen.getAllByRole("link")).toHaveLength(8);
    act(() => { width = 1600; onResize(); });
    expect(screen.getAllByRole("link")).toHaveLength(16);
    expect(container.querySelector(".video-grid")).toHaveStyle({ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" });
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("uses a single row on mobile, including after a container resize", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    width = 350;
    const { container } = render(<FourRowVideoGrid>{cards()}</FourRowVideoGrid>);
    expect(container.querySelector(".video-grid")).toHaveAttribute("data-grid-rows", "1");
    // One row of two columns on a phone.
    expect(screen.getAllByRole("link")).toHaveLength(2);

    act(() => { width = 600; onResize(); });
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(container.querySelector(".video-grid")).toHaveAttribute("data-grid-rows", "1");
  });

  it("does not duplicate cards when fewer videos are available", () => {
    render(<FourRowVideoGrid>{cards(3)}</FourRowVideoGrid>);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("has no five-column mode, even if a caller supplies five", () => {
    expect(MAX_GRID_COLUMNS).toBe(4);
    expect(gridItemCount(5)).toBe(16);
    expect(gridStyle(5).gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });
});
