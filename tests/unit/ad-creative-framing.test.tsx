import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdCreativeCard from "@/src/components/ads/AdCreativeCard";

const base = {
  id: "creative-1",
  image_url: "https://cdn.example.com/banner.png",
  destination_url: "https://example.com/offer",
  title: "Summer launch",
};

describe("creative framing on the placements", () => {
  it("crops an any-ratio picture the way checkout stored it", () => {
    const html = renderToStaticMarkup(
      <AdCreativeCard creative={{ ...base, focus: { x: 20, y: 80, zoom: 1.8 } }} slotId={3} />,
    );
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("object-position:20% 80%");
    expect(html).toContain("scale(1.8)");
    expect(html).toContain("transform-origin:20% 80%");
  });

  it("leaves an untouched banner centred and unzoomed", () => {
    const html = renderToStaticMarkup(
      <AdCreativeCard creative={{ ...base, focus: { x: 50, y: 50, zoom: 1 } }} slotId={4} />,
    );
    expect(html).toContain("object-position:50% 50%");
    expect(html).not.toContain("scale(");
  });

  it("falls back to a centred crop for a legacy creative with no framing", () => {
    const html = renderToStaticMarkup(<AdCreativeCard creative={base} slotId={5} />);
    expect(html).toContain("object-position:50% 50%");
  });
});
