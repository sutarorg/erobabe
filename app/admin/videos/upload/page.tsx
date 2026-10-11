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
import { postJson } from "@/src/utils/api";
import { splitEmbedEntries, splitUrlEntries } from "@/lib/video/entries";
import { uploadFormDirect, uploadWithProgress, UploadAbortedError } from "@/src/utils/uploadFile";
import { parseUqloadUploadResponse } from "@/lib/video/uqload-response";
import { normalizeTitle } from "@/lib/video/uqload-match";
import {
  DEFAULT_LINK_BYTES_PER_SECOND,
  estimateTransferFraction,
  formatBytesPerSecond,
  formatEta,
  ratePerActiveUpload,
  readRememberedLinkRate,
  rememberLinkRate,
} from "@/src/utils/uploadProgress";

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
  /**
   * Uqload library file codes captured right before this item's upload — the
   * diff base the confirmation (and the "Re-check library" action) works from.
   * `null` means the snapshot failed, so the confirmation must not guess.
   */
  knownCodes?: string[] | null;
};

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;
const MAX_UQLOAD_SNAPSHOT = 300 * 1024;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|mkv|avi|wmv|flv|ts|mpg|mpeg|3gp)$/i;

/**
 * How many videos move through the pipeline at the same time.
 *
 * The old pipeline was strictly sequential: with five files, the second one
 * only started after the first had been uploaded, confirmed, and published.
 * Three concurrent transfers keep a normal uplink busy without starving any
 * single file (see `ratePerActiveUpload`).
 */
const UPLOAD_CONCURRENCY = 3;

/**
 * A thumbnail this small uploads before the video starts, so its real byte
 * progress can drive the first slice of the bar. Bigger ones are pushed in the
 * background while the video bytes travel, so they never hold up the upload.
 */
const THUMBNAIL_INLINE_MAX_BYTES = 1024 * 1024;

/** Bar windows (percent) for the four legs of a file upload. */
const THUMBNAIL_WINDOW = 8;
const TRANSFER_FROM = 10;
const TRANSFER_TO = 88;
const CONFIRM_FROM = 90;
const CONFIRM_TO = 96;
const METADATA_FROM = 97;

/**
 * Rough fixed cost per video besides its own bytes: session, library snapshot,
 * the confirmation window, and Gemini metadata. Only used for the batch ETA.
 */
const PER_ITEM_OVERHEAD_SECONDS = 8;

/**
 * How often to poll the Uqload library for a just-sent upload, and how long to
 * wait between polls. Polls back off because Uqload meters `file/list`
 * requests — one request per poll, plus a single pre-upload snapshot per file —
 * but the whole window is deliberately short: the file normally appears within
 * a second or two, and the previous schedule (2s + 2.5s + 3s…) kept the admin
 * waiting up to ~40s after the bytes had already left.
 */
const UQLOAD_CONFIRM_ATTEMPTS = 11;
const UQLOAD_CONFIRM_BACKOFF_MS = [400, 700, 1000, 1300, 1600, 1900, 2200, 2500, 2800, 3100];

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

/**
 * True when two queued files would land in Uqload under the same title —
 * `clip.mp4` and `clip.mkv` both become `clip`.
 *
 * Uqload stores the title derived from the file name and never returns the
 * upload server's response to the browser, so an upload is claimed by diffing
 * the library against a pre-upload snapshot and ranking the new entries by
 * title. Two identical titles could therefore be matched to the wrong — or
 * even the same — file code if both files were in flight together, so such a
 * batch falls back to one upload at a time.
 */
function hasDuplicateUploadTitles(items: Item[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.file) continue;
    const key = normalizeTitle(item.file.name);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Uqload serves its upload servers over HTTPS. An `http://` endpoint on an
 * `https://` admin page is blocked as mixed content before a single byte
 * leaves, which looks exactly like the CORS-hidden response the confirmation
 * step exists for. Upgrade it instead of failing silently.
 */
function secureUploadServerUrl(serverUrl: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "https:" && serverUrl.startsWith("http://")) {
    return `https://${serverUrl.slice("http://".length)}`;
  }
  return serverUrl;
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

/**
 * One bar per queued video. A determinate bar (with the percentage spelled out)
 * while a known or estimated amount of work is left, and a pulsing full bar for
 * the few steps that genuinely have nothing to measure.
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
  /**
   * Uplink throughput this browser measured on previous uploads. Only used to
   * seed the estimate shown while the bytes are travelling — the bar switches to
   * real provider confirmation as soon as the request completes.
   */
  const linkRateRef = useRef(DEFAULT_LINK_BYTES_PER_SECOND);
  /** `setInterval` ids for the per-item transfer meters, keyed by item id. */
  const metersRef = useRef(new Map<string, number>());
  /** How many transfers are in flight right now (they share one uplink). */
  const activeTransfersRef = useRef(0);

  useEffect(() => {
    linkRateRef.current = readRememberedLinkRate() ?? DEFAULT_LINK_BYTES_PER_SECOND;
  }, []);

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

  const stopTransferMeter = useCallback((id: string) => {
    const timer = metersRef.current.get(id);
    if (timer === undefined) return;
    window.clearInterval(timer);
    metersRef.current.delete(id);
  }, []);

  const stopAllTransferMeters = useCallback(() => {
    for (const timer of metersRef.current.values()) window.clearInterval(timer);
    metersRef.current.clear();
  }, []);

  /**
   * Advances one row's bar while its video bytes are on the wire.
   *
   * Uqload's upload server answers no CORS preflight, so the browser cannot say
   * how many bytes have been sent (registering a progress listener would turn
   * the request into a preflighted one that Uqload never answers). The meter
   * therefore moves on an estimate built from the file size and this browser's
   * measured throughput, reports the implied speed and remaining time, and is
   * always replaced by the real confirmation as soon as the request settles.
   */
  const startTransferMeter = useCallback(
    (id: string, fileSize: number, activeUploads: number) => {
      stopTransferMeter(id);
      const perUploadRate = ratePerActiveUpload(linkRateRef.current, activeUploads);
      const expectedMs = Math.max(1, (fileSize / perUploadRate) * 1000);
      const startedAt = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startedAt;
        const fraction = estimateTransferFraction(elapsed, expectedMs);
        const percent = TRANSFER_FROM + (TRANSFER_TO - TRANSFER_FROM) * fraction;
        // Same number the bar renders — one percentage per row, never two.
        const eta =
          elapsed > expectedMs
            ? `taking longer than estimated (${formatEta(elapsed / 1000)} so far)`
            : `about ${formatEta((expectedMs - elapsed) / 1000)} left (estimated)`;
        patchItem(id, {
          phase: "uploading",
          percent,
          waiting: false,
          detail: `Uploading to Uqload — ${Math.round(percent)}% · ${formatBytesPerSecond(perUploadRate)} · ${eta}`,
        });
      };
      tick();
      metersRef.current.set(id, window.setInterval(tick, 500));
    },
    [patchItem, stopTransferMeter]
  );

  /** Never leave a meter ticking after the grid unmounts. */
  useEffect(() => () => stopAllTransferMeters(), [stopAllTransferMeters]);

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

  /** A snapshot of the account's file codes, taken before the bytes are sent. */
  async function snapshotUqloadLibrary(): Promise<string[] | null> {
    try {
      const result = await postJson<{ fileCodes?: string[] }>("/api/videos/uqload-confirm", { mode: "snapshot" });
      return Array.isArray(result?.fileCodes) ? result.fileCodes : null;
    } catch {
      // Without a snapshot the confirmation can still match by title — it just
      // refuses to fall back to "the newest new file" at the deadline.
      return null;
    }
  }

  /**
   * Confirms a video the browser just POSTed straight to Uqload and returns
   * its file code.
   *
   * Uqload's upload server does not send CORS headers, so the browser cannot
   * read the JSON response that carries the file code. Instead the upload is
   * confirmed server-side by diffing the account library against the
   * pre-upload snapshot. Uqload ignores multipart fields sent after the `file`
   * part, so the stored title is derived from the file name — the title can
   * rank candidates, but it never identifies the file on its own.
   */
  async function confirmUqloadUpload(opts: {
    fileTitle: string;
    fileName: string;
    knownCodes: string[] | null;
    controller: AbortController;
    /** Called before each poll so the row can show how far the check has got. */
    onAttempt?: (attempt: number, attempts: number, elapsedSeconds: number) => void;
  }): Promise<string> {
    let lastPollError: unknown = null;
    const startedAt = Date.now();

    for (let attempt = 0; attempt < UQLOAD_CONFIRM_ATTEMPTS; attempt++) {
      if (opts.controller.signal.aborted) throw new UploadAbortedError();
      if (attempt > 0) {
        const delay = UQLOAD_CONFIRM_BACKOFF_MS[Math.min(attempt - 1, UQLOAD_CONFIRM_BACKOFF_MS.length - 1)];
        await abortableSleep(delay, opts.controller.signal);
      }
      opts.onAttempt?.(attempt + 1, UQLOAD_CONFIRM_ATTEMPTS, (Date.now() - startedAt) / 1000);

      try {
        const result = await postJson<{ found: boolean; fileCode?: string }>("/api/videos/uqload-confirm", {
          fileTitle: opts.fileTitle,
          fileName: opts.fileName,
          knownFileCodes: opts.knownCodes,
          finalAttempt: attempt === UQLOAD_CONFIRM_ATTEMPTS - 1,
        });
        if (result?.found && result.fileCode) return String(result.fileCode);
      } catch (pollError) {
        if (pollError instanceof UploadAbortedError) throw pollError;
        // Transient failure (network blip, cold function) — retry below, but
        // remember it: if every check failed the message must say so instead
        // of blaming the upload (e.g. a metered/API error on file/list).
        lastPollError = pollError;
        continue;
      }
    }
    const pollNote =
      lastPollError instanceof Error && lastPollError.message ? ` Last library check failed: ${lastPollError.message}` : "";
    throw new Error(
      `Uqload has not confirmed this file in your library. Use “Re-check library” — if it never shows up there, the upload did not reach your Uqload account.${pollNote}`
    );
  }

  async function publishFileItem(item: Item, controller: AbortController) {
    if (!item.file) throw new Error("Missing file");
    const file = item.file;

    // `item` is a snapshot taken when publishing started, so the resolved
    // thumbnail path has to be carried in a local — reading it back off `item`
    // would silently drop the thumbnail.
    let thumbnailPath = item.thumbnailPath;

    patchItem(item.id, { phase: "uploading", percent: 1, waiting: false, detail: "Preparing the upload…" });

    // Everything that must happen before the first video byte moves — the
    // thumbnail in Supabase Storage, the Uqload upload server, and the library
    // snapshot the confirmation diffs against — runs in parallel instead of one
    // after another, so the bytes start flowing several round trips sooner.
    //
    // The snapshot still has to *finish* before the POST starts: it is the diff
    // baseline, so a file that landed while it was being read would be treated
    // as pre-existing and never confirmed.
    const smallThumbnail = Boolean(item.thumbnail && item.thumbnail.size <= THUMBNAIL_INLINE_MAX_BYTES);
    const thumbnailPromise = uploadThumbnailFile(item, controller, (percent) => {
      if (smallThumbnail) patchItem(item.id, { percent: Math.round(percent * (THUMBNAIL_WINDOW / 100)) });
    });
    // A big thumbnail keeps uploading *behind* the video bytes instead of
    // holding them back; the swallow-catch only prevents a warning if this leg
    // fails while the caller is already erroring out elsewhere.
    thumbnailPromise.catch(() => {});

    const [session, knownCodes] = await Promise.all([
      postJson<{ serverUrl: string; fields: Record<string, string> }>("/api/videos/uqload-session", {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      }),
      snapshotUqloadLibrary(),
    ]);
    if (!session?.serverUrl) throw new Error("Uqload did not return an upload server");
    patchItem(item.id, { knownCodes });

    if (item.thumbnail && smallThumbnail) {
      thumbnailPath = await thumbnailPromise;
      if (thumbnailPath) patchItem(item.id, { thumbnailPath, percent: THUMBNAIL_WINDOW });
    }

    const fileTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 160) || file.name;

    // ⚠️ Scalars must be appended BEFORE the file part: Uqload ignores every
    // multipart field that arrives after `file` — a `file_title` sent behind
    // the file is dropped and the stored title falls back to the file name.
    // `snapshot` stays last, exactly like Uqload's own curl sample.
    const form = new FormData();
    for (const [name, value] of Object.entries(session.fields || {})) form.append(name, value);
    form.append("file_title", fileTitle);
    form.append("file", file, file.name);
    if (item.thumbnail && item.thumbnail.size <= MAX_UQLOAD_SNAPSHOT) {
      form.append("snapshot", item.thumbnail, item.thumbnail.name);
    }

    // No byte progress is possible for a direct upload — registering an
    // upload progress listener would force a CORS preflight that Uqload does
    // not answer, cancelling the request before a single byte is sent. The
    // meter below estimates the remaining time from this browser's measured
    // throughput, and the row switches to real provider confirmation the moment
    // the request settles.
    const transferStartedAt = Date.now();
    activeTransfersRef.current += 1;
    const concurrentTransfers = activeTransfersRef.current;
    startTransferMeter(item.id, file.size, concurrentTransfers);
    let outcome;
    try {
      outcome = await uploadFormDirect(secureUploadServerUrl(session.serverUrl), form, { signal: controller.signal });
    } finally {
      activeTransfersRef.current = Math.max(0, activeTransfersRef.current - 1);
      stopTransferMeter(item.id);
    }

    // Learn this browser's real uplink speed for the next estimate: the
    // observed per-file rate is scaled back up by how many transfers shared the
    // link, and a suspiciously fast "upload" (a connection that died in under a
    // second) is ignored rather than allowed to poison the estimate.
    const transferSeconds = (Date.now() - transferStartedAt) / 1000;
    if (transferSeconds >= 1) {
      linkRateRef.current = rememberLinkRate((file.size / transferSeconds) * concurrentTransfers) ?? linkRateRef.current;
    }

    // A large thumbnail travelled behind the video bytes — collect it now; it
    // has to be in storage before the video row is created.
    if (item.thumbnail && !smallThumbnail) {
      thumbnailPath = await thumbnailPromise;
      if (thumbnailPath) patchItem(item.id, { thumbnailPath });
    }

    let fileCode: string;
    if (outcome.responseText) {
      // Readable response (same-origin proxy, or Uqload adds CORS headers).
      fileCode = parseUqloadUploadResponse(outcome.responseText).filecode;
    } else {
      // The bytes left the browser but the response is unreadable (Uqload
      // omits CORS headers) — confirm the upload against the library snapshot.
      fileCode = await confirmUqloadUpload({
        fileTitle,
        fileName: file.name,
        knownCodes,
        controller,
        onAttempt: (attempt, attempts, elapsedSeconds) => {
          const progress = attempt / attempts;
          patchItem(item.id, {
            percent: CONFIRM_FROM + (CONFIRM_TO - CONFIRM_FROM) * progress,
            waiting: false,
            detail:
              attempt === 1
                ? `Sent — checking your Uqload library for the file…`
                : `Sent — still waiting for Uqload to list the file (check ${attempt} of ${attempts}, ${formatEta(
                    elapsedSeconds
                  )})…`,
          });
        },
      });
    }

    await publishKnownFile(item, fileCode, thumbnailPath);
  }

  /** Publishes an item whose file code is already known (fresh or re-checked). */
  async function publishKnownFile(item: Item, fileCode: string, thumbnailPath: string | null) {
    patchItem(item.id, { phase: "processing", percent: METADATA_FROM, detail: "Generating AI metadata…" });
    const json = await postJson<any>("/api/videos/upload", {
      providerFileId: fileCode,
      thumbnailPath: thumbnailPath || null,
      categoryId,
      fileName: item.file?.name || item.source,
      fileSize: item.file?.size,
    });

    if (json.metadataSource === "fallback") fallbackRef.current += 1;

    patchItem(item.id, {
      phase: "published",
      percent: 100,
      detail:
        json.metadataSource === "fallback"
          ? "Published · AI metadata unavailable — file-name metadata used, please review"
          : json.processing
            ? "Published · provider is still encoding"
            : "Published",
      title: json.metadata?.title,
      slug: json.video?.slug,
      metadataWarning: json.metadataWarning || undefined,
    });
  }

  /**
   * Claims a file that landed in the Uqload library after the confirmation
   * window closed — without re-uploading the bytes.
   */
  async function recheckLibrary(item: Item) {
    if (!item.file) return;
    const fileTitle = item.file.name.replace(/\.[^.]+$/, "").slice(0, 160) || item.file.name;
    setError("");
    patchItem(item.id, {
      phase: "processing",
      percent: CONFIRM_FROM,
      waiting: false,
      detail: "Re-checking the Uqload library…",
      error: undefined,
    });
    try {
      const fileCode = await confirmUqloadUpload({
        fileTitle,
        fileName: item.file.name,
        knownCodes: item.knownCodes ?? null,
        controller: new AbortController(),
        onAttempt: (attempt, attempts, elapsedSeconds) => {
          patchItem(item.id, {
            percent: CONFIRM_FROM + (CONFIRM_TO - CONFIRM_FROM) * (attempt / attempts),
            detail: `Re-checking the Uqload library (check ${attempt} of ${attempts}, ${formatEta(elapsedSeconds)})…`,
          });
        },
      });
      await publishKnownFile(item, fileCode, item.thumbnailPath);
    } catch (recheckError: any) {
      patchItem(item.id, {
        phase: "failed",
        percent: 100,
        detail: "Failed",
        error: recheckError.message || "Still not in the Uqload library",
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

    patchItem(item.id, { phase: "processing", percent: 70, detail: "Generating AI metadata…" });
    const json = await postJson<any>(endpoint, {
      categoryId,
      entries: [{ [payloadKey]: item.source, thumbnailPath: thumbnailPath || null }],
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
    stopAllTransferMeters();

    // Reset anything that failed on a previous attempt.
    for (const item of pending) {
      patchItem(item.id, { phase: "idle", percent: 0, waiting: false, detail: "Queued", error: undefined });
    }

    // Pull from a shared queue with a few workers: the second and third video
    // no longer wait for the first to be uploaded, confirmed, and published.
    // Files that share a title go one at a time so each keeps its own file code.
    const queue = [...pending];
    const concurrency = hasDuplicateUploadTitles(pending) ? 1 : UPLOAD_CONCURRENCY;
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
          if (publishError instanceof UploadAbortedError) {
            stopTransferMeter(item.id);
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

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

    stopAllTransferMeters();
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
    // Aborting stops every in-flight XHR/fetch; the summary in `publishAll`
    // then reports the cancellation once the workers have drained.
    abortRef.current?.abort();
  }

  const modes: { key: UploadMode; label: string; icon: typeof CloudUpload; description: string }[] = [
    {
      key: "files",
      label: "Upload videos",
      icon: CloudUpload,
      description: `Files POST directly to Uqload from your browser — they never touch our storage bucket, and up to ${UPLOAD_CONCURRENCY} upload at once.`,
    },
    { key: "embed", label: "Embed by iframe", icon: PlaySquare, description: "Publish trusted iframe sources, each with its own thumbnail." },
    { key: "url", label: "Upload by link", icon: Link2, description: "Send direct video URLs to Uqload, each with its own thumbnail." },
  ];

  const pastePlaceholder =
    mode === "embed"
      ? 'https://player.example.com/embed/abc\n—or—\n<iframe src="https://player.example.com/embed/abc" allowfullscreen></iframe>'
      : "https://cdn.example.com/video-one.mp4\nhttps://cdn.example.com/video-two.mp4";

  const publishedCount = items.filter((item) => item.phase === "published").length;
  /** Same-title files upload one at a time (see `hasDuplicateUploadTitles`). */
  const batchSerialized = hasDuplicateUploadTitles(items);
  /** Items the batch no longer has to wait for: published or failed. */
  const finishedCount = items.filter((item) => item.phase === "published" || item.phase === "failed").length;
  const pendingItems = items.filter((item) => item.phase !== "published" && item.phase !== "failed");

  /** Mean of the per-video bars — the honest "how far is the batch" number. */
  const batchPercent = items.length
    ? items.reduce((sum, item) => sum + (item.phase === "published" ? 100 : Math.max(0, item.percent)), 0) / items.length
    : 0;

  /**
   * Batch ETA: everything still to push, minus the part of an in-flight
   * transfer the estimated bar says has already gone, plus the fixed per-video
   * cost (session, snapshot, confirmation window, Gemini metadata) amortised
   * over the workers running in parallel.
   */
  const remainingBatchBytes = pendingItems.reduce((sum, item) => {
    const size = item.file?.size ?? 0;
    if (!size) return sum;
    const sent = activeTransfersRef.current > 0 && item.percent > TRANSFER_FROM && item.percent <= TRANSFER_TO
      ? (item.percent - TRANSFER_FROM) / (TRANSFER_TO - TRANSFER_FROM)
      : 0;
    return sum + size * (1 - sent);
  }, 0);
  const batchEtaSeconds =
    remainingBatchBytes / Math.max(1, linkRateRef.current) +
    Math.ceil(pendingItems.length / UPLOAD_CONCURRENCY) * PER_ITEM_OVERHEAD_SECONDS;

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
                Files upload directly to Uqload, so large videos are fine, and up to {UPLOAD_CONCURRENCY} of them travel at the same time. Each row
                shows its own progress bar with the throughput and time remaining, then switches to the provider’s confirmation. Uqload’s upload
                server doesn’t answer the CORS preflight a byte-accurate bar would need, so the transfer percentage is an estimate based on this
                browser’s measured upload speed.
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
                        {item.kind === "file" && (
                          <button
                            type="button"
                            onClick={() => recheckLibrary(item)}
                            disabled={running}
                            className="rounded-md border border-line px-2 py-0.5 text-[10.5px] font-medium hover:bg-white/5 disabled:opacity-40"
                          >
                            Re-check library
                          </button>
                        )}
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
                {activeTransfersRef.current > 0
                  ? ` · ${activeTransfersRef.current} uploading at ~${formatBytesPerSecond(
                      ratePerActiveUpload(linkRateRef.current, activeTransfersRef.current)
                    )}`
                  : ""}
              </span>
              <span className="tabular-nums">about {formatEta(batchEtaSeconds)} left (estimated)</span>
            </div>
            {batchSerialized && (
              <p className="mt-1 text-[10.5px] text-ink-3">
                Some files share a title, so they are uploaded one at a time — that keeps each Uqload file code matched to the right video.
              </p>
            )}
            <ProgressBar percent={batchPercent} phase="uploading" />
          </div>
        )}

        {error && <p className="mt-5 rounded-md bg-red-500/10 p-3 text-[12px] text-red-300">{error}</p>}
        {notice && !error && <p className="mt-5 rounded-md bg-emerald-500/10 p-3 text-[12px] text-emerald-300">{notice}</p>}
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        A publish action makes the video public immediately. Uqload may still be encoding a newly uploaded or imported file; the public player becomes
        playable as soon as the provider finishes processing. While a file travels to Uqload the row shows an estimated transfer percentage, the
        throughput, and the time remaining; each finished upload teaches the page this browser&apos;s real upload speed, so the next estimate is closer.
      </p>
    </div>
  );
}
