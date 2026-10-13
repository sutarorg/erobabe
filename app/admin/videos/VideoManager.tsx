"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ImagePlus, ImageOff, LoaderCircle, Search, Trash2 } from "lucide-react";
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
  category_label: string | null;
};

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;

type RowState = { busy?: "thumbnail" | "remove" | "delete"; error?: string; notice?: string };

/**
 * Admin video table with per-video actions:
 *
 * - change (or add) the thumbnail — uploaded straight to storage, then saved
 * - remove the thumbnail — deletes the stored object too
 * - delete the video — removes the row (video_tags/video_events cascade)
 */
export default function VideoManager({ initialVideos }: { initialVideos: AdminVideo[] }) {
  const [videos, setVideos] = useState(initialVideos);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return videos;
    return videos.filter((video) =>
      [video.title, video.slug, video.category_label || ""].some((value) => value.toLowerCase().includes(needle))
    );
  }, [videos, query]);

  function patchRow(id: string, patch: RowState) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
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
    } catch (error: any) {
      patchRow(video.id, { busy: undefined, error: error?.message || "Could not delete the video" });
    }
  }

  return (
    <div>
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
        <span className="text-[11px] tabular-nums text-ink-3">
          {filtered.length} of {videos.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-10 text-center">
          <p className="text-[13px]">{videos.length ? "No videos match that search." : "No videos published yet."}</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-4 py-3">Thumbnail</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((video) => {
                const state = rows[video.id] || {};
                const busy = Boolean(state.busy);
                return (
                  <tr key={video.id} className="border-b border-line/50 align-top hover:bg-white/[0.02]">
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
                          {state.busy === "thumbnail" && (
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
                    <td className="px-4 py-3 tabular-nums">{video.view_count || 0}</td>
                    <td className="px-4 py-3 text-[11px] text-ink-3">{new Date(video.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/video/${video.slug}`} target="_blank" className="text-[11px] text-accent hover:underline">
                          View
                        </Link>
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
