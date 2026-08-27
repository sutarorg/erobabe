/* ──────────────────────────────────────────────────────────────
 * Automatic video optimization.
 *
 * Every upload is analyzed, then re-encoded to the smallest size that
 * still looks like the original, tuned for progressive web streaming
 * out of Cloudflare R2.
 *
 * Pipeline: <video> → downscaled <canvas> (captureStream) + original
 * audio track → MediaRecorder with an explicitly chosen codec and
 * bitrate. Everything runs in the browser, so no server transcoder,
 * no extra infrastructure and no upload of the oversized original.
 *
 * Size reduction comes from four cooperating decisions:
 *   1. Codec — VP9 is preferred where available (~35% smaller than
 *      H.264 at equal perceived quality), falling back to H.264.
 *   2. Resolution — capped at 1080p, aspect ratio preserved.
 *   3. Content-aware bitrate — the source is sampled to measure
 *      spatial detail and motion, so simple footage gets far fewer
 *      bits than busy action instead of a one-size-fits-all rate.
 *   4. Refinement — if the first pass is still large, one retry runs
 *      at a lower rate and the smaller result wins.
 *
 * The engine stays conservative about correctness: if the source is
 * already efficient, the browser can't re-encode, or a result would be
 * larger than the original, the original file is uploaded untouched.
 * ────────────────────────────────────────────────────────────── */

export interface VideoAnalysis {
  width: number;
  height: number;
  duration: number;
  size: number;
  /** Source bitrate in bits per second. */
  bitrate: number;
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
  /** Measured source complexity, 0 (flat) – 1 (busy). */
  complexity: number | null;
}

/** Quality ladder — bits per second per rung. */
const LADDER: { maxHeight: number; bitrate: number }[] = [
  { maxHeight: 360, bitrate: 500_000 },
  { maxHeight: 480, bitrate: 900_000 },
  { maxHeight: 720, bitrate: 1_800_000 },
  { maxHeight: 1080, bitrate: 3_200_000 },
  { maxHeight: 1440, bitrate: 6_000_000 },
  { maxHeight: 2160, bitrate: 10_000_000 },
];

/** Never publish anything larger than this — 1080p is the sweet spot for web. */
const MAX_HEIGHT = 1080;
/** Re-encoding runs near real time; refuse absurdly long inputs. */
const MAX_DURATION_SECONDS = 45 * 60;
/** Only bother if we expect to save at least this share of the file. */
const MIN_SAVING = 0.05;
/** Complexity multiplier bounds applied to the ladder bitrate. */
const COMPLEXITY_MIN = 0.6;
const COMPLEXITY_MAX = 1.4;
/** Bitrate scale for a refinement pass. */
const REFINEMENT_SCALE = 0.65;
/** Only retry when the first pass is still this large. */
const REFINEMENT_THRESHOLD = 0.45;
/** Refinement is skipped for long inputs to keep waits reasonable. */
const REFINEMENT_MAX_DURATION = 600;

/** Opus is markedly more efficient than AAC, so it gets fewer bits. */
const AUDIO_BITRATE = { webm: 96_000, mp4: 112_000 } as const;

/** Preferred containers/codecs, most efficient first. */
const CANDIDATE_TYPES: { mimeType: string; container: "mp4" | "webm" }[] = [
  { mimeType: "video/webm;codecs=vp9,opus", container: "webm" },
  { mimeType: "video/webm;codecs=vp09.00.10.08,opus", container: "webm" },
  { mimeType: "video/mp4;codecs=avc1.640029,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4", container: "mp4" },
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
      done({ width, height, duration, size: file.size, bitrate: (file.size * 8) / duration });
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

export interface Complexity {
  /** Static detail / edge density, 0–1. */
  spatial: number;
  /** Motion between samples, 0–1. */
  temporal: number;
  /** Blend used for bitrate scaling, 0–1. */
  overall: number;
}

/**
 * Sample frames across the timeline and measure how much information
 * the video actually carries. Flat, static footage compresses far
 * better than busy action, so it is given a much lower bitrate.
 */
export function analyzeComplexity(file: File): Promise<Complexity | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";

    const W = 160;
    const H = 90;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      URL.revokeObjectURL(url);
      return resolve(null);
    }

    const finish = (result: Complexity | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), 20_000);

    /** Luminance grid for one timestamp, or null if it can't be sampled. */
    const grabAt = (t: number): Promise<number[] | null> =>
      new Promise((res) => {
        const onSeek = () => {
          v.removeEventListener("seeked", onSeek);
          try {
            ctx.drawImage(v, 0, 0, W, H);
            const d = ctx.getImageData(0, 0, W, H).data;
            const lum = new Array<number>(W * H);
            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
              lum[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
            }
            res(lum);
          } catch {
            res(null);
          }
        };
        v.addEventListener("seeked", onSeek);
        try {
          v.currentTime = t;
        } catch {
          v.removeEventListener("seeked", onSeek);
          res(null);
        }
      });

    v.onloadedmetadata = async () => {
      const dur = v.duration;
      if (!dur || !v.videoWidth) {
        window.clearTimeout(timer);
        return finish(null);
      }
      const points = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]
        .map((f) => Math.min(dur * f, Math.max(dur - 0.05, 0)))
        .filter((t) => t >= 0);

      let spatialSum = 0;
      let spatialCount = 0;
      let temporalSum = 0;
      let temporalCount = 0;
      let prev: number[] | null = null;

      for (const t of points) {
        const lum = await grabAt(t);
        if (!lum) continue;

        // Mean absolute gradient ≈ edge energy ≈ how much detail is present.
        let edge = 0;
        let n = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            edge += Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + W] - lum[i - W]);
            n++;
          }
        }
        if (n) {
          spatialSum += edge / n;
          spatialCount++;
        }

        // Frame-to-frame difference ≈ motion.
        if (prev) {
          let diff = 0;
          for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - prev[i]);
          temporalSum += diff / lum.length;
          temporalCount++;
        }
        prev = lum;
      }

      window.clearTimeout(timer);
      if (!spatialCount) return finish(null);

      // Normalization constants are tuned to typical video content.
      const spatial = Math.min(1, spatialSum / spatialCount / 0.12);
      const temporal = temporalCount ? Math.min(1, temporalSum / temporalCount / 0.1) : 0.5;
      finish({ spatial, temporal, overall: Math.min(1, spatial * 0.55 + temporal * 0.45) });
    };

    v.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
  });
}

const evenly = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Decide the optimal encode settings for one analyzed file. */
export function planEncode(a: VideoAnalysis, complexity: number | null): EncodePlan {
  const chosen = pickMimeType();
  const base: EncodePlan = {
    compress: false,
    reason: "",
    targetWidth: a.width,
    targetHeight: a.height,
    videoBitrate: 0,
    audioBitrate: chosen ? AUDIO_BITRATE[chosen.container] : 112_000,
    mimeType: chosen?.mimeType ?? "",
    container: chosen?.container ?? "mp4",
    estimatedSize: a.size,
    estimatedSeconds: 0,
    complexity,
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

  // Content-aware scaling: static, flat footage needs far fewer bits.
  const complexityFactor =
    complexity == null ? 1 : COMPLEXITY_MIN + (COMPLEXITY_MAX - COMPLEXITY_MIN) * complexity;

  // VP9 is roughly 35% more efficient than H.264 at equal quality.
  const codecFactor = chosen.container === "webm" ? 0.65 : 1;

  let videoBitrate = Math.round(rung.bitrate * codecFactor * complexityFactor);

  // Never spend more bits than the source actually carries.
  const sourceVideoBitrate = Math.max(a.bitrate - AUDIO_BITRATE[chosen.container], 100_000);
  videoBitrate = Math.min(videoBitrate, Math.round(sourceVideoBitrate * 0.95));

  const estimatedSize =
    ((videoBitrate + AUDIO_BITRATE[chosen.container]) * a.duration) / 8;
  const saving = 1 - estimatedSize / a.size;

  if (scale === 1 && saving < MIN_SAVING) {
    return { ...base, reason: "Already well optimized — uploading the original.", estimatedSize: a.size };
  }

  const detail =
    complexity == null
      ? ""
      : complexity < 0.3
        ? "low motion/detail"
        : complexity > 0.65
          ? "high motion/detail"
          : "moderate motion/detail";

  return {
    ...base,
    compress: true,
    reason:
      `${scale < 1 ? `Scaling to ${targetHeight}p and re-encoding` : "Re-encoding"} for the smallest size at full visual quality` +
      (detail ? ` (${detail})` : "") +
      ".",
    targetWidth,
    targetHeight,
    videoBitrate,
    audioBitrate: AUDIO_BITRATE[chosen.container],
    mimeType: chosen.mimeType,
    container: chosen.container,
    estimatedSize,
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
    video.muted = true; // required for programmatic playback
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
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* noop */
      }
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

        // Carry the original audio through (re-encoded by the recorder).
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
            try {
              if (recorder && recorder.state !== "inactive") recorder.stop();
            } catch {
              /* noop */
            }
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

/**
 * Encode, then — when the result is still large and the video is short
 * enough to justify the extra wait — retry once at a lower rate and keep
 * whichever file is smaller.
 */
export async function compressVideoAggressive(
  file: File,
  plan: EncodePlan,
  opts: { onProgress?: (ratio: number) => void; signal: AbortSignal }
): Promise<{ file: File; plan: EncodePlan }> {
  const first = await compressVideo(file, plan, opts);
  if (first === file) return { file, plan };

  const worthRefining =
    plan.compress &&
    first.size > file.size * REFINEMENT_THRESHOLD &&
    (plan.estimatedSeconds ?? 0) <= REFINEMENT_MAX_DURATION;

  if (!worthRefining) return { file: first, plan };

  const retryPlan: EncodePlan = {
    ...plan,
    videoBitrate: Math.max(120_000, Math.round(plan.videoBitrate * REFINEMENT_SCALE)),
    estimatedSize: Math.round(plan.estimatedSize * REFINEMENT_SCALE),
    reason: `${plan.reason} Refined at a leaner bitrate.`,
  };

  try {
    const retry = await compressVideo(file, retryPlan, opts);
    return retry !== file && retry.size < first.size
      ? { file: retry, plan: retryPlan }
      : { file: first, plan };
  } catch (e) {
    if (e instanceof CompressionCancelled) throw e;
    return { file: first, plan };
  }
}
