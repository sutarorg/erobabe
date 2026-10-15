"use client";
import { Check, Share2, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { anonymousProfile } from "../utils/anonymousProfile";
import { cn } from "../utils/cn";

interface VideoActionsProps {
  /** Video title, used as the share sheet title. */
  title: string;
  videoId?: string;
}

/**
 * Copies text with the async Clipboard API, falling back to a hidden textarea
 * for browsers/contexts (http, older Safari) where the async API is blocked.
 */
async function copyLink(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * Watch-page actions: Like toggles locally (no account is required to watch),
 * Share uses the native share sheet when the browser offers one and falls back
 * to copying the page URL.
 */
export default function VideoActions({ title, videoId }: VideoActionsProps) {
  const [copyError, setCopyError] = useState("");
  const [liked, setLiked] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState("");
  useEffect(() => {
    try { setLiked(localStorage.getItem(`video-like:${videoId}`) === "true"); } catch { /* storage unavailable */ }
  }, [videoId]);
  const [shared, setShared] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const flashShared = useCallback(() => {
    setShared(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShared(false), 1600);
  }, []);

  const share = useCallback(async () => {
    setCopyError("");
    const url = typeof window === "undefined" ? "" : window.location.href;

    if (await copyLink(url)) flashShared();
    else setCopyError("Couldn't copy the link. Copy the address from your browser.");
    try {
      if (typeof navigator.share === "function") await navigator.share({ title, url });
    } catch { /* Copy remains successful even when the share sheet is dismissed. */ }
  }, [flashShared, title]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={ratingBusy}
        onClick={async () => {
          if (!videoId) return;
          setRatingBusy(true); setRatingError("");
          try {
            const res = await fetch("/api/community", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, visitorId: anonymousProfile().id, liked: !liked }) });
            if (!res.ok) throw new Error("Unable to save your like. Please retry.");
            setLiked(!liked);
            try { localStorage.setItem(`video-like:${videoId}`, String(!liked)); } catch { /* storage unavailable */ }
          } catch { setRatingError("Unable to save your like. Please retry."); }
          finally { setRatingBusy(false); }
        }}
        aria-pressed={liked}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors",
          liked
            ? "border-accent/60 bg-accent/12 text-accent"
            : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
        )}
      >
        <ThumbsUp className={cn("h-3.5 w-3.5", liked && "fill-current")} aria-hidden />
        {liked ? "Liked" : "Like"}
      </button>

      {ratingError && <p role="status" className="text-xs text-ink-3">{ratingError}</p>}
      {copyError && <p role="status" className="text-xs text-ink-3">{copyError}</p>}
      <button
        type="button"
        onClick={share}
        className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition-colors hover:border-zinc-600 hover:text-ink"
      >
        {shared ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
        ) : (
          <Share2 className="h-3.5 w-3.5" aria-hidden />
        )}
        {shared ? "Copied" : "Share"}
      </button>
    </div>
  );
}
