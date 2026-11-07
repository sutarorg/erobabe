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

const filekosh = ["file", "kosh"].join("");
const bunny = ["bun", "ny"].join("");

describe("retired video providers have no active integration", () => {
  it("ships no adapter, endpoint or credential for the retired upload provider", () => {
    expect(existsSync(`app/api/videos/${filekosh}`)).toBe(false);
    expect(existsSync(`lib/video/${filekosh}.ts`)).toBe(false);
    // The provider name may only survive where stored rows are classified as
    // retired; nothing may fetch, upload or configure it.
    // `lib/video/playback.ts` deliberately keeps the retired provider names so
    // stored rows are classified as unsupported; that is the only allowed use
    // outside migrations and historical fixtures.
    for (const file of [
      ...sources("app"),
      ...sources("src/utils"),
      ...sources("src/components"),
      "lib/video/playback.ts",
    ]) {
      if (file === "lib/video/playback.ts") continue;
      expect(readFileSync(file, "utf8").toLowerCase(), file).not.toContain(filekosh);
    }
    const env = readFileSync(".env.example", "utf8").toLowerCase();
    expect(env).not.toContain(`${filekosh}_`);
    expect(env).not.toContain(`${filekosh.toUpperCase()}_`);
  });

  it("removes the whole Bunny Stream upload pipeline", () => {
    // No upload adapter, routes, cron sweep or admin upload page.
    expect(existsSync(`lib/video/${bunny}.ts`)).toBe(false);
    expect(existsSync(`lib/video/${bunny}-validation.ts`)).toBe(false);
    expect(existsSync("lib/video/auto-publish.ts")).toBe(false);
    expect(existsSync(`app/api/videos/${bunny}`)).toBe(false);
    expect(existsSync("app/api/videos/storage-token")).toBe(false);
    expect(existsSync("app/api/videos/status")).toBe(false);
    expect(existsSync(`app/api/cron/${bunny}-publish`)).toBe(false);
    expect(existsSync("app/admin/(dashboard)/videos/upload")).toBe(false);
    expect(existsSync(`src/utils/${bunny}Upload.ts`)).toBe(false);

    const env = readFileSync(".env.example", "utf8");
    expect(env).not.toMatch(/BUNNY_STREAM_API_KEY/);
    expect(env).not.toMatch(/BUNNY_STREAM_LIBRARY_ID/);
    // The Bunny publish sweep is gone; the only cron left in the env file is
    // the catalog importer, which the retirement assertions below cover.
    expect(env).not.toMatch(/bunny-publish/);

    // The admin dashboard no longer offers a file upload control.
    const manager = readFileSync(
      "app/admin/(dashboard)/videos/VideoManager.tsx",
      "utf8",
    );
    expect(manager).not.toContain("uploadWithProgress");
    expect(manager).not.toContain("/api/videos/storage-token");
  });

  it("imports from damplips and keeps no Pornhub integration anywhere", () => {
    // The retired upload provider's tables stay dropped.
    const retired = readFileSync(
      "supabase/migrations/00000000000026_damplips_embeds.sql",
      "utf8",
    );
    expect(retired).toContain("drop table if exists public.bunny_uploads");
    expect(retired).toContain("drop table if exists public.upload_jobs");

    // damplips is the source again: importer, panel, routes, cron and workflow
    // all exist, and the catalog migration makes damplips the default provider.
    for (const source of [
      "lib/damplips/importer.ts",
      "lib/damplips/categories.ts",
      "lib/damplips/client.ts",
      "lib/damplips/parse.ts",
      "app/api/admin/damplips/import/route.ts",
      "app/api/cron/damplips-import/route.ts",
      "app/admin/(dashboard)/videos/DamplipsImportPanel.tsx",
      ".github/workflows/damplips-nightly-import.yml",
    ]) {
      expect(existsSync(source), source).toBe(true);
    }
    const current = readFileSync(
      "supabase/migrations/00000000000030_damplips_catalog.sql",
      "utf8",
    );
    expect(current).toContain("set default 'damplips'");

    // Nothing of the Pornhub round survives: no code, routes, migration,
    // workflow or environment variable mentions the host.
    const host = ["porn", "hub"].join("");
    expect(existsSync(`lib/${host}`)).toBe(false);
    expect(existsSync(`app/api/admin/${host}`)).toBe(false);
    expect(existsSync(`app/api/cron/${host}-import`)).toBe(false);
    expect(existsSync(`.github/workflows/${host}-nightly-import.yml`)).toBe(false);
    expect(existsSync(`docs/${host.toUpperCase()}_EMBEDS.md`)).toBe(false);

    const scanned = [
      ...sources("app"),
      ...sources("lib"),
      ...sources("src"),
      ...sources("scripts"),
      ".env.example",
      "next.config.mjs",
    ];
    for (const file of scanned) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").toLowerCase();
      expect(text, file).not.toContain(host);
      expect(text, file).not.toContain("phncdn");
    }
  });
});
