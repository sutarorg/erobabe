// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

describe("guest PayPal billing replacement", () => {
  it("removes the advertiser portal and legacy crypto billing runtime", () => {
    expect(existsSync("app/advertiser")).toBe(false);
    expect(existsSync("app/api/advertiser")).toBe(false);
    expect(existsSync("app/api/nowpayments")).toBe(false);
    expect(existsSync("lib/nowpayments")).toBe(false);

    for (const file of [...sources("app"), ...sources("lib"), ...sources("src")]) {
      const source = readFileSync(file, "utf8").toLowerCase();
      expect(source, file).not.toContain("nowpayments");
      expect(source, file).not.toMatch(/["'`]\/advertiser(?:\/|["'`?])/);
    }
  });
});
