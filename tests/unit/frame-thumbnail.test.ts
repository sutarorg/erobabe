import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureFrameJpeg, ffmpegBinary, THUMBNAIL_FILTER, THUMBNAIL_SAMPLE_COUNT } from "@/lib/video/frame-thumbnail";
import { thumbnailFrameScore } from "@/lib/video/thumbnail-quality";

/** Real ffmpeg and HTTP range requests, using only synthetic test footage. */
let server: http.Server;
let baseUrl = "";
let testDir = "";
const clips = new Map<string, Buffer>();

function createClip(name: string, inputArgs: string[], seconds: number) {
  const clip = path.join(testDir, name);
  execFileSync(ffmpegBinary(), [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputArgs,
    "-t", String(seconds), "-c:v", "libx264", "-threads", "1",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip,
  ]);
  clips.set(`/${name}`, readFileSync(clip));
}

/** Dimensions from the JPEG's start-of-frame marker, not its byte length. */
function jpegDimensions(jpeg: Buffer) {
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) throw new Error("Invalid JPEG marker");
    const marker = jpeg[offset + 1];
    offset += 2;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [jpeg.readUInt16BE(offset + 5), jpeg.readUInt16BE(offset + 3)];
    offset += jpeg.readUInt16BE(offset);
  }
  throw new Error("JPEG has no dimensions");
}

beforeAll(async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "erobabe-test-"));
  createClip("clip.mp4", ["-f", "lavfi", "-i", "mandelbrot=size=320x180:rate=25"], 8);
  createClip("short.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25"], 0.4);
  createClip("portrait.mp4", ["-f", "lavfi", "-i", "testsrc2=size=180x320:rate=25"], 2);
  createClip("blank.mp4", ["-f", "lavfi", "-i", "color=black:size=320x180:rate=25"], 5);
  createClip("intro.mp4", [
    "-f", "lavfi", "-i", "color=black:size=320x180:rate=25:duration=7",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3",
    "-filter_complex_threads", "1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[out]", "-map", "[out]",
  ], 10);

  server = http.createServer((req, res) => {
    const bytes = clips.get((req.url || "").split("?")[0]);
    if (!bytes) { res.writeHead(404).end(); return; }
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = Math.min(match?.[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
      if (start > end) { res.writeHead(416).end(); return; }
      res.writeHead(206, {
        "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1,
      });
      res.end(bytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": bytes.length });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

describe("captureFrameJpeg", () => {
  it.each(["clip.mp4", "short.mp4", "portrait.mp4"])("captures a complete 1280x720 JPEG from %s", async (source) => {
    const jpeg = await captureFrameJpeg(`${baseUrl}/${source}`);
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(jpegDimensions(jpeg)).toEqual([1280, 720]);
    expect(jpeg.length).toBeGreaterThan(2_000);
  }, 60_000);

  it("selects a visible frame after a black intro", async () => {
    const jpeg = await captureFrameJpeg(`${baseUrl}/intro.mp4`);
    const pixels = execFileSync(ffmpegBinary(), [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale=160:90",
      "-frames:v", "1", "-threads", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { input: jpeg });
    expect(thumbnailFrameScore(pixels, 160, 90)).toBeGreaterThan(-Infinity);
  }, 60_000);

  it("reports an all-black clip as unusable rather than publishing a blank thumbnail", async () => {
    await expect(captureFrameJpeg(`${baseUrl}/blank.mp4`)).rejects.toThrow(/No usable frame/);
  }, 60_000);

  it("rejects non-http inputs and credentials before ffmpeg is started", async () => {
    await expect(captureFrameJpeg("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
    await expect(captureFrameJpeg("https://user:password@example.com/clip.mp4")).rejects.toThrow(/credentials/);
  });

  it("fails with a readable reason when the link is not a video", async () => {
    await expect(captureFrameJpeg(`${baseUrl}/missing.mp4`)).rejects.toThrow();
  }, 60_000);

  it("uses bounded sampling and a restrained vibrancy and sharpening pass", () => {
    expect(THUMBNAIL_SAMPLE_COUNT).toBe(12);
    expect(THUMBNAIL_FILTER).toContain("saturation=1.12");
    expect(THUMBNAIL_FILTER).toContain("unsharp");
    expect(THUMBNAIL_FILTER).toContain("contrast=1.08");
  });
});
