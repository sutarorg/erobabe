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
import { ApiError, deleteJson, getJson, postJson } from "@/src/utils/api";
import { splitEmbedEntries, splitUrlEntries } from "@/lib/video/entries";
import { MAX_THUMBNAIL_SIZE, MAX_VIDEO_SIZE, UFOLOAD_MAX_ACTIVE_IMPORTS, formatBytes, looksLikeVideo } from "@/lib/video/limits";
import type { JobStatusView } from "@/lib/video/processing";
import { uploadWithProgress, UploadAbortedError } from "@/src/utils/uploadFile";
import { uploadFileInChunks, UfoloadUploadError, type UfoloadUploadSession } from "@/src/utils/ufoloadUpload";
import { formatUploadStatus } from "@/src/utils/uploadProgress";
import { nextPollDelay, uploadTiming } from "@/src/utils/uploadTiming";

type Category = { id: string; label: string };
type UploadMode = "files" | "embed" | "url";
type ItemKind = "file" | "embed" | "url";
type Phase = "idle" | "uploading" | "processing" | "published" | "failed";
type PreparedMetadata = { title: string; description: string; tags: string[]; source: "ai" };

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
  /** A problem with the last status check that did not change the video (provider unreachable…). */
  notice?: string;
  title?: string;
  slug?: string;
  /**
   * The UFOLOAD upload session of a file that has not been registered yet. Kept
   * after a failure so "Retry" asks the node where it stopped and resumes.
   */
  session?: UfoloadUploadSession;
  /** Upload job of a registered upload / started import — what the status poll follows. */
  jobId?: string;
  /** Metadata prepared while the bytes travelled; reused if the upload is retried. */
  prepared?: PreparedMetadata | null;
  /** The title/description came from the file name because Gemini was unavailable. */
  fallbackMetadata?: boolean;
};

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * How many videos move through the pipeline at the same time. Three concurrent
 * transfers keep a normal uplink busy; a single video uses the whole link.
 * Registered videos stop occupying a slot — their encoding is followed by the
 * status poll, not by a worker.
 */
const UPLOAD_CONCURRENCY = 3;

/** How long a link waits for one of UFOLOAD's import slots before giving up. */
const IMPORT_SLOT_WAIT_MS = 15 * 60 * 1000;
const STATUS_BATCH = 20;

function isVideoFile(file: File) {
  return looksLikeVideo(file.name, file.type);
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Sleeps until the abort signal fires (rejecting with UploadAbortedError) or the delay elapses. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A request that failed in a way repeating it can fix (network drop, gateway timeout, UFOLOAD busy). */
function isTransientApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.retryable === true || error.status === 0 || error.status === 502 || error.status === 504);
}

/** True when the session's grant is still worth trying (a minute of margin; the node has the last word). */
function sessionLooksUsable(session: UfoloadUploadSession): boolean {
  if (!session.expiresAt) return true;
  const expires = Date.parse(session.expiresAt);
  return !Number.isFinite(expires) || expires - 60_000 > Date.now();
}

/** Row copy while UFOLOAD works on a registered video. Only values UFOLOAD reported — no guessed percentages. */
function describeProcessing(view: Pick<JobStatusView, "phase" | "providerStatus" | "progress">): string {
  if (view.phase === "uploading") {
    return view.providerStatus === "import:queued" || view.progress === 0
      ? "Import accepted — waiting for UFOLOAD to start downloading the link…"
      : `UFOLOAD is downloading the link — ${view.progress}%`;
  }
  if (view.providerStatus === "ready") return "Ready at UFOLOAD — finishing up…";
  if (view.providerStatus === "import:done") return "Downloaded · waiting for UFOLOAD to start encoding…";
  if (view.providerStatus === "queued" || view.providerStatus === "uploading") {
    return "Uploaded · waiting in UFOLOAD's encoding queue…";
  }
  return `Uploaded · UFOLOAD is encoding — ${view.progress}%`;
}

/**
 * One bar per queued video. A determinate bar whenever the percentage is real
 * (bytes the UFOLOAD node has accepted, or the progress UFOLOAD itself reports
 * while it downloads or encodes). A pulsing bar while the row waits on
 * something with no number — never a guessed curve.
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
  /** Items registered with file-name metadata because Gemini was unavailable. */
  const fallbackRef = useRef(0);
  /** Items handed to UFOLOAD for processing during this run. */
  const handedOverRef = useRef(0);
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

  // Opening the page finishes anything an earlier session left unfinished
  // (bounded, fire-and-forget). Scheduled reconciliation does the same without a browser.
  useEffect(() => {
    postJson("/api/videos/reconcile", { limit: 10, budgetMs: 15_000 }).catch(() => {});
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

  // ---- follow videos UFOLOAD is still working on ----------------------------

  const applyStatus = useCallback((view: JobStatusView) => {
    setItems((current) =>
      current.map((item) => {
        if (item.jobId !== view.jobId) return item;
        if (view.phase === "published") {
          return {
            ...item,
            phase: "published",
            percent: 100,
            waiting: false,
            notice: undefined,
            error: undefined,
            title: view.title ?? item.title,
            slug: view.slug ?? item.slug,
            detail: item.fallbackMetadata
              ? "Published · AI metadata unavailable — file-name metadata used, please review"
              : "Published",
          };
        }
        if (view.phase === "ready") {
          return { ...item, phase: "published", percent: 100, waiting: false, detail: "Ready at UFOLOAD — not published (its status was changed in Videos)", notice: undefined };
        }
        if (view.phase === "failed" || view.phase === "cancelled") {
          return {
            ...item,
            phase: "failed",
            percent: 100,
            waiting: false,
            detail: "Failed",
            jobId: undefined,
            session: undefined,
            notice: undefined,
            error: view.error || "UFOLOAD could not process this video.",
          };
        }
        return {
          ...item,
          phase: "processing",
          percent: view.progress,
          waiting: view.progress <= 0,
          detail: describeProcessing(view),
          notice: view.warning || undefined,
        };
      })
    );
  }, []);

  const pollKey = useMemo(
    () =>
      items
        .filter((item) => item.phase === "processing" && item.jobId)
        .map((item) => item.jobId as string)
        .join(","),
    [items]
  );

  useEffect(() => {
    if (!pollKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = uploadTiming.initialDelayMs;

    const tick = async () => {
      let changed = false;
      try {
        const ids = pollKey.split(",");
        for (let start = 0; start < ids.length; start += STATUS_BATCH) {
          const batch = ids.slice(start, start + STATUS_BATCH);
          const result = await getJson<{ jobs?: JobStatusView[] }>(`/api/videos/status?jobIds=${encodeURIComponent(batch.join(","))}`);
          for (const view of result.jobs || []) {
            const before = itemsRef.current.find((item) => item.jobId === view.jobId);
            const settledNow = view.phase !== "processing" && view.phase !== "uploading";
            if (!before || settledNow || before.percent !== view.progress) changed = true;
            applyStatus(view);
          }
        }
      } catch (pollError) {
        if (pollError instanceof ApiError && (pollError.status === 401 || pollError.status === 403)) {
          stopped = true;
          setError("Your admin session ended, so processing status can no longer be refreshed. Sign in again and reopen this page.");
        }
        // Anything else is transient — keep polling.
      }
      if (stopped) return;
      delay = nextPollDelay(delay, changed);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollKey, applyStatus]);

  // ---- adding things --------------------------------------------------------

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
    const picked = Array.from(event.target.files || []).filter(isVideoFile);
    const tooLarge = picked.filter((file) => file.size > MAX_VIDEO_SIZE);
    const empty = picked.filter((file) => file.size <= 0);
    const files = picked.filter((file) => file.size > 0 && file.size <= MAX_VIDEO_SIZE);
    event.target.value = "";
    if (!files.length && !tooLarge.length && !empty.length) {
      setNotice("No video files were selected.");
      return;
    }
    if (files.length) setItems((current) => [...current, ...files.map(makeFileItem)]);
    const rejected: string[] = [];
    if (tooLarge.length) {
      rejected.push(`${tooLarge.map((file) => `“${file.name}”`).join(", ")} ${tooLarge.length > 1 ? "are" : "is"} larger than the ${formatBytes(MAX_VIDEO_SIZE).replace(".00", "")} limit`);
    }
    if (empty.length) rejected.push(`${empty.map((file) => `“${file.name}”`).join(", ")} ${empty.length > 1 ? "are" : "is"} empty`);
    setError(rejected.length ? `${rejected.join("; ")} — not added.` : "");
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
    const target = itemsRef.current.find((item) => item.id === id);
    // An upload session nobody will finish should not hold one of UFOLOAD's slots.
    if (target?.session?.jobId) releaseSession(target.session.jobId);
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed?.thumbnailPreview) URL.revokeObjectURL(removed.thumbnailPreview);
      return current.filter((item) => item.id !== id);
    });
  }

  function resetItems() {
    for (const item of itemsRef.current) if (item.session?.jobId) releaseSession(item.session.jobId);
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

  // ---- pieces of the pipeline ----------------------------------------------

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

  /** Releases UFOLOAD's upload slot for a session nobody will finish. Best effort. */
  function releaseSession(jobId: string) {
    deleteJson(`/api/videos/ufoload-session?jobId=${encodeURIComponent(jobId)}`).catch(() => {});
  }

  /**
   * Asks the existing suggest route for metadata while the file is still
   * travelling. A failure just means registration falls back to server-side
   * generation — it must never delay the first video byte.
   */
  function beginMetadata(fileName: string): Promise<PreparedMetadata | null> {
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

  /** Completes an upload whose bytes UFOLOAD has accepted. Safe to repeat, so transient failures are retried. */
  async function registerUpload(payload: Record<string, unknown>, controller: AbortController) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await postJson<any>("/api/videos/upload", payload);
      } catch (registerError) {
        const delays = uploadTiming.registerRetryDelaysMs;
        if (!isTransientApiError(registerError) || attempt >= delays.length) throw registerError;
        const wait = Math.max(delays[attempt], Math.min(15, registerError.retryAfterSeconds ?? 0) * 1000);
        await abortableSleep(wait, controller.signal);
      }
    }
  }

  async function publishFileItem(item: Item, controller: AbortController) {
    if (!item.file) throw new Error("Missing file");
    const file = item.file;

    // Metadata and the thumbnail travel beside the video bytes. Neither is
    // allowed to hold the first video byte.
    const metadataPromise: Promise<PreparedMetadata | null> = item.prepared
      ? Promise.resolve(item.prepared)
      : beginMetadata(file.name).then((prepared) => {
          if (prepared) patchItem(item.id, { prepared });
          return prepared;
        });
    const thumbnailPromise = uploadThumbnailFile(item, controller, () => {});
    thumbnailPromise.catch(() => {});

    patchItem(item.id, { phase: "uploading", percent: 0, waiting: true, detail: "Preparing the upload…", error: undefined, notice: undefined });

    // A session kept from a failed attempt resumes where the node stopped; anything else starts fresh.
    let session = item.session && sessionLooksUsable(item.session) ? item.session : null;
    const resume = Boolean(session);
    if (!session) {
      if (item.session?.jobId) releaseSession(item.session.jobId);
      session = await postJson<UfoloadUploadSession>("/api/videos/ufoload-session", {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        categoryId,
      });
      patchItem(item.id, { session });
    }
    const jobId = session.jobId;

    activeTransfersRef.current += 1;
    patchItem(item.id, { phase: "uploading", percent: 0, waiting: true, detail: resume ? "Resuming the upload…" : "Starting the upload…" });
    try {
      await uploadFileInChunks({
        file,
        session,
        signal: controller.signal,
        resume,
        onProgress: (progress) => {
          // Whole numbers rounded DOWN: 99.9% must not read as 100% before the node has accepted the last byte.
          const shown = progress.percent >= 100 ? 100 : Math.min(99, Math.floor(progress.percent));
          patchItem(item.id, {
            phase: "uploading",
            percent: shown,
            waiting: false,
            detail: formatUploadStatus(shown, progress.bytesPerSecond),
          });
        },
        keepAlive: async () => {
          if (!jobId) return "ok";
          try {
            const state = await getJson<{ state?: string }>(`/api/videos/ufoload-session?jobId=${encodeURIComponent(jobId)}`);
            return state.state === "failed" || state.state === "aborted" ? "gone" : "ok";
          } catch (keepAliveError) {
            // 404: UFOLOAD or our server no longer knows the session. Anything else is transient.
            return keepAliveError instanceof ApiError && keepAliveError.status === 404 ? "gone" : "ok";
          }
        },
      });
    } catch (uploadError) {
      if (uploadError instanceof UploadAbortedError) {
        // The admin cancelled: release UFOLOAD's slot instead of leaving the session to expire.
        if (jobId) releaseSession(jobId);
        patchItem(item.id, { session: undefined });
      } else if (uploadError instanceof UfoloadUploadError && !uploadError.resumable) {
        // The grant is refused, the session is gone or the file cannot fit — a retry needs a new session.
        if (jobId) releaseSession(jobId);
        patchItem(item.id, { session: undefined });
      }
      throw uploadError;
    } finally {
      activeTransfersRef.current = Math.max(0, activeTransfersRef.current - 1);
    }

    // The thumbnail has to be in storage before the video row is created.
    const thumbnailPath = (await thumbnailPromise) || item.thumbnailPath;
    if (thumbnailPath) patchItem(item.id, { thumbnailPath });
    const prepared = await metadataPromise;

    // Every byte is accepted. UFOLOAD still has to verify and create the file, so the row says so
    // instead of pretending the video is done.
    patchItem(item.id, { phase: "processing", percent: 100, waiting: true, detail: "Upload received — finalizing with UFOLOAD…" });
    let json: any;
    try {
      json = await registerUpload(
        {
          jobId,
          thumbnailPath: thumbnailPath || null,
          categoryId,
          fileName: file.name,
          fileSize: file.size,
          ...(prepared ? { metadata: prepared } : {}),
        },
        controller
      );
    } catch (registerError) {
      if (registerError instanceof UploadAbortedError) {
        if (jobId) releaseSession(jobId);
        patchItem(item.id, { session: undefined });
      } else if (!isTransientApiError(registerError)) {
        // The session was consumed or refused; a retry must start a new one. A transient failure keeps
        // it: every byte is already at UFOLOAD, so a retry only repeats this last step.
        patchItem(item.id, { session: undefined });
      }
      throw registerError;
    }
    handOver(item, json);
  }

  /**
   * Applies the server's answer for a registered upload (`phase` = the job phase it
   * reports) or a started import (`"uploading"`: UFOLOAD is still downloading the link).
   */
  function handOver(item: Item, json: any, phase: string = json.status) {
    if (phase === "failed" || phase === "cancelled") {
      throw new Error(json.error || "UFOLOAD could not process this video.");
    }
    if (json.metadataSource === "fallback") fallbackRef.current += 1;
    const base: Partial<Item> = {
      session: undefined,
      jobId: json.jobId,
      title: json.metadata?.title ?? json.video?.title ?? json.title,
      slug: json.video?.slug ?? json.slug,
      metadataWarning: json.metadataWarning || undefined,
      fallbackMetadata: json.metadataSource === "fallback",
      notice: json.warning || undefined,
      error: undefined,
    };
    if (json.published === true || phase === "published") {
      patchItem(item.id, {
        ...base,
        phase: "published",
        percent: 100,
        waiting: false,
        detail:
          json.metadataSource === "fallback"
            ? "Published · AI metadata unavailable — file-name metadata used, please review"
            : "Published",
      });
      return;
    }
    handedOverRef.current += 1;
    const progress = Number.isFinite(Number(json.progress)) ? Math.max(0, Math.min(100, Number(json.progress))) : 0;
    patchItem(item.id, {
      ...base,
      phase: "processing",
      percent: progress,
      waiting: progress <= 0,
      detail: describeProcessing({
        phase: phase === "uploading" ? "uploading" : "processing",
        providerStatus: json.providerStatus ?? null,
        progress,
      }),
    });
  }

  async function publishSourceItem(item: Item, controller: AbortController) {
    let thumbnailPath = item.thumbnailPath;

    if (item.thumbnail && !thumbnailPath) {
      patchItem(item.id, { phase: "uploading", detail: "Uploading thumbnail…", percent: 0 });
      thumbnailPath = await uploadThumbnailFile(item, controller, (percent) =>
        patchItem(item.id, { percent: Math.round(percent * 0.55) })
      );
      patchItem(item.id, { thumbnailPath, percent: 55 });
    }

    if (item.kind === "embed") {
      patchItem(item.id, { phase: "processing", percent: 70, detail: "Generating AI metadata…", error: undefined });
      const json = await postJson<any>("/api/videos/embed", {
        categoryId,
        entries: [{ source: item.source, thumbnailPath: thumbnailPath || null }],
      });
      const result = json.results?.[0];
      if (!result || result.status !== "published") {
        throw new Error(result?.error || json.error || "Unable to publish");
      }
      if (result.metadataSource === "fallback") fallbackRef.current += 1;
      patchItem(item.id, {
        phase: "published",
        percent: 100,
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

    // URL import: UFOLOAD downloads the link itself. This only STARTS the task and returns.
    patchItem(item.id, { phase: "uploading", percent: 0, waiting: true, detail: "Starting the import…", error: undefined });
    const startedAt = Date.now();
    for (;;) {
      try {
        const json = await postJson<any>("/api/videos/upload-url", {
          categoryId,
          entries: [{ url: item.source, thumbnailPath: thumbnailPath || null }],
        });
        const result = json.results?.[0];
        if (!result || result.status !== "processing") {
          throw new Error(result?.error || json.error || "Unable to start the import");
        }
        handOver(item, { ...result, providerStatus: result.providerStatus ?? "import:queued" }, "uploading");
        return;
      } catch (importError) {
        // UFOLOAD runs at most 10 imports at a time: wait for a slot instead of failing the link.
        if (importError instanceof ApiError && importError.code === "import_slots_full") {
          if (Date.now() - startedAt > IMPORT_SLOT_WAIT_MS) {
            throw new Error(`UFOLOAD's ${UFOLOAD_MAX_ACTIVE_IMPORTS} import slots stayed busy for ${Math.round(IMPORT_SLOT_WAIT_MS / 60000)} minutes. Try this link again later.`);
          }
          patchItem(item.id, {
            phase: "uploading",
            waiting: true,
            detail: `Waiting for a free UFOLOAD import slot (it runs ${UFOLOAD_MAX_ACTIVE_IMPORTS} at a time)…`,
          });
          await abortableSleep(
            uploadTiming.importSlotRetryMs ?? Math.min(60, Math.max(1, importError.retryAfterSeconds ?? 30)) * 1000,
            controller.signal
          );
          continue;
        }
        throw importError;
      }
    }
  }

  /** Runs a set of items through the pipeline with a few workers. */
  async function runBatch(batch: Item[]) {
    setError("");
    setNotice("");

    if (!categoryId) {
      setError("Choose a category before publishing.");
      return;
    }
    if (!batch.length) {
      setError("Add at least one video first.");
      return;
    }
    const invalid = batch.find((item) => item.kind !== "file" && !item.source.trim());
    if (invalid) {
      setError("Every entry needs a URL or iframe source. Remove the empty ones and try again.");
      return;
    }

    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    fallbackRef.current = 0;
    handedOverRef.current = 0;
    activeTransfersRef.current = 0;

    // Reset anything that failed on a previous attempt (a kept upload session is untouched, so it resumes).
    for (const item of batch) {
      patchItem(item.id, { phase: "idle", percent: 0, waiting: false, detail: "Queued", error: undefined });
    }

    // Pull from a shared queue with a few workers. A video leaves its worker as soon as
    // UFOLOAD has it: encoding is followed by the status poll, not by an occupied slot.
    const queue = [...batch];
    const settled = new Set<string>();
    let failures = 0;

    const worker = async () => {
      while (!controller.signal.aborted) {
        const item = queue.shift();
        if (!item) return;
        // The latest copy carries a session/prepared metadata saved by an earlier attempt.
        const current = itemsRef.current.find((candidate) => candidate.id === item.id) || item;
        try {
          if (current.kind === "file") await publishFileItem(current, controller);
          else await publishSourceItem(current, controller);
        } catch (publishError: any) {
          if (publishError instanceof UploadAbortedError) return;
          failures += 1;
          const resumable = publishError instanceof UfoloadUploadError && publishError.resumable;
          patchItem(item.id, {
            phase: "failed",
            percent: 100,
            waiting: false,
            detail: "Failed",
            error: `${publishError.message || "Upload failed"}${resumable ? " Press Retry to resume from where it stopped." : ""}`,
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
      for (const item of batch) {
        if (settled.has(item.id)) continue;
        patchItem(item.id, { phase: "idle", percent: 0, waiting: false, detail: "Cancelled — ready to publish", session: undefined });
      }
      setNotice("Publishing cancelled. Videos already handed to UFOLOAD keep processing.");
      return;
    }

    const fallbacks = fallbackRef.current;
    const fallbackNote = fallbacks
      ? ` ${fallbacks} used file-name metadata because the AI was unavailable — review those titles and descriptions.`
      : "";
    if (failures) {
      setError(`${failures} item${failures > 1 ? "s" : ""} could not be published. See the inline messages.${fallbackNote}`);
    } else if (handedOverRef.current > 0) {
      setNotice(
        `All uploads were sent to UFOLOAD. ${handedOverRef.current} video${handedOverRef.current > 1 ? "s are" : " is"} still processing there — each is published automatically once UFOLOAD reports it ready.${fallbackNote}`
      );
    } else {
      setNotice(`All videos were published.${fallbackNote}`);
    }
  }

  async function publishAll(event: FormEvent) {
    event.preventDefault();
    // Videos already handed to UFOLOAD (processing) or published are not sent again.
    const pending = itemsRef.current.filter((item) => item.phase === "idle" || item.phase === "failed");
    await runBatch(pending);
  }

  async function retryItem(item: Item) {
    if (running) return;
    await runBatch([item]);
  }

  function cancelPublish() {
    // Aborting stops every in-flight XHR/fetch; the summary in `runBatch`
    // then reports the cancellation once the workers have drained.
    abortRef.current?.abort();
  }

  const modes: { key: UploadMode; label: string; icon: typeof CloudUpload; description: string }[] = [
    {
      key: "files",
      label: "Upload videos",
      icon: CloudUpload,
      description: `Files go straight from your browser to UFOLOAD in resumable chunks — they never touch our servers or storage bucket, and up to ${UPLOAD_CONCURRENCY} upload at once.`,
    },
    { key: "embed", label: "Embed by iframe", icon: PlaySquare, description: "Publish trusted iframe sources, each with its own thumbnail." },
    { key: "url", label: "Upload by link", icon: Link2, description: "Send direct video URLs to UFOLOAD — it downloads them itself — each with its own thumbnail." },
  ];

  const pastePlaceholder =
    mode === "embed"
      ? 'https://player.example.com/embed/abc\n—or—\n<iframe src="https://player.example.com/embed/abc" allowfullscreen></iframe>'
      : "https://cdn.example.com/video-one.mp4\nhttps://cdn.example.com/video-two.mp4";

  const publishedCount = items.filter((item) => item.phase === "published").length;
  /** Items the batch no longer has to wait for: published or failed. */
  const finishedCount = items.filter((item) => item.phase === "published" || item.phase === "failed").length;

  /** Mean of the per-video bars: real bytes accepted while uploading, UFOLOAD's own progress afterwards. */
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
                Files upload straight to UFOLOAD in resumable chunks, so large videos (up to {formatBytes(MAX_VIDEO_SIZE).replace(".00", "")}) are fine, and up to {UPLOAD_CONCURRENCY} of them travel at the same time. The
                percentage and speed are real bytes UFOLOAD has accepted — if the connection drops, Retry resumes where it stopped.
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
                          {item.file ? formatBytes(item.file.size) : ""} · “{categoryLabel || "selected category"}”
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
                    {item.notice && (
                      <p role="status" aria-live="polite" className="mt-1.5 text-[10.5px] leading-relaxed text-amber-300">
                        {item.notice}
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
                          onClick={() => retryItem(item)}
                          disabled={running}
                          className="rounded-md border border-line px-2 py-0.5 text-[10.5px] font-medium hover:bg-white/5 disabled:opacity-40"
                        >
                          Retry
                        </button>
                      </div>
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
        Videos stay private while UFOLOAD receives, downloads or encodes them. Each one is published automatically as soon as UFOLOAD reports it ready — you
        can leave this page: unfinished videos keep processing at UFOLOAD and are finished by the scheduled reconcile job or the next time an admin opens this
        page (see DEPLOYMENT.md). Embedded iframes have nothing to process, so they publish immediately.
      </p>
    </div>
  );
}
