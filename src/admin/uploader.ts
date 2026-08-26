import { api, type UploadPlan, type MultiPlan } from "./api";

/* ──────────────────────────────────────────────────────────────
 * Client upload engine: direct-to-R2 uploads with XHR progress,
 * parallel resumable multipart, retries with fresh signed URLs,
 * plus media probing (duration + auto poster frame).
 * ────────────────────────────────────────────────────────────── */

export const fmtBytes = (n: number): string => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const fmtDuration = (s: number | null | undefined): string => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/** Read duration + capture a poster frame (≈10% in) from a local video file. */
export function probeVideoFile(file: File): Promise<{ durationS: number | null; poster: string | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    const done = (durationS: number | null, poster: string | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve({ durationS, poster });
    };
    const timer = window.setTimeout(() => done(null, null), 9000);
    v.onloadedmetadata = () => {
      const durationS = Number.isFinite(v.duration) ? Math.round(v.duration) : null;
      v.onseeked = () => {
        try {
          const w = Math.min(960, v.videoWidth || 960);
          const h = Math.max(2, Math.round(((v.videoHeight || 540) / (v.videoWidth || 960)) * w));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
          window.clearTimeout(timer);
          done(durationS, canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          window.clearTimeout(timer);
          done(durationS, null);
        }
      };
      try {
        v.currentTime = Math.min(2, (v.duration || 6) * 0.1);
      } catch {
        window.clearTimeout(timer);
        done(durationS, null);
      }
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null, null);
    };
    v.src = url;
  });
}

export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelled";
  }
}

function xhrPut(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
      reject(new UploadCancelled());
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });

    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag") ?? "");
      } else {
        reject(new Error(`Storage rejected the upload (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Network error during upload"));
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new UploadCancelled());
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.send(blob);
  });
}

export interface UploadCallbacks {
  onProgress?: (loaded: number, total: number) => void;
  signal: AbortSignal;
}

/**
 * Uploads `file` according to a plan from POST /api/admin/uploads.
 * For multipart plans: 4 parallel parts, 3 attempts each, presigned
 * URLs refreshed transparently on expiry/failure.
 */
export async function uploadToStorage(
  file: File,
  plan: UploadPlan,
  { onProgress, signal }: UploadCallbacks
): Promise<{ partNumber: number; etag: string }[]> {
  if (plan.mode === "single") {
    await xhrPut(plan.url, file, (loaded) => onProgress?.(loaded, file.size), signal);
    return [];
  }

  const results: { partNumber: number; etag: string }[] = [];
  const loadedByPart = new Map<number, number>();
  const failing: number[] = [];
  const report = () => {
    let loaded = 0;
    for (const n of loadedByPart.values()) loaded += n;
    onProgress?.(loaded, file.size);
  };

  const totalParts = (plan as MultiPlan).parts.map((p) => p.partNumber);
  const partSize = (n: number) =>
    (plan as MultiPlan).parts.find((p) => p.partNumber === n)?.size ?? plan.chunkSize;
  let urlMap = new Map((plan as MultiPlan).parts.map((p) => [p.partNumber, p.url]));

  const freshUrl = async (n: number) => {
    const { parts } = await api.presignParts(plan.videoId, [n]);
    const url = parts[0]?.url;
    if (!url) throw new Error(`Could not refresh part ${n}`);
    urlMap.set(n, url);
    return url;
  };

  const queue = [...totalParts];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const n = queue.shift()!;
      if (signal.aborted) throw new UploadCancelled();
      const start = (n - 1) * plan.chunkSize;
      const blob = file.slice(start, start + partSize(n), file.type);
      let attempt = 0;
      for (;;) {
        try {
          const etag = await xhrPut(
            urlMap.get(n)!,
            blob,
            (loaded) => {
              loadedByPart.set(n, loaded);
              report();
            },
            signal
          );
          results.push({ partNumber: n, etag });
          loadedByPart.set(n, partSize(n));
          report();
          break;
        } catch (e) {
          if (e instanceof UploadCancelled) throw e;
          attempt++;
          if (attempt > 3) {
            failing.push(n);
            break;
          }
          await freshUrl(n).catch(() => {});
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (queue.length === 0) return;
    }
  });

  await Promise.all(workers);
  if (failing.length) {
    const err = new Error(`${failing.length} part(s) failed after retries`);
    (err as Error & { failedParts: number[] }).failedParts = failing;
    throw err;
  }
  return results;
}

/** Resumes only the missing parts (after a retry with fresh plan URLs). */
export async function uploadMissingParts(
  file: File,
  plan: MultiPlan,
  missing: number[],
  done: { partNumber: number; etag: string }[],
  { onProgress, signal }: UploadCallbacks
): Promise<{ partNumber: number; etag: string }[]> {
  if (!missing.length) return done;
  const { parts } = await api.presignParts(plan.videoId, missing);
  const resumed: MultiPlan = {
    ...plan,
    parts: missing.map((n, i) => ({
      partNumber: n,
      url: parts[i]?.url ?? "",
      size: (plan.parts.find((p) => p.partNumber === n)?.size ?? plan.chunkSize) as number,
    })),
  };
  const more = await uploadToStorage(file, resumed, { onProgress, signal });
  return [...done, ...more].sort((a, b) => a.partNumber - b.partNumber);
}
