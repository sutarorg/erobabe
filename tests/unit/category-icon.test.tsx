import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CategoryIcon from "@/src/components/CategoryIcon";

describe("<CategoryIcon />", () => {
  it("renders an svg for an icon name from the database", () => {
    const html = renderToStaticMarkup(<CategoryIcon icon="camera" className="h-4 w-4" />);
    expect(html).toContain("<svg");
    expect(html).toContain("lucide-camera");
    expect(html).toContain("h-4 w-4");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders a distinct glyph per seeded category", () => {
    const seeded = ["flame", "camera", "eye", "users", "mask", "wine", "heart", "sparkles", "user", "drama", "flower"];
    const glyphs = new Set(
      seeded.map((name) => renderToStaticMarkup(<CategoryIcon icon={name} />).replace(/class="[^"]*"/g, ""))
    );
    // 11 distinct icon names must not collapse into one fallback glyph.
    expect(glyphs.size).toBe(seeded.length);
  });

  it("falls back to a slug-based icon when the column is empty", () => {
    expect(renderToStaticMarkup(<CategoryIcon icon={null} fallbackKey="solo" />)).toContain("<svg");
    expect(renderToStaticMarkup(<CategoryIcon icon={null} fallbackKey="solo" />)).not.toBe(
      renderToStaticMarkup(<CategoryIcon icon={null} fallbackKey="mature" />)
    );
  });
});
