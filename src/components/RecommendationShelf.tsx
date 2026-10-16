"use client";
import { useEffect, useRef } from "react";
import type { PublicVideo } from "@/lib/public/catalog";
import { ALGORITHM_VERSION, type RecommendationSurface } from "@/lib/recommendations/ranking";
import PublicVideoCard from "./PublicVideoCard";

type Item = PublicVideo & { category_id?: string | null; like_count?: number; reason?: string; score?: number };
type Props = { title: string; videos: Item[]; surface: RecommendationSurface; correlationId?: string; algorithmVersion?: string; trackEvents?: boolean };

function id() {
  try { return crypto.randomUUID(); } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0;
      return (char === "x" ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }
}

export default function RecommendationShelf({ title, videos, surface, correlationId, algorithmVersion = ALGORITHM_VERSION, trackEvents = true }: Props) {
  const sent = useRef(false);
  const lastCorrelation = useRef("");
  useEffect(() => {
    if (!trackEvents) return;
    const currentCorrelation = correlationId || "uncorrelated";
    if (sent.current && lastCorrelation.current === currentCorrelation) return;
    if (!videos.length) return;
    sent.current = true;
    lastCorrelation.current = currentCorrelation;
    const impressionVideos = surface === "up_next" ? videos.slice(0, 8) : videos;
    const events = impressionVideos.map((video, position) => ({
      videoId: video.id,
      type: "impression" as const,
      surface,
      position,
      algorithmVersion,
      correlationId: correlationId || id(),
      idempotencyKey: id(),
    }));
    void fetch("/api/recommendations/events", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  }, [videos, surface, correlationId, algorithmVersion, trackEvents]);

  const isUpNext = surface === "up_next";
  const gridClass = isUpNext
    ? "video-grid mt-3.5 grid grid-cols-2 gap-4"
    : "video-grid mt-3.5 grid grid-cols-4 gap-4";
  const displayVideos = isUpNext ? videos.slice(0, 8) : videos;

  return (
    <section className="mt-8 border-t border-line pt-5" aria-label={title}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {videos.length ? (
        <div className={gridClass} data-grid-rows="4" style={{ gridTemplateColumns: isUpNext ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))' }}>
          {displayVideos.map((video) => (
            <div key={video.id} className="min-w-0">
              <PublicVideoCard video={video} onClick={() => {
                if (!trackEvents) return;
                void fetch("/api/recommendations/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ videoId: video.id, type: "card_select", surface, algorithmVersion, correlationId: correlationId || id(), idempotencyKey: id() }] }) }).catch(() => {});
              }} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-3">No videos available right now. Browse categories or try again later.</p>
      )}
    </section>
  );
}
