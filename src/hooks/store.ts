import { useCallback, useEffect, useState } from "react";

/**
 * Tiny localStorage-backed store with cross-component sync:
 * every write broadcasts a custom event so all mounted hooks re-read.
 */

const EVENT = "eb:store";

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStore<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode) — fail silently */
  }
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: key }));
}

export function useLocalStorage<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStore(key, fallback));

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (!detail || detail === key) setValue(readStore(key, fallback));
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [key, fallback]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        writeStore(key, next);
        return next;
      });
    },
    [key]
  );

  return [value, set] as const;
}

/* ── Watch history ── */
export interface HistoryEntry {
  id: string;
  at: number;
}

export function useHistory() {
  const [list, setList] = useLocalStorage<HistoryEntry[]>("eb:history", []);
  const add = useCallback(
    (id: string) => setList((prev) => [{ id, at: Date.now() }, ...prev.filter((e) => e.id !== id)].slice(0, 60)),
    [setList]
  );
  const remove = useCallback((id: string) => setList((prev) => prev.filter((e) => e.id !== id)), [setList]);
  const clear = useCallback(() => setList([]), [setList]);
  return { list, add, remove, clear };
}

/* ── Likes ── */
export function useLikes() {
  const [ids, setIds] = useLocalStorage<string[]>("eb:likes", []);
  const toggle = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [setIds]
  );
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, toggle, has };
}

/* ── Saved list ── */
export function useSaved() {
  const [ids, setIds] = useLocalStorage<string[]>("eb:saved", []);
  const toggle = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [setIds]
  );
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, toggle, has };
}

/* ── Recent searches ── */
export function useRecentSearches() {
  const [list, setList] = useLocalStorage<string[]>("eb:recent-searches", []);
  const add = useCallback(
    (q: string) => {
      const term = q.trim();
      if (!term) return;
      setList((prev) => [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
    },
    [setList]
  );
  const clear = useCallback(() => setList([]), [setList]);
  return { list, add, clear };
}

/* ── Document title ── */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — EroBabe` : "EroBabe — Premium 18+ Video Streaming";
    return () => {
      document.title = prev;
    };
  }, [title]);
}
