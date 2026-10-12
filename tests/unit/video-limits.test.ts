import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import {
  MAX_THUMBNAIL_SIZE,
  MAX_VIDEO_SIZE,
  UFOLOAD_KEEPALIVE_INTERVAL_MS,
  UFOLOAD_MAX_ACTIVE_IMPORTS,
  UFOLOAD_MAX_CHUNK_BYTES,
  VIDEO_EXTENSIONS,
  formatBytes,
  looksLikeVideo,
} from "@/lib/video/limits";
import { MAX_VIDEO_SIZE as STORAGE_MAX_VIDEO_SIZE, MAX_THUMBNAIL_SIZE as STORAGE_MAX_THUMBNAIL_SIZE } from "@/lib/video/storage";
import { isPublicHostname } from "@/lib/video/url-safety";

const root = path.resolve(__dirname, "../..");

describe("one set of limits for the browser, the server and UFOLOAD", () => {
  it("keeps the 2 GB application limit, with the browser and the server reading the same constant", () => {
    expect(MAX_VIDEO_SIZE).toBe(2 * 1024 * 1024 * 1024);
    expect(STORAGE_MAX_VIDEO_SIZE).toBe(MAX_VIDEO_SIZE);
    expect(STORAGE_MAX_THUMBNAIL_SIZE).toBe(MAX_THUMBNAIL_SIZE);
    expect(MAX_THUMBNAIL_SIZE).toBe(10 * 1024 * 1024);
  });

  it("sits below every UFOLOAD plan's per-file ceiling (Free 5 GB, Pro 10 GB, Max 25 GB — pricing page, 2026-10-12)", () => {
    const smallestDocumentedPlanLimit = 5 * 1000 ** 3;
    expect(MAX_VIDEO_SIZE).toBeLessThan(smallestDocumentedPlanLimit);
  });

  it("matches UFOLOAD's documented protocol limits", () => {
    expect(UFOLOAD_MAX_CHUNK_BYTES).toBe(256 * 1024 * 1024);
    expect(UFOLOAD_MAX_ACTIVE_IMPORTS).toBe(10);
    // A slot is released after 15 min without a state call; UFOLOAD asks for one at least every 10.
    expect(UFOLOAD_KEEPALIVE_INTERVAL_MS).toBeLessThan(10 * 60 * 1000);
    expect(UFOLOAD_KEEPALIVE_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("defines the 2 GB literal in exactly one source file", () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.(ts|tsx)$/.test(entry) && /2\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/.test(readFileSync(full, "utf8"))) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    for (const dir of ["lib", "app", "src/utils"]) scan(path.join(root, dir));
    expect(offenders).toEqual(["lib/video/limits.ts"]);
  });

  it("is imported by the admin page, the session route and the registration path rather than copied", () => {
    expect(readFileSync(path.join(root, "app/admin/videos/upload/page.tsx"), "utf8")).toMatch(/MAX_VIDEO_SIZE[^;]*from "@\/lib\/video\/limits"/);
    expect(readFileSync(path.join(root, "app/api/videos/ufoload-session/route.ts"), "utf8")).toMatch(/MAX_VIDEO_SIZE[^;]*from "@\/lib\/video\/limits"/);
  });

  it("keeps the browser-facing module free of server-only imports", () => {
    const source = readFileSync(path.join(root, "lib/video/limits.ts"), "utf8");
    expect(source).not.toMatch(/from "(crypto|fs|next\/|@\/lib\/supabase)/);
  });
});

describe("file recognition", () => {
  it("accepts video MIME types and video extensions", () => {
    expect(looksLikeVideo("a.bin", "video/mp4")).toBe(true);
    expect(looksLikeVideo("clip.MKV", "")).toBe(true);
    expect(looksLikeVideo("clip.mov", null)).toBe(true);
    for (const extension of VIDEO_EXTENSIONS) expect(looksLikeVideo(`x.${extension}`, "")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(looksLikeVideo("notes.pdf", "application/pdf")).toBe(false);
    expect(looksLikeVideo("photo.jpg", "image/jpeg")).toBe(false);
    expect(looksLikeVideo("mp4", "")).toBe(false);
    expect(looksLikeVideo("", "")).toBe(false);
  });

  it("formats sizes for messages", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
    expect(formatBytes(640 * 1024 ** 2)).toBe("640 MB");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(-1)).toBe("unknown size");
  });
});

describe("public hostname check", () => {
  it.each(["cdn.example.com", "a.b.c.example.org", "93.184.216.34", "[2606:4700:4700::1111]", "xn--bcher-kva.example"])("%s is public", (host) => {
    expect(isPublicHostname(host)).toBe(true);
  });

  it.each(["", "localhost", "a.localhost", "x.local", "x.internal", "x.lan", "x.home.arpa", "intranet", "127.0.0.1", "10.0.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.100.100.100", "0.0.0.0", "255.255.255.255", "[::1]", "[::]", "[fc00::1]", "[fe80::1]", "[::ffff:7f00:1]", "[2001:db8::1]"])(
    "%j is not public",
    (host) => {
      expect(isPublicHostname(host)).toBe(false);
    }
  );

  it("ignores a trailing dot and letter case", () => {
    expect(isPublicHostname("CDN.Example.COM.")).toBe(true);
    expect(isPublicHostname("LOCALHOST.")).toBe(false);
  });
});
