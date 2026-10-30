import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";
import AdSeriesChart from "@/src/components/analytics/AdSeriesChart";

const BOX = { left: 0, top: 0, width: 640, height: 232 };
const DAYS = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
const points = DAYS.map((day, index) => ({
  bucket: `${day}T00:00:00.000Z`,
  pageviews: (index + 1) * 10,
  sessions: index + 1,
  visitors: index + 1,
  engagedSeconds: 0,
}));

function svgOf(name: RegExp) {
  return screen.getByRole("img", { name }) as unknown as SVGSVGElement;
}

/**
 * jsdom's PointerEvent does not carry coordinates, so dispatch a MouseEvent of
 * type `pointermove`: same handler, real clientX/clientY.
 */
function hover(svg: SVGSVGElement, clientX: number, clientY = 100) {
  act(() => {
    svg.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY, bubbles: true }));
  });
}

function tooltipText() {
  return (document.querySelector("[data-chart-tooltip]") as HTMLElement).textContent || "";
}

function tooltip() {
  return document.querySelector("[data-chart-tooltip]") as HTMLElement;
}

beforeEach(() => {
  // jsdom has no layout: give every element the box the chart would measure in
  // a 640 px-wide panel, so the drawing and the pointer share one coordinate
  // system — exactly what the real component does after measuring.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    right: BOX.width,
    bottom: BOX.height,
    x: 0,
    y: 0,
    toJSON: () => BOX,
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("traffic chart cursor", () => {
  it("selects the bucket under the pointer, not one beside it", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);

    // Geometry the component uses: width 640, pad.left 46, pad.right 16.
    const innerWidth = 640 - 46 - 16;
    const step = innerWidth / (points.length - 1);
    const at = (index: number) => 46 + index * step;

    for (const index of [0, 1, 2, 3]) {
      hover(svg, at(index));
      expect(tooltipText()).toContain(
        new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
          new Date(points[index].bucket),
        ),
      );
    }
  });

  it("picks the nearest bucket between two points", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);
    const step = (640 - 62) / 3;

    // 60 % of the way from bucket 1 to bucket 2 belongs to bucket 2.
    hover(svg, 46 + step + step * 0.6);
    const tooltip = document.querySelector("[data-chart-tooltip]") as HTMLElement;
    expect(tooltipText()).toContain("Oct 26");
    expect(tooltipText()).toContain("30");
  });

  it("anchors the tooltip at the cursor and flips it near the right edge", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);
    hover(svg, 46 + 20);
    const leftSide = parseFloat(tooltip().style.left);
    expect(leftSide).toBeGreaterThan(46);
    expect(leftSide).toBeLessThan(120);

    // The last bucket sits at the far right: the panel flips to its left.
    hover(svg, 640 - 16);
    const rightSide = parseFloat(tooltip().style.left);
    expect(rightSide).toBeLessThan(640 - 16);
    expect(rightSide + 156).toBeLessThanOrEqual(640);
  });

  it("shows the values of every visible series", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    hover(svgOf(/traffic over time/i), 46 + ((640 - 62) / 3) * 2);
    const text = tooltipText();
    expect(text).toContain("Pageviews");
    expect(text).toContain("Sessions");
    expect(text).toContain("30"); // pageviews for the third day
    expect(text).toContain("3"); // sessions for the third day
  });

  it("steps through buckets with the keyboard", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(tooltipText()).toContain("Oct 24");
    fireEvent.keyDown(svg, { key: "End" });
    expect(tooltipText()).toContain("Oct 27");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(tooltipText()).toContain("Oct 27");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(tooltipText()).toContain("Oct 26");
  });

  it("clears the readout when the pointer leaves", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);
    hover(svg, 200);
    expect(tooltip().style.opacity).toBe("1");
    fireEvent.pointerLeave(svg);
    expect(tooltip().style.opacity).toBe("0");
  });

  it("draws in the measured pixel space so the plot fills its box", () => {
    render(<TimeSeriesChart points={points} bucket="day" />);
    const svg = svgOf(/traffic over time/i);
    expect(svg.getAttribute("viewBox")).toBe("0 0 640 232");
    // Without letter-boxing the drawing width equals the container width.
    expect(svg.getAttribute("width")).toBe("640");
  });
});

describe("delivery chart cursor", () => {
  const delivery = [
    { bucket: "2026-10-24T00:00:00.000Z", impressions: 100, clicks: 1 },
    { bucket: "2026-10-25T00:00:00.000Z", impressions: 300, clicks: 2 },
  ];

  it("selects the column under the pointer", () => {
    render(<AdSeriesChart points={delivery} />);
    const svg = svgOf(/ad delivery/i);
    // width 640, pad.left 46, pad.right 44 → 550 inner, 275 per column.
    hover(svg, 500);
    expect(tooltipText()).toContain("Oct 25");

    hover(svg, 60);
    expect(tooltipText()).toContain("Oct 24");
  });

  it("keeps the readout inside the plot at the far right", () => {
    render(<AdSeriesChart points={delivery} />);
    const svg = svgOf(/ad delivery/i);
    hover(svg, 636);
    const left = parseFloat(tooltip().style.left);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(left + 152).toBeLessThanOrEqual(640);
  });

  it("labels both axes and keeps the clicks on their own scale", () => {
    render(<AdSeriesChart points={delivery} />);
    const svg = svgOf(/ad delivery/i);
    const texts = Array.from(svg.querySelectorAll("text")).map((node) => node.textContent);
    // Impressions ticks (left) and clicks ticks (right) both exist.
    expect(texts).toContain("100");
    expect(texts).toContain("200");
    expect(texts).toContain("300");
    expect(texts.filter((value) => value === "2").length).toBeGreaterThan(0);
  });

  it("fills the measured box instead of letter-boxing", () => {
    render(<AdSeriesChart points={delivery} />);
    const svg = svgOf(/ad delivery/i);
    expect(svg.getAttribute("viewBox")).toBe("0 0 640 208");
  });

  it("responds to the keyboard too", () => {
    render(<AdSeriesChart points={delivery} />);
    const svg = svgOf(/ad delivery/i);
    act(() => {
      fireEvent.keyDown(svg, { key: "ArrowRight" });
    });
    expect(tooltipText()).toContain("Oct 24");
  });
});
