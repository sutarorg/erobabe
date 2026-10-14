import { Upload } from "tus-js-client";
import { UploadAbortedError, type UploadOptions } from "./uploadFile";
export type BunnyUploadTarget = {
  uploadUrl: string;
  videoId: string;
  expiration: number;
  headers: Record<string, string>;
  transferred?: boolean;
  completed?: boolean;
  slug?: string;
};
/** Fingerprints bind resume URLs to one provider video, never merely a filename. */
export async function uploadBunnyVideo(
  target: BunnyUploadTarget,
  file: File,
  options: UploadOptions & { title: string },
): Promise<void> {
  if (target.uploadUrl !== "https://video.bunnycdn.com/tusupload")
    throw new Error("Invalid Bunny upload endpoint.");
  if (options.signal?.aborted) throw new UploadAbortedError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve();
    };
    const upload = new Upload(file, {
      endpoint: target.uploadUrl,
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: target.headers,
      metadata: { filetype: file.type, title: options.title },
      fingerprint: async () =>
        `erobabe-bunny:${target.headers.LibraryId}:${target.videoId}:${file.name}:${file.size}:${file.lastModified}`,
      removeFingerprintOnSuccess: true,
      onShouldRetry: (error) => {
        const status = error.originalResponse?.getStatus() || 0;
        return (
          status === 0 || status >= 500 || [409, 423, 429].includes(status)
        );
      },
      onProgress: (loaded, total) =>
        options.onProgress?.({
          loaded,
          total,
          percent: total ? (loaded / total) * 100 : 0,
          bytesPerSecond: null,
        }),
      onSuccess: () => finish(),
      onError: () =>
        finish(
          new Error(
            "Bunny direct upload failed. Retry this session to resume; expired resources may restart transfer to the same video. Check connectivity and upload authorization.",
          ),
        ),
    });
    const cancel = () => {
      void upload.abort().catch(() => undefined);
      finish(new UploadAbortedError());
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (settled || options.signal?.aborted) return cancel();
        // Only use Bunny URLs stored under the identity-specific fingerprint.
        const saved = previous.find((p) =>
          p.uploadUrl?.startsWith("https://video.bunnycdn.com/"),
        );
        if (saved) upload.resumeFromPreviousUpload(saved);
        upload.start();
      })
      .catch(() => {
        if (!settled) upload.start();
      });
  });
}
