/**
 * Admin store — the CMS backbone.
 *
 * DEMO MODE (default): state lives in localStorage under ADMIN_KEY and is the
 * exact same record the public site reads (api.getCatalog), so publishing a
 * video in /admin instantly surfaces it on the public pages. Demo auth uses a
 * client-side session and is clearly labelled — production mode swaps this
 * whole module for the secure API (see server/app.ts) without touching the UI.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CATEGORIES, VIDEOS, slugify, type Category, type Video } from "../data/videos";
import {
  ADMIN_KEY, DEFAULT_SETTINGS, DEMO_MODE, STATE_VERSION, readAdminState,
  type SiteSettings, type VideoStatus,
} from "../lib/api";
import { getViewEvents, readJSON, writeJSON, type ViewEvent } from "../lib/store";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AdminVideo extends Video {
  status: VideoStatus;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  sourceEphemeral?: boolean;
  updatedAt: string;
  publishedAt: string | null;
  seoTitle?: string;
  seoDescription?: string;
  scheduledAt?: string | null;
  error?: string;
}

export interface AdminCategory extends Category {
  order: number;
  description?: string;
}

export interface AdminTag {
  name: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  detail?: string;
  ts: number;
}

interface AdminState {
  videos: AdminVideo[];
  categories: AdminCategory[];
  tags: AdminTag[];
  activity: ActivityEntry[];
  settings: SiteSettings;
}

interface Session {
  user: string;
  exp: number;
  demo: boolean;
}

const SESSION_KEY = "eb:admin:session";
const LOCKOUT_KEY = "eb:admin:lockout";

/* ------------------------------------------------------------------ */
/* Ephemeral demo upload sources (session-only object URLs)            */
/* ------------------------------------------------------------------ */

const ephemeralSources = new Map<string, string>();
export const setEphemeralSource = (id: string, url: string) => {
  ephemeralSources.set(id, url);
};

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

function seedState(): AdminState {
  const videos: AdminVideo[] = VIDEOS.map((v, i) => ({
    ...v,
    status: i === 4 ? "DRAFT" : i === 13 ? "PROCESSING" : i === 24 ? "READY" : i === 37 ? "FAILED" : "PUBLISHED",
    fileName: `source-${v.id}.mp4`,
    fileSize: Math.round(180e6 + ((i * 73411) % 900) * 1e6),
    mime: "video/mp4",
    updatedAt: v.createdAt,
    publishedAt: i === 4 || i === 13 || i === 24 || i === 37 ? null : v.createdAt,
    error: i === 37 ? "Encoding failed: source codec unsupported by demo pipeline." : undefined,
  }));
  const tagSet = new Set<string>();
  VIDEOS.forEach((v) => v.tags.forEach((t) => tagSet.add(t)));
  return {
    videos,
    categories: CATEGORIES.map((c, i) => ({ ...c, order: i })),
    tags: [...tagSet].map((name) => ({ name, createdAt: new Date().toISOString() })),
    activity: [
      { id: "a1", action: "Seeded demo catalog", entity: "system", entityId: "-", detail: `${videos.length} videos`, ts: Date.now() - 864e5 },
    ],
    settings: DEFAULT_SETTINGS,
  };
}

function loadState(): AdminState {
  // readAdminState() already migrates older persisted shapes (incl. the
  // v1 → v2 category/icon taxonomy change) before we consume them.
  const raw = readAdminState();
  if (raw && Array.isArray(raw.videos) && raw.videos.length) {
    const seeded = seedState();
    return {
      videos: raw.videos as AdminVideo[],
      categories: (raw.categories?.length ? raw.categories : seeded.categories) as AdminCategory[],
      tags: raw.tags ?? seeded.tags,
      activity: (raw.activity as ActivityEntry[]) ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    };
  }
  const fresh = seedState();
  persistState(fresh);
  return fresh;
}

function persistState(s: AdminState) {
  // Persisted shape matches what api.ts reads on the public site.
  writeJSON(ADMIN_KEY, {
    version: STATE_VERSION,
    videos: s.videos,
    categories: s.categories,
    settings: s.settings,
    tags: s.tags,
    activity: s.activity.slice(-400),
  });
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface AdminCtx {
  state: AdminState;
  session: Session | null;
  demo: boolean;
  lockoutUntil: number;
  login: (u: string, p: string) => { ok: boolean; error?: string };
  logout: () => void;
  log: (action: string, entity: string, entityId: string, detail?: string) => void;
  addVideo: (v: AdminVideo) => void;
  updateVideo: (id: string, patch: Partial<AdminVideo>, action?: string) => void;
  deleteVideos: (ids: string[]) => void;
  publish: (ids: string[]) => { ok: boolean; errors: Record<string, string> };
  unpublish: (ids: string[]) => void;
  bulkFlag: (ids: string[], flag: "featured" | "trending", value: boolean) => void;
  upsertCategory: (c: AdminCategory) => void;
  deleteCategory: (slug: string) => void;
  moveCategory: (slug: string, dir: -1 | 1) => void;
  upsertTag: (name: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  mergeTags: (from: string[], into: string) => void;
  deleteTag: (name: string) => void;
  saveSettings: (s: SiteSettings) => void;
  events: ViewEvent[];
  getVideoUrl: (v: AdminVideo) => string;
}

const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin outside provider");
  return ctx;
}

export function validatePublish(v: AdminVideo): string | null {
  if (!v.title.trim()) return "A title is required.";
  if (!v.category) return "A category is required.";
  if (!v.thumbnail) return "A thumbnail or poster is required.";
  if (!v.videoUrl && !ephemeralSources.has(v.id) && !v.sourceEphemeral) return "A playable video source is required.";
  if (v.status === "PROCESSING") return "Video is still processing.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState>(loadState);
  const [session, setSession] = useState<Session | null>(() => {
    const s = readJSON<Session | null>(SESSION_KEY, null);
    return s && s.exp > Date.now() ? s : null;
  });
  const [lockoutUntil, setLockoutUntil] = useState<number>(() => readJSON<number>(LOCKOUT_KEY, 0));
  const events = getViewEvents();

  useEffect(() => persistState(state), [state]);

  const mutate = (fn: (s: AdminState) => AdminState) => setState((s) => fn(s));

  const log = (action: string, entity: string, entityId: string, detail?: string) =>
    mutate((s) => ({
      ...s,
      activity: [
        { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, action, entity, entityId, detail, ts: Date.now() },
        ...s.activity,
      ].slice(0, 400),
    }));

  const login = (u: string, p: string) => {
    if (Date.now() < lockoutUntil) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((lockoutUntil - Date.now()) / 1000)}s.` };
    const expectedUser = import.meta.env.VITE_DEMO_ADMIN_USER ?? "admin";
    const expectedPass = import.meta.env.VITE_DEMO_ADMIN_PASSWORD ?? "erobabe-demo";
    if (u === expectedUser && p === expectedPass) {
      const sess: Session = { user: u, exp: Date.now() + 8 * 3600e3, demo: true };
      setSession(sess);
      writeJSON(SESSION_KEY, sess);
      writeJSON(LOCKOUT_KEY, 0);
      setLockoutUntil(0);
      const fails = Number(sessionStorage.getItem("eb:admin:fails") ?? 0);
      sessionStorage.setItem("eb:admin:fails", "0");
      void fails;
      return { ok: true };
    }
    const fails = Number(sessionStorage.getItem("eb:admin:fails") ?? 0) + 1;
    sessionStorage.setItem("eb:admin:fails", String(fails));
    if (fails >= 5) {
      const until = Date.now() + 30e3;
      writeJSON(LOCKOUT_KEY, until);
      setLockoutUntil(until);
      sessionStorage.setItem("eb:admin:fails", "0");
      return { ok: false, error: "Too many failed attempts. Locked for 30s." };
    }
    return { ok: false, error: "Invalid credentials" };
  };

  const logout = () => {
    setSession(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  };

  const api: Omit<AdminCtx, "state" | "session" | "demo" | "lockoutUntil" | "login" | "logout" | "log" | "events"> = {
    addVideo: (v) => {
      mutate((s) => ({ ...s, videos: [v, ...s.videos] }));
      log("Uploaded video", "video", v.id, v.title);
    },
    updateVideo: (id, patch, action = "Edited video") => {
      mutate((s) => ({
        ...s,
        videos: s.videos.map((v) => (v.id === id ? { ...v, ...patch, updatedAt: new Date().toISOString() } : v)),
      }));
      log(action, "video", id, patch.title);
    },
    deleteVideos: (ids) => {
      mutate((s) => ({ ...s, videos: s.videos.filter((v) => !ids.includes(v.id)) }));
      log("Deleted video", "video", ids.join(","), `${ids.length} item(s)`);
    },
    publish: (ids) => {
      const errors: Record<string, string> = {};
      mutate((s) => ({
        ...s,
        videos: s.videos.map((v) => {
          if (!ids.includes(v.id)) return v;
          const err = validatePublish(v);
          if (err) {
            errors[v.id] = err;
            return v;
          }
          return { ...v, status: "PUBLISHED", publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        }),
      }));
      const published = ids.filter((id) => !errors[id]);
      if (published.length) log("Published video", "video", published.join(","), `${published.length} item(s)`);
      return { ok: Object.keys(errors).length === 0, errors };
    },
    unpublish: (ids) => {
      mutate((s) => ({
        ...s,
        videos: s.videos.map((v) => (ids.includes(v.id) ? { ...v, status: "UNPUBLISHED", updatedAt: new Date().toISOString() } : v)),
      }));
      log("Unpublished video", "video", ids.join(","), `${ids.length} item(s)`);
    },
    bulkFlag: (ids, flag, value) => {
      mutate((s) => ({ ...s, videos: s.videos.map((v) => (ids.includes(v.id) ? { ...v, [flag]: value } : v)) }));
      log(value ? `Marked ${flag}` : `Unmarked ${flag}`, "video", ids.join(","), `${ids.length} item(s)`);
    },
    upsertCategory: (c) => {
      mutate((s) => {
        const exists = s.categories.some((x) => x.slug === c.slug);
        return { ...s, categories: exists ? s.categories.map((x) => (x.slug === c.slug ? c : x)) : [...s.categories, c] };
      });
      log("Saved category", "category", c.slug, c.name);
    },
    deleteCategory: (slug) => {
      mutate((s) => ({ ...s, categories: s.categories.filter((c) => c.slug !== slug) }));
      log("Deleted category", "category", slug);
    },
    moveCategory: (slug, dir) => {
      mutate((s) => {
        const list = [...s.categories].sort((a, b) => a.order - b.order);
        const i = list.findIndex((c) => c.slug === slug);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return s;
        const tmp = list[i].order;
        list[i] = { ...list[i], order: list[j].order };
        list[j] = { ...list[j], order: tmp };
        return { ...s, categories: list };
      });
      log("Reordered category", "category", slug);
    },
    upsertTag: (name) => {
      mutate((s) => (s.tags.some((t) => t.name.toLowerCase() === name.toLowerCase()) ? s : { ...s, tags: [...s.tags, { name, createdAt: new Date().toISOString() }] }));
      log("Created tag", "tag", name);
    },
    renameTag: (oldName, newName) => {
      mutate((s) => ({
        ...s,
        tags: s.tags.map((t) => (t.name === oldName ? { ...t, name: newName } : t)),
        videos: s.videos.map((v) => (v.tags.includes(oldName) ? { ...v, tags: v.tags.map((t) => (t === oldName ? newName : t)) } : v)),
      }));
      log("Renamed tag", "tag", newName, `was "${oldName}"`);
    },
    mergeTags: (from, into) => {
      mutate((s) => ({
        ...s,
        tags: s.tags.filter((t) => !from.includes(t.name)),
        videos: s.videos.map((v) => ({ ...v, tags: [...new Set(v.tags.map((t) => (from.includes(t) ? into : t)))] })),
      }));
      log("Merged tags", "tag", into, from.join(", "));
    },
    deleteTag: (name) => {
      mutate((s) => ({
        ...s,
        tags: s.tags.filter((t) => t.name !== name),
        videos: s.videos.map((v) => ({ ...v, tags: v.tags.filter((t) => t !== name) })),
      }));
      log("Deleted tag", "tag", name);
    },
    saveSettings: (settings) => {
      mutate((s) => ({ ...s, settings }));
      log("Updated site settings", "settings", "site");
    },
    getVideoUrl: (v) => ephemeralSources.get(v.id) ?? (v.sourceEphemeral ? "" : v.videoUrl),
  };

  const value = useMemo<AdminCtx>(
    () => ({ state, session, demo: DEMO_MODE, lockoutUntil, login, logout, log, events, ...api }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, session, lockoutUntil]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Helpers used across admin pages                                     */
/* ------------------------------------------------------------------ */

export function newVideoId(): string {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueSlug(title: string, existing: AdminVideo[]): string {
  const base = slugify(title) || "video";
  let slug = base;
  let n = 2;
  while (existing.some((v) => v.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}
