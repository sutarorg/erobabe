"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isTrackablePath } from "@/lib/analytics/path";

/**
 * First-party pageview collector for the public website.
 *
 * One beacon per navigation, plus one flush on hide/unload that carries only
 * the time spent on the page being left. Nothing is sent when:
 *
 *  - the visitor has Do Not Track enabled;
 *  - the browser has no `sessionStorage` (private mode edge cases);
 *  - the page is a private surface (`/admin`, `/checkout`, `/api`, …) — the
 *    server drops those anyway, this just avoids the request.
 *
 * The session id lives in `sessionStorage`, so it ends when the tab does. No
 * cookie, no fingerprint, no third-party script; the server hashes the request
 * and stores the coarse device class only.
 */

const SESSION_KEY = "erobabe:analytics-session";
const ENGAGEMENT_CAP_MS = 30 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 800;

function readSessionId(): string | null {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
            const random = (Math.random() * 16) | 0;
            return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
          });
    window.sessionStorage.setItem(SESSION_KEY, uuid);
    return uuid;
  } catch {
    return null;
  }
}

function doNotTrack(): boolean {
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  return (
    nav.doNotTrack === "1" ||
    (window as unknown as { doNotTrack?: string }).doNotTrack === "1" ||
    nav.msDoNotTrack === "1"
  );
}

type Beacon = {
  sessionId: string;
  /** Null only for the unload flush: time on the page being left, no pageview. */
  path: string | null;
  search: string | null;
  previousPath: string | null;
  previousEngagedMs: number;
  referrer: string | null;
};

function send(beacon: Beacon) {
  const body = JSON.stringify(beacon);
  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/collect", blob)) return;
    }
  } catch {
    /* fall through to fetch */
  }
  void fetch("/api/analytics/collect", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
}

export default function AnalyticsBeacon() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  const lastSentAt = useRef<number>(0);
  const visibleSince = useRef<number>(0);
  const hiddenAccumulated = useRef<number>(0);

  // Foreground time only: a tab left in the background is not engagement.
  useEffect(() => {
    const onVisibility = () => {
      const now = performance.now();
      if (document.visibilityState === "hidden") {
        hiddenAccumulated.current += now - visibleSince.current;
        visibleSince.current = 0;
      } else if (visibleSince.current === 0) {
        visibleSince.current = now;
      }
    };
    visibleSince.current = document.visibilityState === "visible" ? performance.now() : 0;
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const engagedMs = () => {
    const live = visibleSince.current > 0 ? performance.now() - visibleSince.current : 0;
    return Math.min(ENGAGEMENT_CAP_MS, Math.round(hiddenAccumulated.current + live));
  };

  const resetEngagement = () => {
    hiddenAccumulated.current = 0;
    visibleSince.current = document.visibilityState === "visible" ? performance.now() : 0;
  };

  // A pageview per navigation.
  useEffect(() => {
    if (doNotTrack()) return;
    const path = pathname || "/";
    if (!isTrackablePath(path)) {
      lastPath.current = path;
      return;
    }
    if (lastPath.current === path && performance.now() - lastSentAt.current < DUPLICATE_WINDOW_MS) {
      return;
    }
    // React Strict Mode runs effects twice in development; the guard above
    // keeps that from becoming two pageviews.
    const sessionId = readSessionId();
    if (!sessionId) return;

    const previous = lastPath.current;
    const previousEngagedMs = previous ? engagedMs() : 0;
    lastPath.current = path;
    lastSentAt.current = performance.now();
    resetEngagement();

    send({
      sessionId,
      path,
      search: window.location.search || null,
      previousPath: previous && isTrackablePath(previous) ? previous : null,
      previousEngagedMs,
      referrer: document.referrer || null,
    });
  }, [pathname]);

  // Flush the last page's time when the tab goes away.
  useEffect(() => {
    const flush = () => {
      if (doNotTrack()) return;
      const sessionId = readSessionId();
      const path = lastPath.current;
      if (!sessionId || !path || !isTrackablePath(path)) return;
      const time = engagedMs();
      if (time < 1000) return;
      resetEngagement();
      send({
        sessionId,
        path: null,
        search: null,
        previousPath: path,
        previousEngagedMs: time,
        referrer: null,
      });
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return null;
}
