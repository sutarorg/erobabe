/**
 * Local persistence layer: age gate, history, likes, saves, recent searches,
 * view events and small sync helpers. Everything is client-side only.
 */
import { useEffect, useState } from "react";

const K = {
  age: "eb:age",
  history: "eb:history",
  likes: "eb:likes",
  saves: "eb:saves",
  searches: "eb:searches",
  events: "eb:view-events",
  session: "eb:session",
  sidebar: "eb:sidebar",
  prefs: "eb:prefs",
  analyticsSeeded: "eb:analytics-seeded",
} as const;

export const STORE_EVENT = "eb:store-changed";

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — fail silently */
  }
  window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: key }));
}

/** Re-render component whenever local data changes. */
export function useStoreVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    window.addEventListener(STORE_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(STORE_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return v;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} — EroBabe` : "EroBabe — Premium Adult Video Streaming";
  }, [title]);
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/* ---------------- age gate ---------------- */

export function isAgeConfirmed(): boolean {
  return readJSON<string | null>(K.age, null) === "18+";
}
export function confirmAge() {
  writeJSON(K.age, "18+");
}

/* ---------------- history ---------------- */

export interface HistoryEntry {
  id: string;
  at: number;
}

export function getHistory(): HistoryEntry[] {
  return readJSON<HistoryEntry[]>(K.history, []);
}
export function pushHistory(id: string) {
  const list = getHistory().filter((h) => h.id !== id);
  list.unshift({ id, at: Date.now() });
  writeJSON(K.history, list.slice(0, 60));
}
export function removeHistory(id: string) {
  writeJSON(K.history, getHistory().filter((h) => h.id !== id));
}
export function clearHistory() {
  writeJSON(K.history, []);
}

/* ---------------- likes / saves ---------------- */

function toggleInList(key: string, id: string): string[] {
  const list = readJSON<string[]>(key, []);
  const next = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
  writeJSON(key, next);
  return next;
}
export const getLikes = () => readJSON<string[]>(K.likes, []);
export const getSaves = () => readJSON<string[]>(K.saves, []);
export const toggleLike = (id: string) => toggleInList(K.likes, id);
export const toggleSave = (id: string) => toggleInList(K.saves, id);

/* ---------------- recent searches ---------------- */

export const getRecentSearches = () => readJSON<string[]>(K.searches, []);
export function pushRecentSearch(q: string) {
  const t = q.trim();
  if (!t) return;
  const list = getRecentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase());
  writeJSON(K.searches, [t, ...list].slice(0, 8));
}
export const clearRecentSearches = () => writeJSON(K.searches, []);

/* ---------------- prefs ---------------- */

export interface Prefs {
  autoplayPreviews: boolean;
}
export const getPrefs = () => readJSON<Prefs>(K.prefs, { autoplayPreviews: true });
export const setPrefs = (p: Prefs) => writeJSON(K.prefs, p);

/* ---------------- sidebar ---------------- */
export const getSidebarCollapsed = () => readJSON<boolean>(K.sidebar, false);
export const setSidebarCollapsed = (v: boolean) => writeJSON(K.sidebar, v);

/* ---------------- view events ---------------- */

export interface ViewEvent {
  id: string;
  videoId: string;
  ts: number;
  seconds: number;
  session: string;
  demo?: boolean;
}

export function getSessionId(): string {
  let s = readJSON<string | null>(K.session, null);
  if (!s) {
    s = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      localStorage.setItem(K.session, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
  return s;
}

export const getViewEvents = () => readJSON<ViewEvent[]>(K.events, []);

export function recordLocalView(videoId: string, seconds: number) {
  const events = getViewEvents();
  const session = getSessionId();
  // basic anti-abuse: same video + same session within 6h = ignored
  const recent = events.some(
    (e) => e.videoId === videoId && e.session === session && Date.now() - e.ts < 6 * 3600e3
  );
  if (recent) return false;
  events.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    videoId,
    ts: Date.now(),
    seconds: Math.round(seconds),
    session,
  });
  writeJSON(K.events, events.slice(-5000));
  return true;
}

/**
 * Seed clearly-marked demo analytics so the admin dashboard has honest
 * demonstration data on first run. Only runs in demo mode, only once.
 */
export function seedDemoAnalytics(videoIds: string[]) {
  if (readJSON<boolean>(K.analyticsSeeded, false)) return;
  const events = getViewEvents();
  const now = Date.now();
  let n = 7;
  const rand = () => {
    n = (n * 16807) % 2147483647;
    return (n % 1000) / 1000;
  };
  for (let d = 0; d < 30; d++) {
    const count = 6 + Math.floor(rand() * 26) + Math.floor((30 - d) * 0.8);
    for (let i = 0; i < count; i++) {
      const vid = videoIds[Math.floor(rand() * videoIds.length)];
      events.push({
        id: `seed-${d}-${i}`,
        videoId: vid,
        ts: now - d * 864e5 - Math.floor(rand() * 80000) * 1000,
        seconds: 30 + Math.floor(rand() * 480),
        session: `seed-${Math.floor(rand() * 400)}`,
        demo: true,
      });
    }
  }
  writeJSON(K.events, events.slice(-8000));
  writeJSON(K.analyticsSeeded, true);
}
