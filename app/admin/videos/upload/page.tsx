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
 * How often to poll the Uqload library for a just-sent upload. Polls back off
 * because Uqload meters `file/list` requests — one request per poll, plus a
 * single pre-upload snapshot per file.
 */
const UQLOAD_CONFIRM_ATTEMPTS = 11;
const UQLOAD_CONFIRM_BACKOFF_MS = [2000, 2500, 3000, 3500, 4000, 4500, 5000, 5000, 5000, 5000];

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

export function ProgressBar({ percent, phase }: { percent: number; phase: Phase }) {
  const failed = phase === "failed";
  const done = phase === "published";
  const indeterminate = phase === "processing";
  return (
    <div className="mt-2.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            failed ? "bg-red-400" : done ? "bg-emerald-400" : "bg-accent"
          } ${indeterminate ? "animate-pulse" : ""}`}
          style={{ width: `${indeterminate ? 100 : Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
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
  }): Promise<string> {
    let lastPollError: unknown = null;
    for (let attempt = 0; attempt < UQLOAD_CONFIRM_ATTEMPTS; attempt++) {
      if (opts.controller.signal.aborted) throw new UploadAbortedError();
      if (attempt > 0) {
        const delay = UQLOAD_CONFIRM_BACKOFF_MS[Math.min(attempt - 1, UQLOAD_CONFIRM_BACKOFF_MS.length - 1)];
        await abortableSleep(delay, opts.controller.signal);
      }

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

    // `item` is a snapshot taken when publishing started, so the resolved
    // thumbnail path has to be carried in a local — reading it back off `item`
    // would silently drop the thumbnail.
    let thumbnailPath = item.thumbnailPath;

    // 0–8%: thumbnail, then an indeterminate state for the direct Uqload
    // upload (no byte progress — see uploadFormDirect), then Gemini metadata.
    if (item.thumbnail && !thumbnailPath) {
      patchItem(item.id, { phase: "uploading", detail: "Uploading thumbnail…", percent: 0 });
      thumbnailPath = await uploadThumbnailFile(item, controller, (percent) =>
        patchItem(item.id, { percent: Math.round(percent * 0.08) })
      );
      patchItem(item.id, { thumbnailPath, percent: 8 });
    }

    patchItem(item.id, { phase: "uploading", detail: "Connecting to Uqload…", percent: 10 });
    const session = await postJson<{ serverUrl: string; fields: Record<string, string> }>("/api/videos/uqload-session", {
      fileName: item.file.name,
      fileSize: item.file.size,
      mimeType: item.file.type,
    });
    if (!session?.serverUrl) throw new Error("Uqload did not return an upload server");

    const fileTitle = item.file.name.replace(/\.[^.]+$/, "").slice(0, 160) || item.file.name;

    // Snapshot the account's file codes *before* the bytes leave, so the
    // confirmation can identify the upload by diff — the stored title is only
    // a ranking hint (Uqload derives it from the file name).
    const knownCodes = await snapshotUqloadLibrary();
    patchItem(item.id, { knownCodes });

    // ⚠️ Scalars must be appended BEFORE the file part: Uqload ignores every
    // multipart field that arrives after `file` — a `file_title` sent behind
    // the file is dropped and the stored title falls back to the file name.
    // `snapshot` stays last, exactly like Uqload's own curl sample.
    const form = new FormData();
    for (const [name, value] of Object.entries(session.fields || {})) form.append(name, value);
    form.append("file_title", fileTitle);
    form.append("file", item.file, item.file.name);
    if (item.thumbnail && item.thumbnail.size <= MAX_UQLOAD_SNAPSHOT) {
      form.append("snapshot", item.thumbnail, item.thumbnail.name);
    }

    // No byte progress is possible for a direct upload — registering an
    // upload progress listener would force a CORS preflight that Uqload does
    // not answer, cancelling the request before a single byte is sent.
    patchItem(item.id, { phase: "processing", detail: "Uploading directly to Uqload…" });
    const outcome = await uploadFormDirect(secureUploadServerUrl(session.serverUrl), form, { signal: controller.signal });

    let fileCode: string;
    if (outcome.responseText) {
      // Readable response (same-origin proxy, or Uqload adds CORS headers).
      fileCode = parseUqloadUploadResponse(outcome.responseText).filecode;
    } else {
      // The bytes left the browser but the response is unreadable (Uqload
      // omits CORS headers) — confirm the upload against the library snapshot.
      patchItem(item.id, { phase: "processing", detail: "Confirming upload on Uqload…" });
      fileCode = await confirmUqloadUpload({ fileTitle, fileName: item.file.name, knownCodes, controller });
    }

    await publishKnownFile(item, fileCode, thumbnailPath);
  }

  /** Publishes an item whose file code is already known (fresh or re-checked). */
  async function publishKnownFile(item: Item, fileCode: string, thumbnailPath: string | null) {
    patchItem(item.id, { phase: "processing", percent: 90, detail: "Generating AI metadata…" });
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
    patchItem(item.id, { phase: "processing", percent: 90, detail: "Re-checking the Uqload library…", error: undefined });
    try {
      const fileCode = await confirmUqloadUpload({
        fileTitle,
        fileName: item.file.name,
        knownCodes: item.knownCodes ?? null,
        controller: new AbortController(),
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

    // Reset anything that failed on a previous attempt.
    for (const item of pending) patchItem(item.id, { phase: "idle", percent: 0, detail: "Queued", error: undefined });

    let failures = 0;
    for (const item of pending) {
      if (controller.signal.aborted) break;
      try {
        if (item.kind === "file") await publishFileItem(item, controller);
        else await publishSourceItem(item, controller);
      } catch (publishError: any) {
        if (publishError instanceof UploadAbortedError) break;
        failures += 1;
        patchItem(item.id, {
          phase: "failed",
          percent: 100,
          detail: "Failed",
          error: publishError.message || "Upload failed",
        });
      }
    }

    setRunning(false);
    abortRef.current = null;
    const fallbacks = fallbackRef.current;
    const fallbackNote = fallbacks
      ? ` ${fallbacks} used file-name metadata because the AI was unavailable — review those titles and descriptions.`
      : "";
    if (failures) setError(`${failures} item${failures > 1 ? "s" : ""} could not be published. See the inline messages.${fallbackNote}`);
    else setNotice(`All videos were published.${fallbackNote}`);
  }

  function cancelPublish() {
    abortRef.current?.abort();
    setRunning(false);
    setNotice("Publishing cancelled. Finished items were kept.");
  }

  const modes: { key: UploadMode; label: string; icon: typeof CloudUpload; description: string }[] = [
    { key: "files", label: "Upload videos", icon: CloudUpload, description: "Files POST directly to Uqload from your browser — they never touch our storage bucket." },
    { key: "embed", label: "Embed by iframe", icon: PlaySquare, description: "Publish trusted iframe sources, each with its own thumbnail." },
    { key: "url", label: "Upload by link", icon: Link2, description: "Send direct video URLs to Uqload, each with its own thumbnail." },
  ];

  const pastePlaceholder =
    mode === "embed"
      ? 'https://player.example.com/embed/abc\n—or—\n<iframe src="https://player.example.com/embed/abc" allowfullscreen></iframe>'
      : "https://cdn.example.com/video-one.mp4\nhttps://cdn.example.com/video-two.mp4";

  const publishedCount = items.filter((item) => item.phase === "published").length;

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
                Files upload directly to Uqload, so large videos are fine. Each one gets AI metadata and its own optional thumbnail. The bar pulses
                while a direct upload travels — live byte progress isn’t possible without a CORS preflight, which Uqload doesn’t answer.
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

                    {item.phase !== "idle" && <ProgressBar percent={item.percent} phase={item.phase} />}
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

        {error && <p className="mt-5 rounded-md bg-red-500/10 p-3 text-[12px] text-red-300">{error}</p>}
        {notice && !error && <p className="mt-5 rounded-md bg-emerald-500/10 p-3 text-[12px] text-emerald-300">{notice}</p>}
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        A publish action makes the video public immediately. Uqload may still be encoding a newly uploaded or imported file; the public player becomes
        playable as soon as the provider finishes processing.
      </p>
    </div>
  );
}
