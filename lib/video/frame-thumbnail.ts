import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { assertPublicHttpUrl, type ServiceClient } from "@/lib/video/publishing";
import { ensureStorageBuckets, THUMBNAIL_BUCKET } from "@/lib/video/storage";
import { selectThumbnailFrame } from "@/lib/video/thumbnail-quality";

/**
 * Samples actual frames from a remote video and chooses the clearest,
 * well-exposed, colourful candidate rather than a statistically average frame.
 * The selected image receives a restrained saturation, contrast, sharpening,
 * and vignette pass and is saved as a 1280×720 JPEG. No scene is invented.
 *
 * ffmpeg fetches media bytes over HTTP(S), using range requests when the host
 * supports them. Temporary samples are removed after every attempt. It runs
 * with an argument array (never a shell), with only HTTP(S) input protocols.
 */

const CAPTURE_TIMEOUT_MS = 45_000;
const ATTEMPT_TIMEOUT_MS = 15_000;
export const THUMBNAIL_SAMPLE_COUNT = 12;
const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 90;

/** Colour grade, applied to each full-size candidate. */
export const THUMBNAIL_FILTER =
  "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1," +
  "eq=saturation=1.35:contrast=1.12:brightness=0.03:gamma=1.04," +
  "unsharp=5:5:0.7:5:5:0.0,vignette=angle=PI/5";

// Keep a final frame even for clips shorter than the two-second sample interval.
const SAMPLE_FILTER = "fps=1/2:start_time=0:eof_action=pass";
const ANALYSIS_FILTER =
  `scale=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT}:force_original_aspect_ratio=increase,` +
  `crop=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT},format=rgb24`;

/** Skip an intro, support short clips, then try past a longer blank intro. */
const SEEK_SECONDS = [3, 0, 30];

export function ffmpegBinary(): string {
  const override = String(process.env.FFMPEG_PATH || "").trim();
  if (override) return override;
  // Resolved lazily so the bundler does not have to trace a native binary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const installer = require("@ffmpeg-installer/ffmpeg") as { path: string };
  return installer.path;
}

function runFfmpeg(args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinary(),
      args,
      { timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const tail = String(stderr || error.message || "").trim().split("\n").slice(-2).join(" ")
            .replace(/https?:\/\/\S+/g, "[video source]");
          reject(new Error(tail.slice(0, 300) || "ffmpeg failed"));
          return;
        }
        resolve();
      }
    );
  });
}

/** Captures the highest-scoring usable JPEG frame from `sourceUrl`. */
export async function captureFrameJpeg(sourceUrl: string): Promise<Buffer> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) video links can be captured");
  if (url.username || url.password) throw new Error("Video links cannot include credentials");

  const dir = await mkdtemp(path.join(tmpdir(), "erobabe-thumb-"));
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  try {
    let lastError: Error | null = null;
    for (const seek of SEEK_SECONDS) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      // Unique paths prevent a short/failed retry from reusing an earlier frame.
      const outputPattern = path.join(dir, `frame-${seek}-%02d.jpg`);
      const analysisPath = path.join(dir, `frames-${seek}.rgb`);
      try {
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error", "-nostdin",
          "-protocol_whitelist", "http,https,tcp,tls,crypto",
          "-rw_timeout", "8000000",
          "-threads", "2",
          "-ss", String(seek),
          "-i", url.toString(),
          "-filter_complex_threads", "1",
          "-filter_complex",
          `[0:v:0]${SAMPLE_FILTER},split=2[frames][metrics];` +
            `[frames]${THUMBNAIL_FILTER}[graded];[metrics]${ANALYSIS_FILTER}[analysis]`,
          "-map", "[graded]", "-an", "-t", "24", "-frames:v", String(THUMBNAIL_SAMPLE_COUNT),
          "-vsync", "0", "-threads", "1", "-q:v", "2", "-y", outputPattern,
          "-map", "[analysis]", "-an", "-t", "24", "-frames:v", String(THUMBNAIL_SAMPLE_COUNT),
          "-vsync", "0", "-threads", "1", "-f", "rawvideo", "-y", analysisPath,
        ], Math.min(ATTEMPT_TIMEOUT_MS, remaining));
        lastError = new Error("No usable frame was found in the video");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Frame capture failed");
        // A stalled source can still have yielded complete samples before the
        // process was stopped. Score those instead of throwing them away.
      }

      const previews = await readFile(analysisPath).catch(() => null);
      if (!previews) continue;
      let best = selectThumbnailFrame(previews, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      while (best !== null) {
        const output = path.join(dir, `frame-${seek}-${String(best + 1).padStart(2, "0")}.jpg`);
        const bytes = await readFile(output).catch(() => null);
        if (bytes && bytes.length > 2_000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
          return bytes;
        }
        // A timeout may interrupt a JPEG after its RGB preview was written.
        // Discard that candidate and try the next complete one from this pass.
        const frameBytes = ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3;
        previews.fill(0, best * frameBytes, (best + 1) * frameBytes);
        best = selectThumbnailFrame(previews, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      }
    }
    throw lastError || new Error("Frame capture timed out");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Stores a frame thumbnail owned by `userId` and returns its public URL.
 * Failure is reported to the admin so an inaccessible source is never silently
 * presented as having a generated thumbnail.
 */
export async function generateFrameThumbnail(
  service: ServiceClient,
  userId: string,
  sourceUrl: string
): Promise<string> {
  const jpeg = await captureFrameJpeg(assertPublicHttpUrl(sourceUrl, "Video source"));
  await ensureStorageBuckets(service);
  const storagePath = `${userId}/${randomUUID()}.jpg`;
  const bucket = service.storage.from(THUMBNAIL_BUCKET);
  const { error } = await bucket.upload(storagePath, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Could not store the generated thumbnail: ${error.message}`);
  const { data } = bucket.getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    await bucket.remove([storagePath]).catch(() => undefined);
    throw new Error("Generated thumbnail did not resolve to a public URL");
  }
  return data.publicUrl;
}
