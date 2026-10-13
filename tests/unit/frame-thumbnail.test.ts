import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureFrameJpeg, ffmpegBinary, THUMBNAIL_FILTER } from "@/lib/video/frame-thumbnail";

/**
 * Real ffmpeg, real HTTP range requests: a short test clip is generated with
 * the bundled ffmpeg and served from a local server, the same way a remote
 * video host would serve it.
 */

let server: http.Server;
let baseUrl = "";
let clipBytes: Buffer;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "erobabe-test-"));
  const clip = path.join(dir, "clip.mp4");
  execFileSync(ffmpegBinary(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "mandelbrot=size=320x180:rate=25",
    "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip,
  ]);
  clipBytes = readFileSync(clip);

  server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/clip.mp4")) {
      res.writeHead(404).end();
      return;
    }
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : clipBytes.length - 1;
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${clipBytes.length}`,
        "Content-Length": end - start + 1,
      });
      res.end(clipBytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": clipBytes.length });
    res.end(clipBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("captureFrameJpeg", () => {
  it("captures a 1280x720 JPEG frame from a remote video", async () => {
    const jpeg = await captureFrameJpeg(`${baseUrl}/clip.mp4`);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpeg.length).toBeGreaterThan(2_000);
  }, 60_000);

  it("rejects non-http inputs before ffmpeg is started", async () => {
    await expect(captureFrameJpeg("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
  });

  it("fails with a readable reason when the link is not a video", async () => {
    await expect(captureFrameJpeg(`${baseUrl}/missing.mp4`)).rejects.toThrow();
  }, 60_000);

  it("uses a colour-grade filter chain (vibrancy, sharpening, vignette)", () => {
    expect(THUMBNAIL_FILTER).toContain("saturation=1.35");
    expect(THUMBNAIL_FILTER).toContain("thumbnail=24");
    expect(THUMBNAIL_FILTER).toContain("vignette");
  });
});
