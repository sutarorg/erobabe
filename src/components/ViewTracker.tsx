"use client";
import { useEffect } from "react";
/** A foreground watch-page visit lasting 5 seconds; not proof of playback. */
export default function ViewTracker({ videoId }: { videoId: string }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let sent = false;
    const start = () => {
      clearTimeout(timer);
      if (
        !document.hidden &&
        !sent &&
        !document.querySelector('[aria-labelledby="age-gate-title"]')
      )
        timer = setTimeout(() => {
          sent = true;
          void fetch("/api/track/view", {
            method: "POST",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId }),
          }).catch(() => {});
        }, 5000);
    };
    start();
    window.addEventListener("erobabe-age-declared", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("erobabe-age-declared", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [videoId]);
  return null;
}
