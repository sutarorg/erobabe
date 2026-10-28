"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ImageOff,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";

export type AdminVideo = {
  id: string;
  slug: string;
  title: string;
  status: string;
  visibility?: string | null;
  provider?: string | null;
  requires_reupload?: boolean;
  thumbnail_url: string | null;
  playable_url?: string | null;
  embed_url?: string | null;
  source_url?: string | null;
  view_count: number | null;
  created_at: string;
  category_id?: string | null;
  category_label: string | null;
  /** Homepage carousel slot (1–3), or null when the video is not in the carousel. */
  carousel_position?: number | null;
  /** AI-written homepage card headline — max 5 words. Set with the slot. */
  carousel_title?: string | null;
  /** AI-written homepage card teaser — max 10 words. Set with the slot. */
  carousel_description?: string | null;
};

export type AdminCategory = { id: string; label: string };

const CAROUSEL_SLOTS = [1, 2, 3];
const DELETE_CHUNK = 500;

type RowState = {
  busy?: "thumbnail" | "remove" | "delete" | "carousel" | "carouselCopy" | "publish";
  editingThumb?: boolean;
  thumbDraft?: string;
  error?: string;
  notice?: string;
};

type CarouselCopyReport = {
  source: "ai" | "fallback";
  model?: string;
  trimmed?: boolean;
  stored?: boolean;
  warning?: string;
};

const CAROUSEL_TITLE_MAX_WORDS = 5;
const CAROUSEL_DESCRIPTION_MAX_WORDS = 10;

function carouselCopySummary(report: CarouselCopyReport | null): string {
  if (!report) return "";
  if (report.source === "ai") {
    return report.trimmed
      ? "AI carousel copy generated and trimmed to the card limits."
      : "AI carousel copy generated.";
  }
  return report.warning
    ? `AI carousel copy unavailable: ${report.warning}`
    : "AI carousel copy unavailable — the listing text was shortened instead.";
}

/** Human label for the catalog source of a row. */
function providerLabel(provider?: string | null): string {
  if (provider === "damplips") return "damplips";
  if (provider === "direct_url") return "Direct link";
  if (provider === "embed") return "Embed";
  if (!provider) return "Unknown source";
  return provider;
}

function statusTone(status: string): string {
  if (status === "published") return "bg-emerald-500/10 text-emerald-400";
  if (status === "pending_review") return "bg-amber-500/10 text-amber-300";
  if (status === "rejected") return "bg-red-500/10 text-red-400";
  return "bg-zinc-500/10 text-zinc-300";
}

/**
 * Admin video library.
 *
 * Uploads are gone: every row is an embedded source. This screen curates what
 * the importer brought in — publish or hide a video, replace or remove its
 * poster, place it in the homepage carousel (which writes the card's short AI
 * copy), or delete it from the catalog.
 */
export default function VideoManager({
  initialVideos,
  categories = [],
}: {
  initialVideos: AdminVideo[];
  categories?: AdminCategory[];
}) {
  const [videos, setVideos] = useState<AdminVideo[]>(initialVideos);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [bulkBusy, setBulkBusy] = useState<"" | "delete">("");
  const [bulkError, setBulkError] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");

  useEffect(() => {
    setVideos(initialVideos);
  }, [initialVideos]);

  const patchRow = (id: string, state: RowState) =>
    setRows((current) => ({ ...current, [id]: { ...current[id], ...state } }));

  const updateVideo = (id: string, changes: Partial<AdminVideo>) =>
    setVideos((current) =>
      current.map((video) => (video.id === id ? { ...video, ...changes } : video)),
    );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return videos.filter((video) => {
      if (categoryFilter && video.category_id !== categoryFilter) return false;
      if (statusFilter && video.status !== statusFilter) return false;
      if (!needle) return true;
      return [video.title, video.slug, video.category_label || ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [videos, query, categoryFilter, statusFilter]);

  const slotHolders = useMemo(() => {
    const holders: Record<number, AdminVideo | undefined> = {};
    for (const video of videos) {
      if (video.carousel_position) holders[video.carousel_position] = video;
    }
    return holders;
  }, [videos]);

  const selectedVideos = useMemo(
    () => filtered.filter((video) => selected.has(video.id)),
    [filtered, selected],
  );
  const allShownSelected = filtered.length > 0 && selectedVideos.length === filtered.length;

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allShownSelected) {
        for (const video of filtered) next.delete(video.id);
      } else {
        for (const video of filtered) next.add(video.id);
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** PATCH wrapper: applies the returned video, keeps errors on the row. */
  async function patchVideo(
    video: AdminVideo,
    body: Record<string, unknown>,
    busy: RowState["busy"],
  ): Promise<Record<string, any> | null> {
    patchRow(video.id, { busy, error: "", notice: "" });
    try {
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update the video");
      return payload;
    } catch (error) {
      patchRow(video.id, {
        busy: undefined,
        error: error instanceof Error ? error.message : "Unable to update the video",
      });
      return null;
    }
  }

  async function setCarouselSlot(video: AdminVideo, position: number | null) {
    const payload = await patchVideo(video, { carousel_position: position }, "carousel");
    if (!payload) return;
    if (position !== null) {
      // A slot holds one video: clear the previous holder locally as well.
      setVideos((current) =>
        current.map((row) => {
          if (row.id === video.id) {
            return {
              ...row,
              carousel_position: position,
              carousel_title: payload.video?.carousel_title ?? row.carousel_title,
              carousel_description:
                payload.video?.carousel_description ?? row.carousel_description,
            };
          }
          if (row.carousel_position === position) {
            return {
              ...row,
              carousel_position: null,
              carousel_title: null,
              carousel_description: null,
            };
          }
          return row;
        }),
      );
    } else {
      updateVideo(video.id, {
        carousel_position: null,
        carousel_title: null,
        carousel_description: null,
      });
    }
    const summary = carouselCopySummary((payload.carouselCopy as CarouselCopyReport) ?? null);
    patchRow(video.id, {
      busy: undefined,
      notice:
        position === null
          ? "Removed from the homepage carousel."
          : `Placed in homepage carousel slot ${position}.`,
    });
    if (summary) patchRow(video.id, { busy: undefined, notice: summary });
  }

  async function regenerateCarouselCopy(video: AdminVideo) {
    const payload = await patchVideo(video, { action: "regenerate_carousel_copy" }, "carouselCopy");
    if (!payload) return;
    updateVideo(video.id, {
      carousel_title: payload.video?.carousel_title ?? null,
      carousel_description: payload.video?.carousel_description ?? null,
    });
    patchRow(video.id, {
      busy: undefined,
      notice:
        carouselCopySummary((payload.carouselCopy as CarouselCopyReport) ?? null) ||
        "Carousel copy regenerated.",
    });
  }

  async function saveThumbnail(video: AdminVideo) {
    const draft = String(rows[video.id]?.thumbDraft ?? "").trim();
    if (!/^https?:\/\//i.test(draft)) {
      patchRow(video.id, { error: "Enter an image URL that starts with http(s)://" });
      return;
    }
    const payload = await patchVideo(video, { thumbnail_url: draft }, "thumbnail");
    if (!payload) return;
    updateVideo(video.id, { thumbnail_url: payload.video?.thumbnail_url ?? draft });
    patchRow(video.id, {
      busy: undefined,
      editingThumb: false,
      thumbDraft: "",
      error: "",
      notice: "Thumbnail updated.",
    });
  }

  async function removeThumbnail(video: AdminVideo) {
    if (typeof window !== "undefined" && !window.confirm("Remove this video's thumbnail?")) return;
    const payload = await patchVideo(video, { thumbnail_url: null }, "remove");
    if (!payload) return;
    updateVideo(video.id, { thumbnail_url: null });
    patchRow(video.id, { busy: undefined, error: "", notice: "Thumbnail removed." });
  }

  async function togglePublished(video: AdminVideo) {
    const action = video.status === "published" ? "unpublish" : "publish";
    const payload = await patchVideo(video, { action }, "publish");
    if (!payload) return;
    updateVideo(video.id, {
      status: payload.video?.status ?? (action === "publish" ? "published" : "unpublished"),
      visibility: payload.video?.visibility ?? (action === "publish" ? "public" : "private"),
    });
    patchRow(video.id, {
      busy: undefined,
      error: "",
      notice: action === "publish" ? "Published." : "Unpublished.",
    });
  }

  async function deleteVideo(video: AdminVideo) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${video.title}" from the catalog?`)) {
      return;
    }
    patchRow(video.id, { busy: "delete", error: "", notice: "" });
    try {
      const response = await fetch(`/api/admin/videos?id=${encodeURIComponent(video.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to delete the video");
      setVideos((current) => current.filter((row) => row.id !== video.id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(video.id);
        return next;
      });
    } catch (error) {
      patchRow(video.id, {
        busy: undefined,
        error: error instanceof Error ? error.message : "Unable to delete the video",
      });
    }
  }

  async function deleteSelected() {
    if (!selectedVideos.length) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete ${selectedVideos.length} selected video${selectedVideos.length === 1 ? "" : "s"} from the catalog?`,
      )
    ) {
      return;
    }

    setBulkBusy("delete");
    setBulkError("");
    setBulkNotice("");
    const ids = selectedVideos.map((video) => video.id);
    const deleted = new Set<string>();
    // Drop the rows immediately so select-all does not sit on a spinner while
    // the server finishes the SQL. Failed ids are put back below.
    setVideos((current) => current.filter((video) => !ids.includes(video.id)));
    setSelected(new Set());
    try {
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
        chunks.push(ids.slice(index, index + DELETE_CHUNK));
      }
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const response = await fetch("/api/admin/videos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: chunk }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || "Unable to delete the selected videos");
          return payload as { deleted?: string[]; failed?: Array<{ id: string }> };
        }),
      );
      for (const payload of results) {
        for (const id of payload.deleted || []) deleted.add(String(id));
        if (payload.failed?.length) {
          throw new Error(
            `${payload.failed.length} videos could not be deleted. They remain selected; retry the request.`,
          );
        }
      }
      const leftover = ids.filter((id) => !deleted.has(id));
      if (leftover.length) {
        setSelected(new Set(leftover));
      }
      setBulkNotice(`Deleted ${deleted.size} video${deleted.size === 1 ? "" : "s"}.`);
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Could not delete the selected videos");
      const restore = ids.filter((id) => !deleted.has(id));
      if (restore.length) {
        setVideos((current) => {
          const have = new Set(current.map((video) => video.id));
          return [
            ...current,
            ...selectedVideos.filter((video) => restore.includes(video.id) && !have.has(video.id)),
          ];
        });
        setSelected(new Set(restore));
      }
    } finally {
      setBulkBusy("");
    }
  }

  const carouselCount = CAROUSEL_SLOTS.filter((slot) => slotHolders[slot]).length;

  return (
    <div>
      {/* ---- Homepage carousel slots ---- */}
      <section aria-label="Homepage carousel" className="mt-5 rounded-lg border border-line bg-pcard p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Star aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
              Homepage carousel
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Pick up to three videos for the top card on the homepage. Each slot
              gets its own short AI copy when it is assigned — a headline of at
              most {CAROUSEL_TITLE_MAX_WORDS} words and a description of at most{" "}
              {CAROUSEL_DESCRIPTION_MAX_WORDS} words.{" "}
              {carouselCount ? `${carouselCount} of 3 slots filled.` : "No slots filled — the default artwork is shown."}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {CAROUSEL_SLOTS.map((slot) => {
            const holder = slotHolders[slot];
            return (
              <div key={slot} className="flex items-center gap-2.5 rounded-md border border-line bg-void p-2">
                <div className="w-[72px] shrink-0 overflow-hidden rounded border border-line">
                  {holder?.thumbnail_url ? (
                    <img src={holder.thumbnail_url} alt="" className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center text-ink-3">
                      <ImageOff aria-hidden="true" className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Slot {slot}</p>
                  {holder ? (
                    <>
                      <p className="truncate text-[12px] font-medium">{holder.title}</p>
                      <p className="mt-1 rounded border border-line bg-panel px-1.5 py-1">
                        <span className="block text-[9px] font-semibold uppercase tracking-wider text-ink-3">
                          Card copy
                        </span>
                        <span className="mt-0.5 block text-[11px] font-medium text-ink">
                          {holder.carousel_title || "—"}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-2">
                          {holder.carousel_description || "—"}
                        </span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void regenerateCarouselCopy(holder)}
                          disabled={rows[holder.id]?.busy === "carousel" || rows[holder.id]?.busy === "carouselCopy"}
                          className="inline-flex items-center gap-1 text-[10.5px] text-accent hover:underline disabled:opacity-50"
                        >
                          {rows[holder.id]?.busy === "carouselCopy" ? (
                            <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles aria-hidden="true" className="h-3 w-3" />
                          )}
                          Regenerate copy
                        </button>
                        <button
                          type="button"
                          onClick={() => void setCarouselSlot(holder, null)}
                          disabled={rows[holder.id]?.busy === "carousel" || rows[holder.id]?.busy === "carouselCopy"}
                          className="text-[10.5px] text-ink-3 underline hover:text-ink disabled:opacity-50"
                        >
                          Clear slot
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-ink-3">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Toolbar ---- */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] max-w-sm flex-1">
          <Search aria-hidden="true" className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-3" />
          <input
            type="search"
            aria-label="Search videos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, slug, or category"
            className="h-9 w-full rounded-md border border-line bg-void pl-8 pr-3 text-[12px]"
          />
        </label>
        {categories.length > 0 && (
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-9 rounded-md border border-line bg-void px-2 text-[12px]"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-9 rounded-md border border-line bg-void px-2 text-[12px]"
        >
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
          <option value="pending_review">Pending review</option>
          <option value="draft">Draft</option>
        </select>
        <span className="text-[11px] text-ink-3 tabular-nums">
          {filtered.length} of {videos.length} shown
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-pcard px-3 py-2">
        <label className="flex items-center gap-2 text-[11px] font-medium">
          <input
            type="checkbox"
            aria-label="Select all shown videos"
            checked={allShownSelected}
            onChange={toggleAll}
          />
          Select all shown
        </label>
        <span className="text-[11px] text-ink-3 tabular-nums">{selectedVideos.length} selected</span>
        <button
          type="button"
          onClick={() => void deleteSelected()}
          disabled={!selectedVideos.length || bulkBusy === "delete"}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/40 px-3 text-[11.5px] font-semibold text-red-300 disabled:opacity-50"
        >
          {bulkBusy === "delete" ? (
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Delete selected
        </button>
      </div>
      {bulkError && (
        <p role="alert" className="mt-2 text-[11.5px] text-red-300">
          {bulkError}
        </p>
      )}
      {bulkNotice && <p className="mt-2 text-[11.5px] text-emerald-400">{bulkNotice}</p>}

      {/* ---- Rows ---- */}
      <ul className="mt-3 space-y-2">
        {filtered.map((video) => {
          const state = rows[video.id] || {};
          const busy = Boolean(state.busy);
          return (
            <li key={video.id} className="rounded-lg border border-line bg-pcard p-3">
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${video.title}`}
                  checked={selected.has(video.id)}
                  onChange={() => toggleOne(video.id)}
                  className="mt-6"
                />
                <div className="w-[104px] shrink-0 overflow-hidden rounded border border-line">
                  {video.thumbnail_url ? (
                    <img src={video.thumbnail_url} alt="" className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center text-ink-3">
                      <ImageOff aria-hidden="true" className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{video.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {video.category_label || "Uncategorised"} · {providerLabel(video.provider)} ·{" "}
                    {(video.view_count || 0).toLocaleString("en-US")} views
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px]">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${statusTone(video.status)}`}>
                      {video.status}
                    </span>
                    {video.source_url && (
                      <a
                        href={video.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-3 underline hover:text-accent"
                      >
                        source
                      </a>
                    )}
                    {/* The destination the player hands to the browser. Seeing
                        it here is how an operator tells a direct host file
                        (`…/video7/717/79.mp4`) from a post page that still has
                        to be resolved. */}
                    {(video.playable_url || video.embed_url) && (
                      <a
                        href={video.playable_url || video.embed_url || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-3 underline hover:text-accent"
                      >
                        media
                      </a>
                    )}
                    {video.requires_reupload && (
                      <span className="text-amber-300">media unavailable</span>
                    )}
                  </p>
                  {video.carousel_position && (
                    <p className="mt-1 text-[10.5px] text-ink-3">
                      <span>Carousel slot {video.carousel_position}: </span>
                      <span className="font-medium text-ink-2">{video.carousel_title || "—"}</span>
                      <span> · </span>
                      <span>{video.carousel_description || "—"}</span>
                    </p>
                  )}
                  {state.error && (
                    <p role="alert" className="mt-1 text-[11px] text-red-300">
                      {state.error}
                    </p>
                  )}
                  {state.notice && <p className="mt-1 text-[11px] text-emerald-400">{state.notice}</p>}
                  {state.editingThumb && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`Thumbnail URL for ${video.title}`}
                        value={state.thumbDraft ?? ""}
                        onChange={(event) =>
                          patchRow(video.id, { thumbDraft: event.target.value })
                        }
                        placeholder="https://…/poster.jpg"
                        className="h-8 min-w-[220px] flex-1 rounded-md border border-line bg-void px-2 text-[11.5px]"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveThumbnail(video)}
                        className="h-8 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => patchRow(video.id, { editingThumb: false, thumbDraft: "" })}
                        className="h-8 rounded-md border border-line px-3 text-[11.5px]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <select
                    aria-label={`Homepage carousel slot for ${video.title}`}
                    value={video.carousel_position ? String(video.carousel_position) : ""}
                    disabled={busy}
                    onChange={(event) =>
                      void setCarouselSlot(
                        video,
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                    className="h-8 rounded-md border border-line bg-void px-2 text-[11px]"
                  >
                    <option value="">Not in carousel</option>
                    {CAROUSEL_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        Slot {slot}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patchRow(video.id, { editingThumb: true, thumbDraft: video.thumbnail_url || "" })}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] disabled:opacity-50"
                    >
                      <Plus aria-hidden="true" className="h-3 w-3" />
                      Edit thumb
                    </button>
                    {video.thumbnail_url && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeThumbnail(video)}
                        className="h-7 rounded-md border border-line px-2 text-[11px] disabled:opacity-50"
                      >
                        Remove thumb
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void togglePublished(video)}
                      className="h-7 rounded-md border border-line px-2 text-[11px] disabled:opacity-50"
                    >
                      {video.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                    <a
                      href={`/video/${video.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px]"
                    >
                      <Play aria-hidden="true" className="h-3 w-3" />
                      View
                    </a>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteVideo(video)}
                      className="h-7 rounded-md border border-red-500/40 px-2 text-[11px] text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!filtered.length && (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-8 text-center text-[12px] text-ink-3">
          No videos match this view. Run the damplips import to fill the catalog.
        </p>
      )}
    </div>
  );
}
