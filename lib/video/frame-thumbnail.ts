import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { ServiceClient } from "@/lib/video/publishing";
import { ensureStorageBuckets, THUMBNAIL_BUCKET } from "@/lib/video/storage";

/**
 * Generates a thumbnail from a frame of a remote video.
 *
 * ffmpeg reads the link over HTTP(S) (range requests, so only the needed bytes
 * are fetched), skips the first seconds (usually black or a logo), keeps the
 * most representative of several sampled frames, and applies a vibrancy pass:
 * saturation, contrast, a little sharpening, and a soft vignette. The result is
 * a 1280×720 JPEG stored in the public thumbnail bucket.
 *
 * Runs ffmpeg with an argument array (never through a shell) and only accepts
 * http(s) inputs, so a crafted link cannot reach local files.
 */

const FFMPEG_TIMEOUT_MS = 45_000;

/** Frame-selection and colour grade. Kept separate so it is easy to tune. */
export const THUMBNAIL_FILTER =
  "fps=1/2,thumbnail=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720," +
  "eq=saturation=1.35:contrast=1.12:brightness=0.03:gamma=1.04," +
  "unsharp=5:5:0.7:5:5:0.0,vignette=angle=PI/5";

/** Seek offsets tried in order: skip an intro, then fall back to the very start. */
const SEEK_SECONDS = [3, 0];

export function ffmpegBinary(): string {
  const override = String(process.env.FFMPEG_PATH || "").trim();
  if (override) return override;
  // Resolved lazily so the bundler does not have to trace a native binary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const installer = require("@ffmpeg-installer/ffmpeg") as { path: string };
  return installer.path;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinary(),
      args,
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const tail = String(stderr || error.message || "").trim().split("\n").slice(-2).join(" ");
          reject(new Error(tail.slice(0, 300) || "ffmpeg failed"));
          return;
        }
        resolve();
      }
    );
  });
}

/** Captures one vibrant JPEG frame from the video at `sourceUrl`. */
export async function captureFrameJpeg(sourceUrl: string): Promise<Buffer> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) video links can be captured");

  const dir = await mkdtemp(path.join(tmpdir(), "erobabe-thumb-"));
  const output = path.join(dir, "frame.jpg");
  try {
    let lastError: Error | null = null;
    for (const seek of SEEK_SECONDS) {
      try {
        await runFfmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "http,https,tcp,tls,crypto",
          "-ss",
          String(seek),
          "-i",
          url.toString(),
          "-an",
          "-t",
          "60",
          "-vf",
          THUMBNAIL_FILTER,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-y",
          output,
        ]);
        const bytes = await readFile(output).catch(() => null);
        if (bytes && bytes.length > 2_000) return bytes;
        lastError = new Error("No usable frame was found in the video");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Frame capture failed");
      }
    }
    throw lastError || new Error("Frame capture failed");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Captures a frame and stores it as a thumbnail owned by `userId`.
 * Returns the public URL. Throws with a readable reason on failure; callers
 * treat that as "no auto thumbnail" and publish anyway.
 */
export async function generateFrameThumbnail(
  service: ServiceClient,
  userId: string,
  sourceUrl: string
): Promise<string> {
  const jpeg = await captureFrameJpeg(sourceUrl);
  await ensureStorageBuckets(service);
  const storagePath = `${userId}/${randomUUID()}.jpg`;
  const bucket = service.storage.from(THUMBNAIL_BUCKET);
  const { error } = await bucket.upload(storagePath, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Could not store the generated thumbnail: ${error.message}`);
  const { data } = bucket.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error("Generated thumbnail did not resolve to a public URL");
  return data.publicUrl;
}
