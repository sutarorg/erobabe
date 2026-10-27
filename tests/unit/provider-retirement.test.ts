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
    expect(env).not.toMatch(/CRON_SECRET/);

    // The admin dashboard no longer offers a file upload control.
    const manager = readFileSync(
      "app/admin/(dashboard)/videos/VideoManager.tsx",
      "utf8",
    );
    expect(manager).not.toContain("uploadWithProgress");
    expect(manager).not.toContain("/api/videos/storage-token");
  });

  it("only ever embeds damplips for new catalog rows", () => {
    const migration = readFileSync(
      "supabase/migrations/00000000000026_damplips_embeds.sql",
      "utf8",
    );
    expect(migration).toContain("alter table public.videos alter column provider set default 'damplips'");
    expect(migration).toContain("drop table if exists public.bunny_uploads");
    expect(migration).toContain("drop table if exists public.upload_jobs");
  });
});
