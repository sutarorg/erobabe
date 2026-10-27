"use client";

import { useEffect } from "react";

const SESSION_KEY = "erobabe-rec-init";

/**
 * Personalization is on by default.
 *
 * There is no opt-in panel to click any more, so the first public page view
 * asks the server for an opaque profile token — an `HttpOnly` cookie only the
 * server can set. Asking from the browser (instead of `Set-Cookie` on the
 * document) keeps the public HTML cacheable in the shared CDN; a cookie on the
 * document response would take every page out of that cache.
 *
 * The token carries no identity: the server hashes it with a secret, and only
 * recommendation tables ever see the hash. Visitors can still opt out through
 * `POST /api/recommendations/preferences {"action":"disable"}`.
 */
export default function RecommendationProfileInit() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return;
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Private mode with storage disabled: still ask once for this page.
    }
    void fetch("/api/recommendations/preferences", {
      cache: "no-store",
      credentials: "same-origin",
    }).catch(() => {});
  }, []);

  return null;
}
