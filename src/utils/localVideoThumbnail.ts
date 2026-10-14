/** Decode only the administrator's local File. No remote fetch or server video bytes. */
export async function localVideoThumbnail(
  file: File,
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
    canvas.width = Math.min(960, video.videoWidth);
    canvas.height = Math.round(
      (canvas.width * video.videoHeight) / video.videoWidth,
    );
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable.");
    const times = duration
      ? [duration * 0.15, duration * 0.4, duration * 0.65]
      : [0];
    for (const timestamp of times) {
      if (Math.abs(timestamp - video.currentTime) > 0.001)
        await wait("seeked", () => {
          video.currentTime = timestamp;
        });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 64)
        bright += pixels[i] + pixels[i + 1] + pixels[i + 2];
      if (bright / Math.ceil(pixels.length / 64) < 12) continue;
      const thumbnail = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (thumbnail) return { thumbnail, duration };
    }
    throw new Error("Sampled frames were blank or unavailable.");
  } catch {
    return {
      thumbnail: null,
      duration,
      warning:
        "Thumbnail unavailable: this browser could not decode a usable frame. The video can still upload.",
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
