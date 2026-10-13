"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ImagePlus,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/src/utils/api";
import { splitUrlEntries } from "@/lib/video/entries";
import { classifyVideoSource, type VideoSourceKind } from "@/lib/video/links";
import { uploadWithProgress } from "@/src/utils/uploadFile";

type Category = { id: string; label: string };
type Phase = "idle" | "uploading" | "processing" | "published" | "failed";

type Item = {
  id: string;
  source: string;
  /** `direct` = media file (native player), `embed` = player page (iframe). */
  kind: VideoSourceKind;
  /** Lower-cased host, shown on the entry badge. */
  host?: string;
  /** Why the entry was classified this way. */
  note?: string;
  thumbnail: File | null;
  thumbnailPreview: string | null;
  thumbnailPath: string | null;
  phase: Phase;
  detail: string;
  waiting?: boolean;
  error?: string;
  metadataWarning?: string;
  title?: string;
  slug?: string;
  videoId?: string;
};

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;
const MAX_URLS = 20;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Mode override for one entry — the admin can always outvote the detection. */
function modeLabel(kind: VideoSourceKind) {
  return kind === "embed" ? "Embed player" : "Direct file";
}

export default function UploadPage() {
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

  const categoryLabel = useMemo(
    () => categories.find((c) => c.id === categoryId)?.label,
    [categories, categoryId]
  );

  const patchItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  function applyPaste() {
    const entries = splitUrlEntries(pasteBuffer);
    if (!entries.length) return;

    // Validate and deduplicate client-side. Full validation happens
    // server-side — this exists so the admin sees inline errors before
    // submitting, and so each link is routed to the right publishing route.
    const seen = new Set(items.map((item) => item.source.trim().toLowerCase()));
    const valid: Item[] = [];
    const invalid: string[] = [];

    for (const entry of entries) {
      let classified;
      try {
        classified = classifyVideoSource(entry);
      } catch (classificationError: any) {
        invalid.push(`${entry} (${classificationError.message || "not a usable video link"})`);
        continue;
      }

      const normalized = classified.url.trim().toLowerCase();
      if (seen.has(normalized)) {
        invalid.push(`${entry} (duplicate)`);
        continue;
      }
      seen.add(normalized);
      valid.push({
        id: newId(),
        source: classified.url,
        kind: classified.kind,
        host: classified.host,
        note: classified.note,
        thumbnail: null,
        thumbnailPreview: null,
        thumbnailPath: null,
        phase: "idle",
        detail: classified.kind === "embed" ? "Ready to publish as an embed" : "Ready to publish",
      });
    }

    if (valid.length) {
      setItems((current) => [...current, ...valid]);
    }
    setPasteBuffer("");

    if (invalid.length) {
      setError(`Skipped ${invalid.length} invalid entr${invalid.length > 1 ? "ies" : "y"}: ${invalid.join("; ")}`);
    } else {
      setError("");
    }
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

  /** Uploads a thumbnail to Supabase Storage and returns its object path. */
  async function uploadThumbnailFile(item: Item, controller: AbortController): Promise<string | null> {
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
    });
    return target.storagePath;
  }

  async function publishItem(item: Item, controller: AbortController) {
    let thumbnailPath = item.thumbnailPath;

    // Upload thumbnail if present.
    if (item.thumbnail && !thumbnailPath) {
      patchItem(item.id, { phase: "uploading", detail: "Uploading thumbnail…" });
      thumbnailPath = await uploadThumbnailFile(item, controller);
      patchItem(item.id, { thumbnailPath });
    }

    const isEmbed = item.kind === "embed";
    patchItem(item.id, {
      phase: "processing",
      waiting: true,
      detail: isEmbed ? "Embedding the player & generating AI metadata…" : "Generating AI metadata…",
    });

    // Direct files go through the direct-URL route; player pages (Streamtape
    // `/v/…`, iframe markup, …) go through the embed route. Both generate the
    // metadata server-side and answer with the same per-entry shape.
    const json = isEmbed
      ? await postJson<any>("/api/videos/embed", {
          categoryId,
          entries: [{ source: item.source, thumbnailPath: thumbnailPath || null }],
        })
      : await postJson<any>("/api/videos/upload-url", {
          categoryId,
          entries: [{ url: item.source, thumbnailPath: thumbnailPath || null }],
        });

    const result = json.results?.[0];
    if (!result || result.status === "failed") {
      throw new Error(result?.error || json.error || "Unable to publish");
    }

    if (result.metadataSource === "fallback") fallbackRef.current += 1;

    const savedAs = isEmbed ? "Published · player embedded" : "Published · video URL saved";

    patchItem(item.id, {
      phase: "published",
      waiting: false,
      detail:
        result.metadataSource === "fallback"
          ? `${savedAs} · AI metadata unavailable — file-name metadata used, please review`
          : savedAs,
      title: result.title,
      slug: result.slug,
      videoId: result.videoId,
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
      setError("Add at least one video URL first.");
      return;
    }

    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    fallbackRef.current = 0;

    // Reset anything that failed on a previous attempt.
    for (const item of pending) {
      patchItem(item.id, { phase: "idle", detail: "Queued", error: undefined });
    }

    let failures = 0;
    const settled = new Set<string>();

    // Process items sequentially — there is no file transfer to parallelise.
    for (const item of pending) {
      if (controller.signal.aborted) break;
      try {
        await publishItem(item, controller);
      } catch (publishError: any) {
        failures += 1;
        patchItem(item.id, {
          phase: "failed",
          waiting: false,
          detail: "Failed",
          error: publishError.message || "Publishing failed",
        });
      }
      settled.add(item.id);
    }

    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) {
      for (const item of pending) {
        if (settled.has(item.id)) continue;
        patchItem(item.id, { phase: "idle", detail: "Cancelled — ready to publish" });
      }
      setNotice("Publishing cancelled. Finished items were kept.");
      return;
    }

    const fallbacks = fallbackRef.current;
    const fallbackNote = fallbacks
      ? ` ${fallbacks} used file-name metadata because the AI was unavailable — review those titles and descriptions.`
      : "";
    if (failures) {
      setError(
        `${failures} item${failures > 1 ? "s" : ""} could not be published. See the inline messages.${fallbackNote}`
      );
    } else {
      setNotice(`All videos were published.${fallbackNote}`);
    }
  }

  function cancelPublish() {
    abortRef.current?.abort();
  }

  const publishedCount = items.filter((item) => item.phase === "published").length;

  return (
    <div className="max-w-5xl">
      <div>
        <h1 className="text-[20px] font-semibold">Publish videos by link</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          Paste direct video URLs or player-page links below. Erobabe saves the link and plays the video straight from the
          original host — it does not download, upload, or re-encode the file. You control the category and each
          video&apos;s optional thumbnail; Gemini generates the title, description, and tags.
        </p>
      </div>

      <form onSubmit={publishAll} className="mt-6 rounded-lg border border-line bg-pcard p-5">
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

        {/* ---- Notice about the direct-URL workflow ---- */}
        <div className="mt-5 rounded-lg border border-accent/20 bg-accent/[0.04] p-4">
          <div className="flex items-start gap-2">
            <Link2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="text-[12px] font-medium text-accent">How it works</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                Erobabe saves the video URL you paste — it does not upload or host the video file. The original video host
                remains responsible for serving the media. Paste one link per line (up to {MAX_URLS} at a time); each line
                becomes its own entry with its own optional thumbnail. Direct video files (ending in .mp4, .webm, .ts, …)
                play in Erobabe&apos;s own player; player pages such as Streamtape{" "}
                <code className="font-mono">/v/&lt;id&gt;/Name.mp4.ts.mp4</code> are embedded as an iframe automatically.
                Markdown links, angle-bracket links, and pasted <code className="font-mono">&lt;iframe&gt;</code> code are
                accepted too — for example{" "}
                <code className="font-mono">[https://streamtape.com/v/abc/Hands_Only.mp4.ts.mp4](https://streamtape.com/v/abc/Hands_Only.mp4.ts.mp4)</code>.
              </p>
            </div>
          </div>
        </div>

        {/* ---- Add URLs ---- */}
        <div className="mt-5 rounded-lg border border-dashed border-line bg-void p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Video URLs or player links</span>
            <textarea
              value={pasteBuffer}
              onChange={(event) => setPasteBuffer(event.target.value)}
              rows={5}
              className="w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-[12px]"
              placeholder={
                "https://video.example.com/video7/717/70.mp4\n[https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4](https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4)\n<iframe src=\"https://host.example/embed/abc123\" allowfullscreen></iframe>"
              }
            />
            <span className="mt-1 block text-[10.5px] text-ink-3">
              One link per line (up to {MAX_URLS}). Direct file links, Markdown links, player pages (Streamtape, Uqload,
              DoodStream, …) and iframe embed code are all accepted and routed automatically.
            </span>
          </label>
          <button
            type="button"
            onClick={applyPaste}
            disabled={!pasteBuffer.trim()}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[12px] font-semibold hover:bg-card-hover disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add link{pasteBuffer.includes("\n") ? "s" : ""}
          </button>
        </div>

        {/* ---- Per-video rows ---- */}
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

                  {/* Source URL + status */}
                  <div className="min-w-[220px] flex-1">
                    {(item.note || item.host) && (
                      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-3">
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-medium ${
                            item.kind === "embed" ? "bg-accent/15 text-accent" : "bg-white/5 text-ink-2"
                          }`}
                        >
                          {modeLabel(item.kind)}
                        </span>
                        {item.note}
                      </p>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-medium text-ink-3">Video URL</span>
                      <input
                        value={item.source}
                        onChange={(event) => {
                          const next = event.target.value;
                          let patch: Partial<Item> = { source: next };
                          try {
                            const detected = classifyVideoSource(next);
                            patch = {
                              source: detected.url,
                              kind: detected.kind,
                              host: detected.host,
                              note: detected.note,
                            };
                          } catch {
                            // Leave the text as typed; publishing reports the real problem.
                          }
                          patchItem(item.id, patch);
                        }}
                        disabled={running || item.phase === "published"}
                        className="w-full rounded-md border border-line bg-card px-2.5 py-1.5 font-mono text-[11px] disabled:opacity-60"
                      />
                    </label>

                    {/* Manual override — the admin always outvotes detection. */}
                    <div className="mt-1 flex items-center gap-1">
                      {(["direct", "embed"] as VideoSourceKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => patchItem(item.id, { kind, note: `Manually set to ${modeLabel(kind)}` })}
                          disabled={running || item.phase === "published"}
                          aria-pressed={item.kind === kind}
                          className={`h-6 rounded px-2 text-[10px] font-medium disabled:opacity-50 ${
                            item.kind === kind
                              ? "bg-accent/20 text-accent"
                              : "border border-line text-ink-3 hover:bg-white/5 hover:text-ink"
                          }`}
                        >
                          {modeLabel(kind)}
                        </button>
                      ))}
                    </div>

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
                      <p className="mt-1.5 text-[10.5px] text-red-300">{item.error}</p>
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

        {/* ---- Actions ---- */}
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
            <button
              type="button"
              onClick={cancelPublish}
              className="inline-flex h-9 items-center rounded-md border border-line px-4 text-[12px] hover:bg-white/5"
            >
              Cancel
            </button>
          )}
          {items.length > 0 && !running && (
            <button
              type="button"
              onClick={resetItems}
              className="inline-flex h-9 items-center rounded-md border border-line px-4 text-[12px] hover:bg-white/5"
            >
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
        Erobabe saves the video URL — it does not download or host the video file. The original video host is responsible
        for serving the media. If the remote host blocks hotlinking, expires the URL, or returns non-video content, the
        public player will report the failure to the viewer.
      </p>
    </div>
  );
}