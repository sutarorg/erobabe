/* ──────────────────────────────────────────────────────────────
 * Automatic video optimization.
 *
 * Every upload is analyzed, then re-encoded to the smallest practical
 * size that still looks and sounds excellent, tuned for progressive
 * web streaming out of Cloudflare R2.
 *
 * Pipeline: <video> → downscaled <canvas> (captureStream) + original
 * audio track → MediaRecorder with an explicitly chosen codec and
 * bitrate. Everything runs in the browser, so no server transcoder,
 * no extra infrastructure and no upload of the oversized original.
 *
 * The engine is deliberately conservative: if the source is already
 * efficient, or the environment can't re-encode safely, or the result
 * would be bigger, the original file is uploaded untouched.
 * ────────────────────────────────────────────────────────────── */

export interface VideoAnalysis {
  width: number;
  height: number;
  duration: number;
  size: number;
  /** Source bitrate in bits per second. */
  bitrate: number;
  fps: number;
}

export interface EncodePlan {
  compress: boolean;
  reason: string;
  targetWidth: number;
  targetHeight: number;
  videoBitrate: number;
  audioBitrate: number;
  mimeType: string;
  container: "mp4" | "webm";
  /** Estimated output size in bytes. */
  estimatedSize: number;
  /** Rough wall-clock estimate in seconds. */
  estimatedSeconds: number;
}

/** Quality ladder — bits per second per rung, tuned for web streaming. */
const LADDER: { maxHeight: number; bitrate: number }[] = [
  { maxHeight: 360, bitrate: 700_000 },
  { maxHeight: 480, bitrate: 1_200_000 },
  { maxHeight: 720, bitrate: 2_500_000 },
  { maxHeight: 1080, bitrate: 4_500_000 },
  { maxHeight: 1440, bitrate: 8_000_000 },
  { maxHeight: 2160, bitrate: 14_000_000 },
];

/** Never publish anything larger than this — 1080p is the sweet spot for web. */
const MAX_HEIGHT = 1080;
/** Re-encoding runs near real time; refuse absurdly long inputs. */
const MAX_DURATION_SECONDS = 45 * 60;
/** Only bother if we expect to save at least this share of the file. */
const MIN_SAVING = 0.12;

const AUDIO_BITRATE = 128_000;

/** Preferred containers/codecs, best first. MP4/H.264 streams everywhere. */
const CANDIDATE_TYPES: { mimeType: string; container: "mp4" | "webm" }[] = [
  { mimeType: "video/mp4;codecs=avc1.640029,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4", container: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", container: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", container: "webm" },
  { mimeType: "video/webm", container: "webm" },
];

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of CANDIDATE_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

export function compressionSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickMimeType() !== null
  );
}

/** Probe intrinsic dimensions, duration and average bitrate. */
export function analyzeVideo(file: File): Promise<VideoAnalysis | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (result: VideoAnalysis | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => done(null), 12_000);
    v.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      const width = v.videoWidth || 0;
      const height = v.videoHeight || 0;
      if (!duration || !width || !height) return done(null);
      done({
        width,
        height,
        duration,
        size: file.size,
        bitrate: (file.size * 8) / duration,
        fps: 30,
      });
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

const evenly = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Decide the optimal encode settings for one analyzed file. */
export function planEncode(a: VideoAnalysis): EncodePlan {
  const chosen = pickMimeType();
  const base: EncodePlan = {
    compress: false,
    reason: "",
    targetWidth: a.width,
    targetHeight: a.height,
    videoBitrate: 0,
    audioBitrate: AUDIO_BITRATE,
    mimeType: chosen?.mimeType ?? "",
    container: chosen?.container ?? "mp4",
    estimatedSize: a.size,
    estimatedSeconds: 0,
  };

  if (!chosen) return { ...base, reason: "This browser can't re-encode video — uploading the original." };
  if (a.duration > MAX_DURATION_SECONDS) {
    return { ...base, reason: "Video is longer than 45 minutes — uploading the original." };
  }

  // Cap the resolution, preserving aspect ratio.
  const scale = a.height > MAX_HEIGHT ? MAX_HEIGHT / a.height : 1;
  const targetHeight = evenly(a.height * scale);
  const targetWidth = evenly(a.width * scale);

  // Target bitrate from the ladder rung matching the output height.
  const rung = LADDER.find((r) => targetHeight <= r.maxHeight) ?? LADDER[LADDER.length - 1];
  // VP9 is roughly 30% more efficient than H.264 at equal quality.
  const codecFactor = chosen.container === "webm" ? 0.72 : 1;
  let videoBitrate = Math.round(rung.bitrate * codecFactor);

  // Never spend more bits than the source actually carries.
  const sourceVideoBitrate = Math.max(a.bitrate - AUDIO_BITRATE, 120_000);
  videoBitrate = Math.min(videoBitrate, Math.round(sourceVideoBitrate * 0.95));

  const estimatedSize = ((videoBitrate + AUDIO_BITRATE) * a.duration) / 8;
  const saving = 1 - estimatedSize / a.size;

  if (scale === 1 && saving < MIN_SAVING) {
    return {
      ...base,
      reason: "Already well optimized — uploading the original.",
      estimatedSize: a.size,
    };
  }

  return {
    compress: true,
    reason:
      scale < 1
        ? `Scaling to ${targetHeight}p and re-encoding for fast streaming.`
        : "Re-encoding at a leaner bitrate for fast streaming.",
    targetWidth,
    targetHeight,
    videoBitrate,
    audioBitrate: AUDIO_BITRATE,
    mimeType: chosen.mimeType,
    container: chosen.container,
    estimatedSize,
    // Playback is sped up, so wall-clock is a fraction of the duration.
    estimatedSeconds: Math.ceil(a.duration / playbackRateFor(a.duration)),
  };
}

/** Longer videos are pushed harder; short ones stay near real time for accuracy. */
function playbackRateFor(duration: number) {
  if (duration > 900) return 4;
  if (duration > 300) return 3;
  if (duration > 60) return 2.5;
  return 2;
}

export class CompressionCancelled extends Error {
  constructor() {
    super("Compression cancelled");
    this.name = "CompressionCancelled";
  }
}

/**
 * Re-encode `file` according to `plan`.
 * Resolves with the optimized File, or the original when that is smaller.
 */
export function compressVideo(
  file: File,
  plan: EncodePlan,
  { onProgress, signal }: { onProgress?: (ratio: number) => void; signal: AbortSignal }
): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;           // required for programmatic playback
    video.playsInline = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    canvas.width = plan.targetWidth;
    canvas.height = plan.targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });

    let recorder: MediaRecorder | null = null;
    let raf = 0;
    let settled = false;
    const chunks: BlobPart[] = [];

    const cleanup = () => {
      cancelAnimationFrame(raf);
      signal.removeEventListener("abort", onAbort);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { recorder?.state !== "inactive" && recorder?.stop(); } catch { /* noop */ }
      cleanup();
      reject(err);
    };

    function onAbort() {
      fail(new CompressionCancelled());
    }
    signal.addEventListener("abort", onAbort, { once: true });

    if (!ctx) return fail(new Error("Canvas is unavailable"));

    video.onerror = () => fail(new Error("Could not read the video file"));

    video.onloadedmetadata = async () => {
      try {
        const stream = canvas.captureStream(30);

        // Carry the original audio through untouched (re-encoded by the recorder).
        try {
          const el = video as HTMLVideoElement & { captureStream?: () => MediaStream };
          const audio = el.captureStream?.().getAudioTracks?.() ?? [];
          for (const track of audio) stream.addTrack(track);
        } catch {
          /* silent video — proceed without an audio track */
        }

        recorder = new MediaRecorder(stream, {
          mimeType: plan.mimeType,
          videoBitsPerSecond: plan.videoBitrate,
          audioBitsPerSecond: plan.audioBitrate,
        });

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onerror = () => fail(new Error("Encoding failed"));

        recorder.onstop = () => {
          if (settled) return;
          settled = true;
          cleanup();
          const blob = new Blob(chunks, { type: plan.mimeType.split(";")[0] });
          // Guard: never ship a result that is bigger than the source.
          if (!blob.size || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const base = file.name.replace(/\.[a-z0-9]+$/i, "");
          resolve(
            new File([blob], `${base}-optimized.${plan.container}`, {
              type: plan.mimeType.split(";")[0],
              lastModified: Date.now(),
            })
          );
        };

        video.playbackRate = playbackRateFor(video.duration || 0);
        recorder.start(1000);

        const draw = () => {
          if (settled) return;
          if (!video.paused && !video.ended) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (video.duration) onProgress?.(Math.min(video.currentTime / video.duration, 1));
          }
          raf = requestAnimationFrame(draw);
        };

        video.onended = () => {
          onProgress?.(1);
          // Flush the tail of the stream before stopping.
          window.setTimeout(() => {
            try { recorder?.state !== "inactive" && recorder?.stop(); } catch { /* noop */ }
          }, 250);
        };

        await video.play();
        draw();
      } catch (e) {
        fail(e instanceof Error ? e : new Error("Encoding failed"));
      }
    };
  });
}
