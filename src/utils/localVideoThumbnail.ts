import { thumbnailFrameScore } from "@/lib/video/thumbnail-quality";
import {
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_CONTRAST,
  THUMBNAIL_SATURATION,
} from "@/lib/video/thumbnail-style";
/** Decode only the administrator's local File. No remote fetch or server video bytes. */
export async function localVideoThumbnail(
  file: File,
  visionRanking = false,
): Promise<{ thumbnail: Blob | null; duration?: number; warning?: string }> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  let duration: number | undefined;
  const wait = (event: string, action: () => void) =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener("error", fail);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error("This browser cannot decode the video."));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Video frame decoding timed out."));
      }, 12000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener("error", fail, { once: true });
      action();
    });
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await wait("loadeddata", () => {
      video.src = url;
    });
    if (Number.isFinite(video.duration) && video.duration > 0)
      duration = video.duration;
    if (!video.videoWidth || !video.videoHeight)
      throw new Error("No decodable video frame.");
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const analysis = document.createElement("canvas");
    analysis.width = 160;
    analysis.height = 90;
    const metrics = analysis.getContext("2d", { willReadFrequently: true });
    if (!context || !metrics) throw new Error("Canvas unavailable.");
    const times = duration
      ? [0.03, 0.1, 0.19, 0.29, 0.4, 0.52, 0.64, 0.75, 0.85, 0.94].map((t) =>
          Math.min(Math.max(0, duration! - 0.01), duration! * t),
        )
      : [0];
    const scale = Math.max(1280 / video.videoWidth, 720 / video.videoHeight);
    const width = video.videoWidth * scale,
      height = video.videoHeight * scale;
    const candidates: { time: number; score: number; image: string }[] = [];
    let bestScore = -Infinity;
    let bestTime: number | undefined;
    for (const timestamp of [...new Set(times)]) {
      try {
        if (Math.abs(timestamp - video.currentTime) > 0.001)
          await wait("seeked", () => {
            video.currentTime = timestamp;
          });
        metrics.drawImage(
          video,
          (1280 - width) / 16,
          (720 - height) / 16,
          width / 8,
          height / 8,
        );
        const rgba = metrics.getImageData(0, 0, 160, 90).data;
        const rgb = new Uint8Array(160 * 90 * 3);
        for (let i = 0; i < rgb.length / 3; i++) {
          rgb[i * 3] = rgba[i * 4];
          rgb[i * 3 + 1] = rgba[i * 4 + 1];
          rgb[i * 3 + 2] = rgba[i * 4 + 2];
        }
        const score = thumbnailFrameScore(rgb, 160, 90);
        if (visionRanking && Number.isFinite(score))
          candidates.push({
            time: timestamp,
            score,
            image: analysis.toDataURL("image/jpeg", 0.85),
          });
        if (score > bestScore) {
          bestScore = score;
          bestTime = timestamp;
        }
      } catch {
        /* Seek failures do not discard other valid candidates. */
      }
    }
    if (visionRanking && candidates.length >= 2) {
      const shortlist = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      try {
        const response = await fetch("/api/videos/bunny/thumbnail-rank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: shortlist.map((c) => c.image) }),
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          const { index } = await response.json();
          if (Number.isInteger(index) && index >= 0 && index < shortlist.length)
            bestTime = shortlist[index].time;
        }
      } catch {
        /* Local winner remains the reliable fallback. */
      }
    }
    analysis.width = analysis.height = 0;
    if (bestTime !== undefined) {
      if (Math.abs(bestTime - video.currentTime) > 0.001)
        await wait("seeked", () => {
          video.currentTime = bestTime!;
        });
      context.filter = `contrast(${THUMBNAIL_CONTRAST}) saturate(${THUMBNAIL_SATURATION})`;
      context.drawImage(
        video,
        (1280 - width) / 2,
        (720 - height) / 2,
        width,
        height,
      );
      // Restrained four-neighbour sharpening; never invent scene content.
      const image = context.getImageData(0, 0, 1280, 720);
      const source = new Uint8ClampedArray(image.data);
      for (let y = 1; y < 719; y++)
        for (let x = 1; x < 1279; x++) {
          const i = (y * 1280 + x) * 4;
          for (let c = 0; c < 3; c++)
            image.data[i + c] =
              source[i + c] * 1.24 -
              0.06 *
                (source[i - 4 + c] +
                  source[i + 4 + c] +
                  source[i - 5120 + c] +
                  source[i + 5120 + c]);
        }
      context.putImageData(image, 0, 0);
      const thumbnail = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (thumbnail && thumbnail.size > 0) return { thumbnail, duration };
    }
    throw new Error("Sampled frames were blank or unavailable.");
  } catch {
    return {
      thumbnail: null,
      duration,
      warning:
        "Thumbnail unavailable: this browser could not decode a usable frame. Retry thumbnail generation using the same source file before publication.",
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
