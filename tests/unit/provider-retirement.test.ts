// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory()
      ? sources(name)
      : /\.(ts|tsx)$/.test(name)
        ? [name]
        : [];
  });
}
describe("retired provider has no active integration", () => {
  it("contains no retired provider endpoint, adapter, credential or option in runtime", () => {
    const retired = ["file", "kosh"].join("");
    for (const file of [
      ...sources("app"),
      ...sources("lib"),
      ...sources("src/utils"),
      ...sources("src/components"),
    ])
      expect(readFileSync(file, "utf8").toLowerCase(), file).not.toContain(
        retired,
      );
    expect(readFileSync(".env.example", "utf8").toLowerCase()).not.toContain(
      `${retired}_`,
    );
    expect(existsSync(`app/api/videos/${retired}`)).toBe(false);
    expect(existsSync(`lib/video/${retired}.ts`)).toBe(false);
  });
});
