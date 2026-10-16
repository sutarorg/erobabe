"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicVideo } from "@/lib/public/catalog";
import { useRouter } from "next/navigation";
import { ALGORITHM_VERSION, type RecommendationSurface } from "@/lib/recommendations/ranking";
import PublicVideoCard from "./PublicVideoCard";

type Item = PublicVideo & { category_id?: string | null; like_count?: number; reason?: string; score?: number };
type Props = { title: string; videos: Item[]; surface: RecommendationSurface; correlationId?: string; algorithmVersion?: string };

function id() {
  try { return crypto.randomUUID(); } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0;
      return (char === "x" ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }
}

export default function RecommendationShelf({ title, videos, surface, correlationId, algorithmVersion = ALGORITHM_VERSION }: Props) {
  const sent = useRef(false);
  const lastCorrelation = useRef("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const router = useRouter();
  useEffect(() => {
    const currentCorrelation = correlationId || "uncorrelated";
    if (sent.current && lastCorrelation.current === currentCorrelation) return;
    if (!videos.length) return;
    sent.current = true;
    lastCorrelation.current = currentCorrelation;
    const events = videos.map((video, position) => ({
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
  }, [videos, surface, correlationId, algorithmVersion]);

  async function act(videoId: string, action: "interested" | "not_interested" | "show_less" | "less_category") {
    try {
      const response = await fetch("/api/recommendations/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, action }),
      });
      if (response.status === 409) throw new Error("Turn on personalization in Recommendation controls to save feedback.");
      if (!response.ok) throw new Error("Feedback could not be saved. Try again.");
      setFeedback((previous) => ({ ...previous, [videoId]: action }));
      router.refresh();
      setNotice(action === "interested" ? "Preference saved." : action === "less_category" ? "This category will be suppressed." : action === "show_less" ? "Similar videos will be ranked lower." : "This video will be suppressed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Feedback could not be saved.");
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-5" aria-label={title}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {videos.length ? <div className="video-grid mt-3.5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-grid-rows="4">
        {videos.map((video) => <div key={video.id} className="min-w-0">
          <PublicVideoCard video={video} onClick={() => {
            void fetch("/api/recommendations/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ videoId: video.id, type: "card_select", surface, algorithmVersion, correlationId: correlationId || id(), idempotencyKey: id() }] }) }).catch(() => {});
          }} />
          <p className="mt-1 text-[10px] text-ink-3">Why this: {video.reason || "A fresh discovery"}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={feedback[video.id] === "interested"} onClick={() => void act(video.id, "interested")} className="rounded border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent/40 hover:text-accent">Interested</button>
            <button type="button" aria-pressed={feedback[video.id] === "not_interested"} onClick={() => void act(video.id, "not_interested")} className="rounded border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent/40 hover:text-accent">Not interested</button>
            <button type="button" aria-pressed={feedback[video.id] === "show_less"} onClick={() => void act(video.id, "show_less")} className="rounded border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent/40 hover:text-accent">Show less like this</button>
            {video.category_id && <button type="button" aria-pressed={feedback[video.id] === "less_category"} onClick={() => void act(video.id, "less_category")} className="rounded border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent/40 hover:text-accent">Don’t recommend this category</button>}
          </div>
        </div>)}
      </div> : <p className="mt-3 text-sm text-ink-3">No videos available right now. Browse categories or try again later.</p>}
      {notice && <p role="status" className="mt-2 text-[11px] text-ink-3">{notice}</p>}
    </section>
  );
}
