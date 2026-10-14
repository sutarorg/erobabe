"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Link from "next/link";
import {
  ImagePlus,
  ImageOff,
  LoaderCircle,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { postJson } from "@/src/utils/api";
import { uploadWithProgress } from "@/src/utils/uploadFile";

export type AdminVideo = {
  id: string;
  slug: string;
  title: string;
  status: string;
  visibility?: string | null;
  provider?: string | null;
  thumbnail_url: string | null;
  playable_url?: string | null;
  embed_url?: string | null;
  view_count: number | null;
  created_at: string;
  category_id?: string | null;
  category_label: string | null;
  /** Homepage carousel slot (1–3), or null when the video is not in the carousel. */
  carousel_position?: number | null;
};

export type AdminCategory = { id: string; label: string };

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;
const CAROUSEL_SLOTS = [1, 2, 3];
const DELETE_CHUNK = 200;
const THUMBNAIL_CHUNK = 10;
type RowState = {
  busy?: "thumbnail" | "remove" | "delete" | "generate" | "carousel";
  error?: string;
  notice?: string;
};

/**
 * Admin video table:
 *
 * - filter by category, title, slug, or category label
 * - select one, select all shown, then delete or generate thumbnails in bulk
 * - per video: change/add the thumbnail, generate a frame thumbnail, remove a
 *   thumbnail, delete the video, and place it in homepage carousel slot 1–3
 */
export default function VideoManager({
  initialVideos,
  categories = [],
}: {
  initialVideos: AdminVideo[];
  categories?: AdminCategory[];
}) {
  const [videos, setVideos] = useState(initialVideos);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"" | "delete" | "generate">("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkError, setBulkError] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return videos.filter((video) => {
      if (categoryFilter && video.category_id !== categoryFilter) return false;
      if (!needle) return true;
      return [video.title, video.slug, video.category_label || ""].some((value) => value.toLowerCase().includes(needle));
    });
  }, [videos, query, categoryFilter]);

  const shownIds = filtered.map((video) => video.id);
  const selectedShown = shownIds.filter((id) => selected.has(id));
  const allShownSelected = shownIds.length > 0 && selectedShown.length === shownIds.length;
  const selectedVideos = videos.filter((video) => selected.has(video.id));
  const generatable = selectedVideos.filter((video) => !video.thumbnail_url && video.playable_url);

  const slotHolders = useMemo(() => {
    const holders: Record<number, AdminVideo | undefined> = {};
    for (const video of videos) {
      if (video.carousel_position) holders[video.carousel_position] = video;
    }
    return holders;
  }, [videos]);

  function patchRow(id: string, patch: RowState) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((current) => {
      const next = new Set(current);
      if (allShownSelected) {
        for (const id of shownIds) next.delete(id);
      } else {
        for (const id of shownIds) next.add(id);
      }
      return next;
    });
  }

  /** Uploads to Supabase Storage via a signed URL and returns its public URL. */
  async function uploadThumbnail(file: File): Promise<string> {
    const target = await postJson<{ uploadUrl: string; storagePath: string; publicUrl?: string }>(
      "/api/videos/storage-token",
      {
        kind: "thumbnail",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      }
    );
    await uploadWithProgress(target.uploadUrl, file, { contentType: file.type });
    return target.publicUrl || target.storagePath;
  }

  async function changeThumbnail(video: AdminVideo, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;

    if (!THUMBNAIL_TYPES.includes(file.type)) {
      patchRow(video.id, { error: "Thumbnails must be JPG, PNG, GIF, or WebP.", notice: undefined });
      return;
    }
    if (file.size > MAX_THUMBNAIL_SIZE) {
      patchRow(video.id, { error: "Thumbnails must be 10 MB or smaller.", notice: undefined });
      return;
    }

    patchRow(video.id, { busy: "thumbnail", error: undefined, notice: undefined });
    try {
      const thumbnailUrl = await uploadThumbnail(file);
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, thumbnail_url: thumbnailUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to save the thumbnail");

      setVideos((current) =>
        current.map((item) => (item.id === video.id ? { ...item, thumbnail_url: payload.video?.thumbnail_url || thumbnailUrl } : item))
      );
      patchRow(video.id, { busy: undefined, notice: "Thumbnail updated." });
    } catch (error: any) {
      patchRow(video.id, { busy: undefined, error: error?.message || "Thumbnail upload failed" });
    }
  }

  async function generateThumbnails(targets: AdminVideo[]): Promise<{ generated: number; failed: number }> {
    let generated = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index += THUMBNAIL_CHUNK) {
      const chunk = targets.slice(index, index + THUMBNAIL_CHUNK);
      for (const video of chunk) patchRow(video.id, { busy: "generate", error: undefined, notice: undefined });
      try {
        const payload = await postJson<{ results: Array<{ id: string; status: string; thumbnailUrl?: string; error?: string }> }>(
          "/api/admin/videos/thumbnails",
          { ids: chunk.map((video) => video.id) }
        );
        for (const result of payload.results || []) {
          if (result.status === "generated" && result.thumbnailUrl) {
            generated += 1;
            const url = result.thumbnailUrl;
            setVideos((current) => current.map((item) => (item.id === result.id ? { ...item, thumbnail_url: url } : item)));
            patchRow(result.id, { busy: undefined, notice: "Thumbnail generated from a video frame." });
          } else if (result.status === "skipped") {
            patchRow(result.id, { busy: undefined, notice: result.error });
          } else {
            failed += 1;
            patchRow(result.id, { busy: undefined, error: result.error || "Could not generate a thumbnail" });
          }
        }
      } catch (error: any) {
        failed += chunk.length;
        for (const video of chunk) patchRow(video.id, { busy: undefined, error: error?.message || "Thumbnail generation failed" });
      }
    }
    return { generated, failed };
  }

  async function generateOne(video: AdminVideo) {
    await generateThumbnails([video]);
  }

  async function generateSelected() {
    if (!generatable.length) return;
    setBulkBusy("generate");
    setBulkError("");
    setBulkNotice("");
    const { generated, failed } = await generateThumbnails(generatable);
    setBulkBusy("");
    setBulkNotice(`Generated ${generated} thumbnail${generated === 1 ? "" : "s"} from video frames.${failed ? ` ${failed} failed — see the row messages.` : ""}`);
  }



  async function removeThumbnail(video: AdminVideo) {
    if (!video.thumbnail_url) return;
    if (!window.confirm(`Remove the thumbnail from “${video.title}”? The stored image is deleted.`)) return;

    patchRow(video.id, { busy: "remove", error: undefined, notice: undefined });
    try {
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, thumbnail_url: null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to remove the thumbnail");

      setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, thumbnail_url: null } : item)));
      patchRow(video.id, { busy: undefined, notice: "Thumbnail removed." });
    } catch (error: any) {
      patchRow(video.id, { busy: undefined, error: error?.message || "Could not remove the thumbnail" });
    }
  }

  async function setCarouselSlot(video: AdminVideo, slot: number | null) {
    patchRow(video.id, { busy: "carousel", error: undefined, notice: undefined });
    try {
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, carousel_position: slot }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update the carousel");

      // A slot holds one video: whichever video held it before is moved out.
      setVideos((current) =>
        current.map((item) => {
          if (item.id === video.id) return { ...item, carousel_position: slot };
          if (slot && item.carousel_position === slot) return { ...item, carousel_position: null };
          return item;
        })
      );
      patchRow(video.id, {
        busy: undefined,
        notice: slot ? `Placed in homepage carousel slot ${slot}.` : "Removed from the homepage carousel.",
      });
    } catch (error: any) {
      patchRow(video.id, { busy: undefined, error: error?.message || "Could not update the carousel" });
    }
  }

  async function deleteVideo(video: AdminVideo) {
    if (
      !window.confirm(
        `Delete “${video.title}”? This removes the video from the library and deletes its thumbnail. It cannot be undone.`
      )
    ) {
      return;
    }

    patchRow(video.id, { busy: "delete", error: undefined, notice: undefined });
    try {
      const response = await fetch("/api/admin/videos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to delete the video");

      setVideos((current) => current.filter((item) => item.id !== video.id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(video.id);
        return next;
      });
    } catch (error: any) {
      patchRow(video.id, { busy: undefined, error: error?.message || "Could not delete the video" });
    }
  }

  async function deleteSelected() {
    if (!selectedVideos.length) return;
    if (
      !window.confirm(
        `Delete ${selectedVideos.length} selected video${selectedVideos.length === 1 ? "" : "s"}? They are removed from the library and their thumbnails are deleted. This cannot be undone.`
      )
    ) {
      return;
    }

    setBulkBusy("delete");
    setBulkError("");
    setBulkNotice("");
    const ids = selectedVideos.map((video) => video.id);
    const deleted = new Set<string>();
    try {
      for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
        const chunk = ids.slice(index, index + DELETE_CHUNK);
        const response = await fetch("/api/admin/videos", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Unable to delete the selected videos");
        for (const id of payload.deleted || []) deleted.add(String(id));
      }
      setVideos((current) => current.filter((video) => !deleted.has(video.id)));
      setSelected((current) => {
        const next = new Set(current);
        for (const id of deleted) next.delete(id);
        return next;
      });
      setBulkNotice(`Deleted ${deleted.size} video${deleted.size === 1 ? "" : "s"}.`);
    } catch (error: any) {
      setBulkError(error?.message || "Could not delete the selected videos");
      if (deleted.size) {
        setVideos((current) => current.filter((video) => !deleted.has(video.id)));
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
              Pick up to three videos for the top card on the homepage. {carouselCount ? `${carouselCount} of 3 slots filled.` : "No slots filled — the default artwork is shown."}
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
                      <button
                        type="button"
                        onClick={() => setCarouselSlot(holder, null)}
                        disabled={rows[holder.id]?.busy === "carousel"}
                        className="mt-0.5 text-[10.5px] text-ink-3 underline hover:text-ink disabled:opacity-50"
                      >
                        Clear slot
                      </button>
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
        <label className="relative flex-1 min-w-[220px] max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, slug, or category"
            aria-label="Search videos"
            className="h-9 w-full rounded-md border border-line bg-void pl-8 pr-3 text-[12.5px]"
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by category</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
            className="h-9 rounded-md border border-line bg-void px-3 text-[12.5px]"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] tabular-nums text-ink-3">
          {filtered.length} of {videos.length} shown
        </span>
      </div>

      {/* ---- Bulk bar ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-pcard px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            aria-label="Select all shown videos"
            checked={allShownSelected}
            ref={(element) => {
              if (element) element.indeterminate = selectedShown.length > 0 && !allShownSelected;
            }}
            onChange={toggleAllShown}
            disabled={!shownIds.length || Boolean(bulkBusy)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Select all{shownIds.length ? ` (${shownIds.length})` : ""}
        </label>
        <span className="text-[11.5px] tabular-nums text-ink-3">{selectedVideos.length} selected</span>
        {selectedVideos.length > 0 && (
          <>
            <button
              type="button"
              onClick={generateSelected}
              disabled={Boolean(bulkBusy) || !generatable.length}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-ink-2 hover:bg-white/5 disabled:opacity-40"
              title={generatable.length ? "Capture a frame for direct-link videos without a thumbnail" : "Nothing to generate — the selection has thumbnails or embed links"}
            >
              {bulkBusy === "generate" ? (
                <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" className="h-3 w-3" />
              )}
              Generate thumbnails{generatable.length ? ` (${generatable.length})` : ""}
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={Boolean(bulkBusy)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              {bulkBusy === "delete" ? (
                <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" className="h-3 w-3" />
              )}
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={Boolean(bulkBusy)}
              className="h-7 rounded-md px-2 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
            >
              Clear selection
            </button>
          </>
        )}
        {bulkNotice && <span className="text-[11px] text-emerald-300">{bulkNotice}</span>}
        {bulkError && <span className="text-[11px] text-red-300">{bulkError}</span>}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-10 text-center">
          <p className="text-[13px]">{videos.length ? "No videos match that search or category." : "No videos published yet."}</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="w-8 px-3 py-3">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-4 py-3">Thumbnail</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Carousel</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((video) => {
                const state = rows[video.id] || {};
                const busy = Boolean(state.busy) || Boolean(bulkBusy);
                const isSelected = selected.has(video.id);
                const slot = video.carousel_position || null;
                return (
                  <tr key={video.id} className={`border-b border-line/50 align-top hover:bg-white/[0.02] ${isSelected ? "bg-accent/[0.04]" : ""}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${video.title}`}
                        checked={isSelected}
                        onChange={() => toggleOne(video.id)}
                        disabled={busy}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-[112px]">
                        <div className="relative overflow-hidden rounded-md border border-line bg-void">
                          {video.thumbnail_url ? (
                            <img src={video.thumbnail_url} alt="" className="aspect-video w-full object-cover" />
                          ) : (
                            <div className="flex aspect-video w-full items-center justify-center text-ink-3">
                              <ImageOff aria-hidden="true" className="h-4 w-4" />
                            </div>
                          )}
                          {(state.busy === "thumbnail" || state.busy === "generate") && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-white" />
                            </div>
                          )}
                        </div>
                        <label
                          className={`mt-1 inline-flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line text-[10.5px] hover:bg-white/5 ${
                            busy ? "pointer-events-none opacity-50" : ""
                          }`}
                        >
                          <ImagePlus aria-hidden="true" className="h-3 w-3" />
                          {video.thumbnail_url ? "Change" : "Add thumbnail"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            onChange={(event) => changeThumbnail(video, event)}
                            disabled={busy}
                            className="sr-only"
                          />
                        </label>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{video.title}</p>
                      <p className="text-[11px] text-ink-3">
                        {video.category_label || "—"} · <span className="font-mono">{video.slug}</span>
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-ink-3">
                        {video.embed_url ? "Embed player" : "Direct link"}
                        {video.provider ? ` · ${video.provider}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{video.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <label className="block">
                        <span className="sr-only">Homepage carousel slot for {video.title}</span>
                        <select
                          aria-label={`Homepage carousel slot for ${video.title}`}
                          value={slot ? String(slot) : ""}
                          onChange={(event) => {
                            const next = event.target.value ? Number(event.target.value) : null;
                            setCarouselSlot(video, next);
                          }}
                          disabled={busy}
                          className="h-7 rounded-md border border-line bg-void px-2 text-[11px] disabled:opacity-50"
                        >
                          <option value="">Not in carousel</option>
                          {CAROUSEL_SLOTS.map((option) => (
                            <option key={option} value={option}>
                              Slot {option}
                              {slotHolders[option] && slotHolders[option]?.id !== video.id ? " (replaces current)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {state.busy === "carousel" && <p className="mt-1 text-[10px] text-ink-3">Saving…</p>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{video.view_count || 0}</td>
                    <td className="px-4 py-3 text-[11px] text-ink-3">{new Date(video.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/video/${video.slug}`} target="_blank" className="text-[11px] text-accent hover:underline">
                          View
                        </Link>
                        {!video.thumbnail_url && video.playable_url && (
                          <button
                            type="button"
                            onClick={() => generateOne(video)}
                            disabled={busy}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:bg-white/5 hover:text-ink disabled:opacity-40"
                          >
                            {state.busy === "generate" ? (
                              <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles aria-hidden="true" className="h-3 w-3" />
                            )}
                            Generate thumb
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeThumbnail(video)}
                          disabled={busy || !video.thumbnail_url}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:bg-white/5 hover:text-ink disabled:opacity-40"
                        >
                          {state.busy === "remove" ? (
                            <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                          ) : (
                            <ImageOff aria-hidden="true" className="h-3 w-3" />
                          )}
                          Remove thumb
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteVideo(video)}
                          disabled={busy}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-red-500/30 px-2 text-[10.5px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {state.busy === "delete" ? (
                            <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 aria-hidden="true" className="h-3 w-3" />
                          )}
                          Delete
                        </button>
                      </div>
                      {state.notice && <p className="mt-1.5 text-[10.5px] text-emerald-300">{state.notice}</p>}
                      {state.error && <p className="mt-1.5 text-[10.5px] text-red-300">{state.error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
