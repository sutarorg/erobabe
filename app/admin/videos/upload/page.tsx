"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CloudUpload,
  Film,
  ImagePlus,
  Link2,
  LoaderCircle,
  PlaySquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getJson, postJson } from "@/src/utils/api";
import { splitEmbedEntries, splitUrlEntries } from "@/lib/video/entries";
import { uploadWithProgress, uploadMultipartWithProgress, describeUploadEndpointError } from "@/src/utils/uploadFile";
import { formatEta, formatUploadStatus, transferPercent } from "@/src/utils/uploadProgress";

type Category = { id: string; label: string };
type UploadMode = "files" | "embed" | "url";
type ItemKind = "file" | "embed" | "url";
type Phase = "idle" | "uploading" | "processing" | "published" | "failed";

type Item = {
  id: string;
  kind: ItemKind;
  /** Local video file — only for `file` items. */
  file: File | null;
  /** Iframe source/code or remote video URL — for `embed` and `url` items. */
  source: string;
  thumbnail: File | null;
  thumbnailPreview: string | null;
  /** Storage path once the thumbnail has been pushed to Supabase Storage. */
  thumbnailPath: string | null;
  phase: Phase;
  percent: number;
  detail: string;
  /**
   * True while the row waits on something with no measurable progress (the bar
   * pulses instead of showing a percentage). Defaults to `processing`.
   */
  waiting?: boolean;
  error?: string;
  metadataWarning?: string;
  title?: string;
  slug?: string;
  /** Streamtape upload session id, when one has been opened for this row. */
  uploadId?: string;
  /** Upload job row the server created for this session. */
  jobId?: string;
  /** Video row — set once the upload/import has been attached to a video. */
  videoId?: string;
  /** Streamtape remote-import task id (kept separate from the provider file id). */
  importId?: string;
};

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|mkv|avi|wmv|flv|ts|mpg|mpeg|3gp)$/i;

/**
 * How many videos move through the pipeline at the same time.
 *
 * Each Streamtape upload carries its own session id, so parallel transfers can no
 * longer be confused with each other (the old library-diff confirmation had to
 * serialise same-titled files). Three concurrent transfers keep a normal uplink
 * busy; a single video uses the whole link.
 */
const UPLOAD_CONCURRENCY = 3;

/** Bytes own the first 90% of the bar; completing and publishing take the rest. */
const UPLOAD_SHARE = 90;
const COMPLETING_PERCENT = 94;
const PUBLISHING_PERCENT = 98;

/** How often a row re-checks the provider while Streamtape is still converting. */
const PROVIDER_POLL_ATTEMPTS = 24;
const PROVIDER_POLL_INTERVAL_MS = 5000;

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || VIDEO_EXTENSION.test(file.name);
}

function readableSize(size: number) {
  if (size > 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size > 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Opens the upload-node connection while the session request is still in flight. */
function preconnect(url: string) {
  if (typeof document === "undefined") return;
  try {
    const origin = new URL(url).origin;
    if (document.querySelector(`link[data-preconnect="${origin}"]`)) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    link.dataset.preconnect = origin;
    document.head.appendChild(link);
  } catch {
    // A bad URL must not block the upload.
  }
}

/** Sleeps until the abort signal fires or the delay elapses. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAbortedErrorLike());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedErrorLike());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Local marker so this file does not need the class from the uploader module. */
class UploadAbortedErrorLike extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

/**
 * One bar per queued video. Determinate while bytes are actually moving (the
 * Streamtape transfer reports real bytes), pulsing while we wait on the provider.
 */
export function ProgressBar({
  percent,
  phase,
  waiting = phase === "processing",
}: {
  percent: number;
  phase: Phase;
  waiting?: boolean;
}) {
  const failed = phase === "failed";
  const done = phase === "published";
  const value = Math.round(Math.max(0, Math.min(100, percent)));
  return (
    <div className="mt-2.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={waiting ? undefined : value}
        aria-label={waiting ? "Upload in progress" : `${value}% complete`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            failed ? "bg-red-400" : done ? "bg-emerald-400" : "bg-accent"
          } ${waiting ? "animate-pulse" : ""}`}
          style={{ width: `${waiting ? 100 : Math.max(2, value)}%` }}
        />
      </div>
      {!waiting && (
        <p className={`mt-1 text-right text-[10px] tabular-nums ${done ? "text-emerald-300" : failed ? "text-red-300" : "text-ink-3"}`}>
          {value}%
        </p>
      )}
    </div>
  );
}

export default function UploadPage() {
  const [mode, setMode] = useState<UploadMode>("files");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pasteBuffer, setPasteBuffer] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const abortRef = useRef<AbortController | null>(null);
  /** Items published with file-name metadata because Gemini was unavailable. */
  const fallbackRef = useRef(0);
  /** How many transfers are in flight right now. */
  const activeTransfersRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categories")
      .select("id, label")
      .order("label")
      .then(({ data }) => setCategories((data || []) as Category[]));
  }, []);

  // Free object URLs when the component unmounts.
  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.thumbnailPreview) URL.revokeObjectURL(item.thumbnailPreview);
      }
    },
    []
  );

  const categoryLabel = useMemo(() => categories.find((category) => category.id === categoryId)?.label, [categories, categoryId]);

  const patchItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  function makeFileItem(file: File): Item {
    return {
      id: newId(),
      kind: "file",
      file,
      source: file.name,
      thumbnail: null,
      thumbnailPreview: null,
      thumbnailPath: null,
      phase: "idle",
      percent: 0,
      detail: "Ready to publish",
    };
  }

  function makeSourceItem(kind: ItemKind, source: string): Item {
    return {
      id: newId(),
      kind,
      file: null,
      source,
      thumbnail: null,
      thumbnailPreview: null,
      thumbnailPath: null,
      phase: "idle",
      percent: 0,
      detail: "Ready to publish",
    };
  }

  function chooseLocalVideos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter(isVideoFile);
    if (!files.length) {
      setNotice("No video files were selected.");
      return;
    }
    setItems((current) => [...current, ...files.map(makeFileItem)]);
    event.target.value = "";
    setError("");
    setNotice("");
  }

  function applyPaste() {
    const entries = mode === "embed" ? splitEmbedEntries(pasteBuffer) : splitUrlEntries(pasteBuffer);
    if (!entries.length) return;
    const kind: ItemKind = mode === "embed" ? "embed" : "url";
    setItems((current) => [...current, ...entries.map((entry) => makeSourceItem(kind, entry))]);
    setPasteBuffer("");
    setError("");
    setNotice("");
  }

  function setThumbnail(id: string, file: File | null) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        if (item.thumbnailPreview) URL.revokeObjectURL(item.thumbnailPreview);
        if (!file) return { ...item, thumbnail: null, thumbnailPreview: null, thumbnailPath: null };
        return {
          ...item,
          thumbnail: file,
          thumbnailPreview: URL.createObjectURL(file),
          thumbnailPath: null,
        };
      })
    );
  }

  function handleThumbnailInput(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (!THUMBNAIL_TYPES.includes(file.type)) {
      setError("Thumbnails must be JPG, PNG, GIF, or WebP.");
      return;
    }
    if (file.size > MAX_THUMBNAIL_SIZE) {
      setError("Thumbnails must be 10 MB or smaller.");
      return;
    }
    setError("");
    setThumbnail(id, file);
  }

  function removeItem(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.thumbnailPreview) URL.revokeObjectURL(target.thumbnailPreview);
      return current.filter((item) => item.id !== id);
    });
  }

  function resetItems() {
    setItems((current) => {
      for (const item of current) if (item.thumbnailPreview) URL.revokeObjectURL(item.thumbnailPreview);
      return [];
    });
    setError("");
    setNotice("");
  }

  function switchMode(next: UploadMode) {
    if (next === mode) return;
    resetItems();
    setMode(next);
  }

  /** Uploads a thumbnail to Supabase Storage and returns its object path. */
  async function uploadThumbnailFile(item: Item, controller: AbortController, onProgress: (percent: number) => void) {
    if (!item.thumbnail) return item.thumbnailPath;
    if (item.thumbnailPath) return item.thumbnailPath;

    const target = await postJson<{ uploadUrl: string; storagePath: string }>("/api/videos/storage-token", {
      kind: "thumbnail",
      fileName: item.thumbnail.name,
      fileSize: item.thumbnail.size,
      mimeType: item.thumbnail.type,
    });

    await uploadWithProgress(target.uploadUrl, item.thumbnail, {
      contentType: item.thumbnail.type,
      signal: controller.signal,
      onProgress: (progress) => onProgress(progress.percent),
    });
    return target.storagePath;
  }

  /**
   * Asks the existing suggest route for metadata while the file is still
   * travelling. A failure just means publish falls back to server-side
   * generation — it must never delay the first video byte.
   */
  function beginMetadata(fileName: string): Promise<{ title: string; description: string; tags: string[]; source: "ai" } | null> {
    const label = categories.find((category) => category.id === categoryId)?.label || "";
    return postJson<{ suggestion?: { title?: string; description?: string; tags?: unknown } }>("/api/gemini/suggest", {
      fileName: fileName.slice(0, 240),
      title: fileName.replace(/\.[^.]+$/, "").slice(0, 160),
      category: label.slice(0, 80),
    })
      .then((result) => {
        const suggestion = result?.suggestion;
        const title = typeof suggestion?.title === "string" ? suggestion.title.trim() : "";
        const description = typeof suggestion?.description === "string" ? suggestion.description.trim() : "";
        const tags = Array.isArray(suggestion?.tags)
          ? suggestion.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          : [];
        if (title.length < 3 || !description || tags.length === 0) return null;
        return { title, description, tags, source: "ai" as const };
      })
      .catch(() => null);
  }

  /**
   * Watches a job until Streamtape reports the file converted (or failed).
   *
   * A video is never treated as playable because the bytes arrived: the row
   * stays `processing` until the provider confirms. Rows that are still encoding
   * when the polling window ends stay usable — the admin can re-check later.
   */
  async function waitForProvider(
    item: Item,
    jobId: string | undefined,
    controller: AbortController,
    startPercent = COMPLETING_PERCENT
  ): Promise<"ready" | "failed" | "processing"> {
    for (let attempt = 0; attempt < PROVIDER_POLL_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) throw new UploadAbortedErrorLike();
      if (attempt > 0 || startPercent === COMPLETING_PERCENT) {
        await abortableSleep(PROVIDER_POLL_INTERVAL_MS, controller.signal);
      }
      patchItem(item.id, {
        phase: "processing",
        percent: Math.min(PUBLISHING_PERCENT, startPercent + attempt),
        waiting: true,
        detail:
          attempt === 0
            ? "Streamtape is converting the video…"
            : `Streamtape is still converting the video (check ${attempt + 1} of ${PROVIDER_POLL_ATTEMPTS}, ${formatEta(
                ((attempt + 1) * PROVIDER_POLL_INTERVAL_MS) / 1000
              )} elapsed)…`,
      });

      let status: any;
      try {
        status = await getJson<any>(`/api/videos/status?${jobId ? `jobId=${encodeURIComponent(jobId)}` : `videoId=${encodeURIComponent(item.videoId || "")}`}`);
      } catch (pollError: any) {
        if (pollError?.status === 401 || pollError?.status === 403) throw pollError;
        continue;
      }

      const state = status?.providerState;
      if (state === "ready") return "ready";
      if (state === "failed") {
        throw new Error(status?.note || "Streamtape could not process this video.");
      }
    }
    return "processing";
  }

  async function publishFileItem(item: Item, controller: AbortController) {
    if (!item.file) throw new Error("Missing file");
    const file = item.file;

    // Metadata and the thumbnail travel beside the video bytes. Neither is
    // allowed to hold the first video byte.
    const metadataPromise = beginMetadata(file.name);
    const thumbnailPromise = uploadThumbnailFile(item, controller, () => {});
    thumbnailPromise.catch(() => {});

    patchItem(item.id, { phase: "uploading", percent: 0, waiting: false, detail: "Requesting an upload session…" });

    // Step 1: the server asks Streamtape for an upload node URL and wraps it
    // in a signed relay token. The API credentials stay on the server — the
    // browser only ever sees the relay address.
    const session = await postJson<{
      uploadId: string;
      jobId: string;
      uploadUrl: string;
      expiresAt: string | null;
      maxBytes: number | null;
    }>("/api/videos/streamtape-session", {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
    if (!session?.uploadUrl || !session?.uploadId) {
      throw new Error("Streamtape did not return a usable upload session.");
    }
    if (session.maxBytes && file.size > session.maxBytes) {
      throw new Error(`This file is larger than this deployment's upload limit (${readableSize(session.maxBytes)}).`);
    }
    preconnect(session.uploadUrl);
    patchItem(item.id, { uploadId: session.uploadId, jobId: session.jobId });

    // Step 2: the browser POSTs the multipart body straight to the relay,
    // which streams it to the Streamtape node. XHR gives measured byte-level
    // progress and a real cancel (abort → the relay aborts upstream).
    activeTransfersRef.current += 1;
    patchItem(item.id, { detail: "Starting the transfer…" });
    let nodeResponse = "";
    try {
      const uploaded = await uploadMultipartWithProgress(session.uploadUrl, file, file.name, {
        fieldName: "file1",
        signal: controller.signal,
        onProgress: (progress) => {
          const percent = transferPercent(progress.loaded, progress.total);
          patchItem(item.id, {
            phase: "uploading",
            // Bytes own 90% of the bar; completing and publishing own the rest.
            percent: (percent / 100) * UPLOAD_SHARE,
            waiting: false,
            detail: formatUploadStatus(percent, progress.bytesPerSecond),
          });
        },
      });
      if (uploaded.status < 200 || uploaded.status >= 300) {
        throw new Error(describeUploadEndpointError(uploaded.status, uploaded.body));
      }
      nodeResponse = uploaded.body;
    } finally {
      activeTransfersRef.current = Math.max(0, activeTransfersRef.current - 1);
    }

    // The thumbnail has to be in storage before the video row is created, but
    // it travelled behind the video bytes instead of in front of them.
    const thumbnailPath = (await thumbnailPromise) || item.thumbnailPath;
    if (thumbnailPath) patchItem(item.id, { thumbnailPath });

    // Step 3: the server confirms the transfer with Streamtape and creates the
    // video. It stays private until the provider reports the file converted.
    const preparedMetadata = await metadataPromise;
    patchItem(item.id, { phase: "processing", percent: COMPLETING_PERCENT, waiting: true, detail: "Finishing the upload…" });
    const json = await postJson<any>("/api/videos/upload", {
      uploadId: session.uploadId,
      jobId: session.jobId,
      thumbnailPath: thumbnailPath || null,
      categoryId,
      fileName: file.name,
      fileSize: file.size,
      // The node's verbatim reply — any candidate file id inside it is
      // re-verified server-side; the browser is never trusted for it.
      nodeResponse: nodeResponse.slice(0, 16 * 1024),
      ...(preparedMetadata ? { metadata: preparedMetadata } : {}),
    });

    if (json.metadataSource === "fallback") fallbackRef.current += 1;
    patchItem(item.id, {
      videoId: json.videoId,
      jobId: json.jobId,
      title: json.metadata?.title,
      slug: json.video?.slug,
      metadataWarning: json.metadataWarning || undefined,
      percent: PUBLISHING_PERCENT,
    });

    if (json.status === "ready") {
      finishItem(item, json);
      return;
    }
    if (json.status === "failed") {
      throw new Error(json.providerError || "Streamtape could not process this video.");
    }

    const outcome = await waitForProvider(item, json.jobId || session.jobId, controller);
    if (outcome === "ready") {
      finishItem(item, json);
      return;
    }
    patchItem(item.id, {
      phase: "processing",
      percent: PUBLISHING_PERCENT,
      // Not `waiting`: the row is no longer being polled, so the bar shows the
      // real value and a "Re-check status" button is offered instead of an
      // endlessly pulsing bar the admin cannot act on.
      waiting: false,
      detail: "Sent to Streamtape · still converting — this row publishes itself as soon as the provider is ready.",
    });
  }

  /** Marks a row published with the same wording the old flow used. */
  function finishItem(item: Item, json: any) {
    patchItem(item.id, {
      phase: "published",
      percent: 100,
      waiting: false,
      detail:
        json.metadataSource === "fallback"
          ? "Published · AI metadata unavailable — file-name metadata used, please review"
          : "Published · Streamtape has the video ready to play",
      title: json.metadata?.title,
      slug: json.video?.slug,
      metadataWarning: json.metadataWarning || undefined,
    });
  }

  /** Re-checks a row that was left processing (or failed) against the provider. */
  async function recheckStatus(item: Item) {
    setError("");
    patchItem(item.id, { phase: "processing", percent: COMPLETING_PERCENT, waiting: true, detail: "Re-checking with Streamtape…", error: undefined });
    try {
      const outcome = await waitForProvider(item, item.jobId, new AbortController());
      if (outcome === "ready") {
        patchItem(item.id, { phase: "published", percent: 100, waiting: false, detail: "Published · Streamtape has the video ready to play" });
        return;
      }
      patchItem(item.id, {
        phase: "processing",
        percent: PUBLISHING_PERCENT,
        waiting: true,
        detail: "Still converting at Streamtape — check again later.",
      });
    } catch (recheckError: any) {
      patchItem(item.id, {
        phase: "failed",
        percent: 100,
        waiting: false,
        detail: "Failed",
        error: recheckError.message || "Streamtape could not process this video.",
      });
    }
  }

  async function publishSourceItem(item: Item, controller: AbortController) {
    const endpoint = item.kind === "embed" ? "/api/videos/embed" : "/api/videos/upload-url";
    const payloadKey = item.kind === "embed" ? "source" : "url";
    let thumbnailPath = item.thumbnailPath;

    if (item.thumbnail && !thumbnailPath) {
      patchItem(item.id, { phase: "uploading", detail: "Uploading thumbnail…", percent: 0 });
      thumbnailPath = await uploadThumbnailFile(item, controller, (percent) =>
        patchItem(item.id, { percent: Math.round(percent * 0.55) })
      );
      patchItem(item.id, { thumbnailPath, percent: 55 });
    }

    patchItem(item.id, { phase: "processing", percent: 70, waiting: true, detail: "Generating AI metadata…" });
    const json = await postJson<any>(endpoint, {
      categoryId,
      entries: [{ [payloadKey]: item.source, thumbnailPath: thumbnailPath || null }],
    });
    const result = json.results?.[0];
    if (!result || result.status === "failed") {
      throw new Error(result?.error || json.error || "Unable to publish");
    }

    if (result.metadataSource === "fallback") fallbackRef.current += 1;

    // Embed sources are live immediately; URL imports are asynchronous.
    if (result.status === "published") {
      patchItem(item.id, {
        phase: "published",
        percent: 100,
        waiting: false,
        detail:
          result.metadataSource === "fallback"
            ? "Published · AI metadata unavailable — file-name metadata used, please review"
            : "Published",
        title: result.title,
        slug: result.slug,
        metadataWarning: result.metadataWarning || undefined,
      });
      return;
    }

    patchItem(item.id, {
      videoId: result.videoId,
      jobId: result.jobId,
      importId: result.importId,
      title: result.title,
      metadataWarning: result.metadataWarning || undefined,
      percent: COMPLETING_PERCENT,
      waiting: true,
      detail: "Import started — Streamtape is downloading the link…",
    });

    try {
      const outcome = await waitForProvider(item, result.jobId, controller);
      if (outcome === "ready") {
        patchItem(item.id, {
          phase: "published",
          percent: 100,
          waiting: false,
          detail:
            result.metadataSource === "fallback"
              ? "Published · AI metadata unavailable — file-name metadata used, please review"
              : "Published · Streamtape has the video ready to play",
          title: result.title,
          slug: result.slug,
        });
        return;
      }
      patchItem(item.id, {
        phase: "processing",
        percent: PUBLISHING_PERCENT,
        waiting: true,
        detail: "Streamtape is still downloading and converting — this row publishes itself once it is ready.",
      });
    } catch (pollError: any) {
      if (pollError?.name === "UploadAbortedError") throw pollError;
      throw new Error(pollError?.message || "Streamtape could not import this link.");
    }
  }

  async function publishAll(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!categoryId) {
      setError("Choose a category before publishing.");
      return;
    }
    const pending = itemsRef.current.filter((item) => item.phase !== "published");
    if (!pending.length) {
      setError("Add at least one video first.");
      return;
    }
    const invalid = pending.find((item) => item.kind !== "file" && !item.source.trim());
    if (invalid) {
      setError("Every entry needs a URL or iframe source. Remove the empty ones and try again.");
      return;
    }

    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    fallbackRef.current = 0;
    activeTransfersRef.current = 0;

    // Reset anything that failed on a previous attempt.
    for (const item of pending) {
      patchItem(item.id, { phase: "idle", percent: 0, waiting: false, detail: "Queued", error: undefined });
    }

    // Pull from a shared queue with a few workers: the second and third video
    // no longer wait for the first to be uploaded and published.
    const queue = [...pending];
    const settled = new Set<string>();
    let failures = 0;

    const worker = async () => {
      while (!controller.signal.aborted) {
        const item = queue.shift();
        if (!item) return;
        try {
          if (item.kind === "file") await publishFileItem(item, controller);
          else await publishSourceItem(item, controller);
        } catch (publishError: any) {
          if (publishError instanceof UploadAbortedErrorLike || publishError?.name === "UploadAbortedError") return;
          if (publishError?.status === 401 || publishError?.status === 403) {
            failures += 1;
            patchItem(item.id, { phase: "failed", percent: 100, waiting: false, detail: "Failed", error: publishError.message });
            return;
          }
          failures += 1;
          patchItem(item.id, {
            phase: "failed",
            percent: 100,
            waiting: false,
            detail: "Failed",
            error: publishError.message || "Upload failed",
          });
        }
        settled.add(item.id);
      }
    };

    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));

    activeTransfersRef.current = 0;
    setRunning(false);
    abortRef.current = null;

    // Anything the admin cancelled mid-flight goes back to the queue instead of
    // being left in a half-uploaded state.
    if (controller.signal.aborted) {
      for (const item of pending) {
        if (settled.has(item.id)) continue;
        patchItem(item.id, { phase: "idle", percent: 0, waiting: false, detail: "Cancelled — ready to publish" });
      }
      setNotice("Publishing cancelled. Finished items were kept.");
      return;
    }

    const fallbacks = fallbackRef.current;
    const fallbackNote = fallbacks
      ? ` ${fallbacks} used file-name metadata because the AI was unavailable — review those titles and descriptions.`
      : "";
    if (failures) setError(`${failures} item${failures > 1 ? "s" : ""} could not be published. See the inline messages.${fallbackNote}`);
    else setNotice(`All videos were published.${fallbackNote}`);
  }

  function cancelPublish() {
    // Aborting stops every in-flight XHR: the relay sees the disconnect and
    // aborts the upstream request, so Streamtape drops the partial body. The
    // stored sessions are then marked cancelled so nothing stale can finish.
    abortRef.current?.abort();
    for (const item of itemsRef.current) {
      if (!item.jobId || item.phase === "published") continue;
      postJson("/api/videos/streamtape-cancel", { jobId: item.jobId }).catch(() => null);
    }
  }

  const modes: { key: UploadMode; label: string; icon: typeof CloudUpload; description: string }[] = [
    {
      key: "files",
      label: "Upload videos",
      icon: CloudUpload,
      description: `Files stream from your browser through our upload relay straight to Streamtape — they never touch our storage bucket, and up to ${UPLOAD_CONCURRENCY} upload at once with measured byte progress.`,
    },
    { key: "embed", label: "Embed by iframe", icon: PlaySquare, description: "Publish trusted iframe sources, each with its own thumbnail." },
    { key: "url", label: "Upload by link", icon: Link2, description: "Streamtape downloads direct video URLs, each with its own thumbnail." },
  ];

  const pastePlaceholder =
    mode === "embed"
      ? 'https://player.example.com/embed/abc\n—or—\n<iframe src="https://player.example.com/embed/abc" allowfullscreen></iframe>'
      : "https://cdn.example.com/video-one.mp4\nhttps://cdn.example.com/video-two.mp4";

  const publishedCount = items.filter((item) => item.phase === "published").length;
  /** Items the batch no longer has to wait for: published or failed. */
  const finishedCount = items.filter((item) => item.phase === "published" || item.phase === "failed").length;

  /** Mean of the per-video bars. */
  const batchPercent = items.length
    ? items.reduce((sum, item) => sum + (item.phase === "published" ? 100 : Math.max(0, item.percent)), 0) / items.length
    : 0;

  return (
    <div className="max-w-5xl">
      <div>
        <h1 className="text-[20px] font-semibold">Publish videos</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          Choose a publishing method. Gemini generates the title, description, and tags; you control only the category and each video&apos;s thumbnail.
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {modes.map((item) => {
          const Icon = item.icon;
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => switchMode(item.key)}
              className={`rounded-lg border p-4 text-left transition ${active ? "border-accent bg-accent/[0.08]" : "border-line bg-pcard hover:border-ink-3"}`}
            >
              <Icon aria-hidden="true" className={`h-5 w-5 ${active ? "text-accent" : "text-ink-3"}`} />
              <p className="mt-3 text-[13px] font-semibold">{item.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{item.description}</p>
            </button>
          );
        })}
      </div>

      <form onSubmit={publishAll} className="mt-5 rounded-lg border border-line bg-pcard p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
          <label className="block w-full max-w-sm">
            <span className="mb-1 block text-[11px] font-medium">Category *</span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              required
              className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]"
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-ink-3">
            Need a category?{" "}
            <Link href="/admin/categories" className="text-accent hover:underline">
              Manage categories
            </Link>
            .
          </p>
        </div>

        {/* ---------------- Add ---------------- */}
        <div className="pt-5">
          {mode === "files" ? (
            <div className="rounded-lg border border-dashed border-line bg-void p-5 text-center">
              <Film aria-hidden="true" className="mx-auto h-6 w-6 text-ink-3" />
              <p className="mt-2 text-[13px] font-medium">Select one or more video files</p>
              <p className="mt-1 text-[11px] text-ink-3">
                Files stream from your browser through the upload relay straight to Streamtape, so large videos are fine, and up to {UPLOAD_CONCURRENCY} of
                them travel at the same time. Progress shows the bytes actually sent; if a transfer is interrupted, restart it (Streamtape does not
                support resuming a partial file). The row stays private until the provider reports the video converted.
              </p>
              <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-4 text-[12px] font-semibold hover:bg-card-hover">
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add videos
                <input type="file" accept="video/*" multiple onChange={chooseLocalVideos} className="sr-only" />
              </label>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-void p-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium">
                  {mode === "embed" ? "Iframe URL or embed code" : "Direct video URLs"}
                </span>
                <textarea
                  value={pasteBuffer}
                  onChange={(event) => setPasteBuffer(event.target.value)}
                  rows={mode === "embed" ? 4 : 5}
                  className="w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-[12px]"
                  placeholder={pastePlaceholder}
                />
                <span className="mt-1 block text-[10.5px] text-ink-3">
                  {mode === "embed"
                    ? "Paste several iframes at once — each one becomes its own entry with its own thumbnail."
                    : "One public video URL per line (up to 20). Each line becomes its own entry with its own thumbnail."}
                </span>
              </label>
              <button
                type="button"
                onClick={applyPaste}
                disabled={!pasteBuffer.trim()}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[12px] font-semibold hover:bg-card-hover disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add {mode === "embed" ? "embed" : "link"}
              </button>
            </div>
          )}
        </div>

        {/* ---------------- Per-video rows ---------------- */}
        {items.length > 0 && (
          <div className="mt-4 space-y-3">
            {items.map((item, index) => (
              <div key={item.id} className="rounded-md border border-line bg-void p-3">
                <div className="flex flex-wrap items-start gap-3">
                  {/* Thumbnail control — one per video */}
                  <div className="w-[104px] shrink-0">
                    {item.thumbnailPreview ? (
                      <div className="relative overflow-hidden rounded-md border border-line">
                        <img src={item.thumbnailPreview} alt="" className="aspect-video w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setThumbnail(item.id, null)}
                          aria-label="Remove thumbnail"
                          className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-ink hover:text-red-300"
                        >
                          <X aria-hidden="true" className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line bg-card text-ink-3 hover:border-accent/50 hover:text-accent">
                        <ImagePlus aria-hidden="true" className="h-4 w-4" />
                        <span className="text-[9.5px] font-medium">Thumbnail</span>
                      </label>
                    )}
                    <label className="mt-1 block cursor-pointer text-center text-[9.5px] text-accent hover:underline">
                      {item.thumbnailPreview ? "Replace" : "Add image"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        onChange={(event) => handleThumbnailInput(item.id, event)}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {/* Identity */}
                  <div className="min-w-[220px] flex-1">
                    {item.kind === "file" ? (
                      <>
                        <p className="flex items-center gap-1.5 truncate text-[12px] font-medium">
                          <Film aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                          {item.file?.name}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-ink-3">
                          {item.file ? readableSize(item.file.size) : ""} · “{categoryLabel || "selected category"}”
                        </p>
                      </>
                    ) : (
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-medium text-ink-3">
                          {item.kind === "embed" ? "Iframe URL or embed code" : "Direct video URL"}
                        </span>
                        <input
                          value={item.source}
                          onChange={(event) => patchItem(item.id, { source: event.target.value })}
                          disabled={running}
                          className="w-full rounded-md border border-line bg-card px-2.5 py-1.5 font-mono text-[11px] disabled:opacity-60"
                        />
                      </label>
                    )}

                    {item.title && <p className="mt-1 text-[11px] text-ink-2">Title: {item.title}</p>}
                    {item.metadataWarning && (
                      <p role="status" aria-live="polite" className="mt-1.5 text-[10.5px] leading-relaxed text-amber-300">
                        {item.metadataWarning}
                      </p>
                    )}

                    {item.phase === "idle" && <p className="mt-1.5 text-[10.5px] text-ink-3">{item.detail}</p>}
                    {(item.phase === "uploading" || item.phase === "processing") && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-accent">
                        <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                        {item.detail}
                      </p>
                    )}
                    {item.phase === "published" && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-emerald-300">
                        <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                        {item.detail}
                        {item.slug && (
                          <Link href={`/video/${item.slug}`} target="_blank" className="underline">
                            View
                          </Link>
                        )}
                      </p>
                    )}
                    {item.phase === "failed" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <p className="text-[10.5px] text-red-300">{item.error}</p>
                        <button
                          type="button"
                          onClick={() => recheckStatus(item)}
                          disabled={running || !item.jobId}
                          className="rounded-md border border-line px-2 py-0.5 text-[10.5px] font-medium hover:bg-white/5 disabled:opacity-40"
                        >
                          Re-check status
                        </button>
                      </div>
                    )}
                    {item.phase === "processing" && !item.waiting && item.jobId && (
                      <button
                        type="button"
                        onClick={() => recheckStatus(item)}
                        disabled={running}
                        className="mt-1.5 rounded-md border border-line px-2 py-0.5 text-[10.5px] font-medium hover:bg-white/5 disabled:opacity-40"
                      >
                        Re-check status
                      </button>
                    )}

                    {item.phase !== "idle" && (
                      <ProgressBar percent={item.percent} phase={item.phase} waiting={item.waiting} />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={running}
                    aria-label={`Remove entry ${index + 1}`}
                    className="rounded-md p-2 text-ink-3 hover:bg-white/5 hover:text-red-300 disabled:opacity-40"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---------------- Actions ---------------- */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={running || !items.length}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
          >
            {running && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {running
              ? "Publishing…"
              : `Generate AI metadata & publish${items.length - publishedCount > 1 ? ` ${items.length - publishedCount} videos` : " video"}`}
          </button>
          {running && (
            <button type="button" onClick={cancelPublish} className="inline-flex h-9 items-center rounded-md border border-line px-4 text-[12px] hover:bg-white/5">
              Cancel
            </button>
          )}
          {items.length > 0 && !running && (
            <button type="button" onClick={resetItems} className="inline-flex h-9 items-center rounded-md border border-line px-4 text-[12px] hover:bg-white/5">
              Clear list
            </button>
          )}
          {items.length > 0 && (
            <span className="text-[11px] tabular-nums text-ink-3">
              {publishedCount} of {items.length} published
            </span>
          )}
        </div>

        {/* ---------------- Whole-batch progress ---------------- */}
        {running && items.length > 0 && (
          <div className="mt-3 rounded-md border border-line bg-void p-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
              <span className="font-medium text-ink-2">
                {finishedCount} of {items.length} finished
                {activeTransfersRef.current > 0 ? ` · ${activeTransfersRef.current} uploading` : ""}
              </span>
            </div>
            <ProgressBar percent={batchPercent} phase="uploading" waiting={activeTransfersRef.current > 0 && batchPercent < 1} />
          </div>
        )}

        {error && <p className="mt-5 rounded-md bg-red-500/10 p-3 text-[12px] text-red-300">{error}</p>}
        {notice && !error && <p className="mt-5 rounded-md bg-emerald-500/10 p-3 text-[12px] text-emerald-300">{notice}</p>}
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        A publish action uploads the video to Streamtape, which then converts it. The video stays private and does not appear on the public site until the
        provider confirms playability — until then the row shows the converter&apos;s state and can be re-checked. Download links expire, so only
        Streamtape&apos;s stable embed address is stored.
      </p>
    </div>
  );
}
