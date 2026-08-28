/* Typed client for the EroBabe admin API. Session is an HttpOnly cookie. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    credentials: "same-origin",
    headers: {
      "x-requested-with": "erobabe",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (res.status === 401 && path !== "/auth/login" && path !== "/auth/me") {
    window.dispatchEvent(new CustomEvent("eb-admin-unauthorized"));
  }
  if (!res.ok) {
    throw new ApiError(String(data?.error ?? `Request failed (${res.status})`), res.status, data?.code as string);
  }
  return data as T;
}

/* ── Types ── */

export type VideoStatus = "uploading" | "draft" | "processing" | "ready" | "published" | "unpublished";

export interface Rendition {
  label: string;
  url: string;
  kind?: string;
}

export interface AdminVideo {
  id: string;
  /** SEO slug powering the public /video/{slug} page. */
  slug: string | null;
  title: string;
  description: string | null;
  status: VideoStatus;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  tags: string[];
  duration_s: number | null;
  views: number;
  like_ratio: number;
  seo_title: string | null;
  seo_description: string | null;
  video_url: string | null;
  hls_url: string | null;
  thumbnail_url: string | null;
  source_size: number;
  content_type: string | null;
  renditions: Rendition[];
  featured: boolean;
  trending: boolean;
  editors_pick: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  upload_id: string | null;
  upload_key: string | null;
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  gradient: string;
  image_url: string | null;
  /** Icon key from the shared category-icon registry. */
  icon: string | null;
  sort: number;
  count: number;
  created_at: string;
}

export interface ActivityItem {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Overview {
  totals: {
    videos: number;
    published: number;
    drafts: number;
    processing: number;
    views: number;
    storageBytes: number;
    objects: number;
    impressions: number;
    clicks: number;
    ctr: number;
  };
  series: { day: string; views: number }[];
  recentActivity: ActivityItem[];
  topVideos: { id: string; title: string; views: number; thumbnail_url: string | null }[];
}

export interface VideoListResponse {
  items: AdminVideo[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

export interface SinglePlan {
  mode: "single";
  videoId: string;
  key: string;
  url: string;
  replace: boolean;
}
export interface MultiPlan {
  mode: "multipart";
  videoId: string;
  key: string;
  uploadId: string;
  chunkSize: number;
  parts: { partNumber: number; url: string; size: number }[];
  replace: boolean;
}
export type UploadPlan = SinglePlan | MultiPlan;

/** Featured/Trending are algorithm-controlled — no manual bulk actions for them. */
export type BulkAction = "publish" | "unpublish" | "delete";

export interface SiteSettings {
  site_title?: string;
  announcement?: string | null;
  hero_enabled?: boolean;
  featured_video_id?: string | null;
  age_text?: string | null;
}

/* ── API surface ── */

const qs = (params: Record<string, string | number | undefined | null>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

export const api = {
  login: (username: string, password: string) =>
    req<{ ok: boolean; twoFactorRequired: boolean; user: { username: string } | null }>(
      "/auth/login",
      { body: { username, password } }
    ),
  verify2FA: (code: string) =>
    req<{ ok: boolean; user: { username: string }; usedRecovery: boolean }>("/auth/2fa/verify", {
      body: { code },
    }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { body: {} }),
  me: () =>
    req<{
      user: { username: string } | null;
      twoFactorRequired?: boolean;
      twoFactorEnabled?: boolean;
      pending?: string;
    }>("/auth/me"),

  twoFactorStatus: () =>
    req<{ enabled: boolean; enrolledAt: string | null; recoveryRemaining: number; account: string }>(
      "/auth/2fa/status"
    ),
  twoFactorSetup: () =>
    req<{ secret: string; otpauth: string; account: string; issuer: string }>("/auth/2fa/setup", {
      body: {},
    }),
  twoFactorEnable: (code: string) =>
    req<{ ok: boolean; recoveryCodes: string[] }>("/auth/2fa/enable", { body: { code } }),
  twoFactorDisable: (password: string, code: string) =>
    req<{ ok: boolean }>("/auth/2fa/disable", { body: { password, code } }),
  twoFactorRecoveryCodes: (code: string) =>
    req<{ ok: boolean; recoveryCodes: string[] }>("/auth/2fa/recovery-codes", { body: { code } }),

  overview: () => req<Overview>("/overview"),
  analytics: (days: number) =>
    req<{
      series: { day: string; views: number }[];
      rangeViews: number;
      topVideos: AdminVideo[];
      rangeTop: { id: string; views: number }[];
      storage: { bytes: number; objects: number; lifetimeViews: number };
    }>(`/analytics?days=${days}`),

  videos: (params: Record<string, string | number | undefined>) =>
    req<VideoListResponse>(`/videos?${qs(params)}`),
  video: (id: string) => req<{ video: AdminVideo }>(`/videos/${id}`),
  patchVideo: (id: string, patch: Record<string, unknown>) =>
    req<{ video: AdminVideo }>(`/videos/${id}`, { method: "PATCH", body: patch }),
  publish: (id: string) => req<{ video: AdminVideo }>(`/videos/${id}/publish`, { body: {} }),
  unpublish: (id: string) => req<{ video: AdminVideo }>(`/videos/${id}/unpublish`, { body: {} }),
  deleteVideo: (id: string) => req<{ ok: boolean }>(`/videos/${id}`, { method: "DELETE" }),
  bulk: (ids: string[], action: BulkAction) =>
    req<{ ok: boolean; done: number; total: number }>("/videos/bulk", { body: { ids, action } }),

  createUpload: (body: {
    fileName: string;
    size: number;
    contentType: string;
    durationS?: number | null;
    replaceId?: string;
    /** Fingerprint of the original source file (duplicate detection). */
    contentHash?: string;
    /** Groups videos uploaded in one bulk action. */
    bulkBatch?: string;
    title?: string;
  }) => req<SinglePlan | MultiPlan>("/uploads", { body }),

  checkDuplicate: (hash: string, title?: string) =>
    req<{ available: boolean; duplicate: DuplicateMatch | null; reason: "file" | "title" | null }>(
      "/videos/check-duplicate",
      { body: { hash, title } }
    ),
  scheduleVideo: (id: string, at: string | null) =>
    req<{ video: AdminVideo }>(`/videos/${id}/schedule`, { body: { at } }),
  scheduled: () =>
    req<{ available: boolean; scheduled: ScheduledVideo[] }>("/schedule"),
  publishDue: () => req<{ ok: boolean; published: number }>("/publish-due", { body: {} }),
  presignParts: (videoId: string, partNumbers: number[]) =>
    req<{ parts: { partNumber: number; url: string }[] }>(`/uploads/${videoId}/parts`, { body: { partNumbers } }),
  completeUpload: (videoId: string, body: { parts?: { partNumber: number; etag: string }[]; durationS?: number | null }) =>
    req<{ ok: boolean; video: AdminVideo; processingMode: string }>(`/uploads/${videoId}/complete`, { body }),
  abortUpload: (videoId: string) => req<{ ok: boolean }>(`/uploads/${videoId}/abort`, { body: {} }),
  uploadMedia: (body: { dataUrl: string; kind?: "thumbnail" | "media"; refId?: string }) =>
    req<{ ok: boolean; url: string; key: string }>("/media", { body }),

  categories: () => req<{ categories: AdminCategory[] }>("/categories"),
  createCategory: (body: { name: string; slug?: string; blurb?: string; gradient?: string; icon?: string }) =>
    req<{ category: AdminCategory }>("/categories", { body }),
  patchCategory: (id: string, patch: Record<string, unknown>) =>
    req<{ category: AdminCategory }>(`/categories/${id}`, { method: "PATCH", body: patch }),
  deleteCategory: (id: string) => req<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),

  tags: () => req<{ tags: { name: string; count: number }[] }>("/tags"),
  removeTag: (tag: string) => req<{ ok: boolean; removed: number }>("/tags/remove", { body: { tag } }),

  settings: () => req<{ settings: SiteSettings }>("/settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    req<{ settings: SiteSettings }>("/settings", { method: "PATCH", body: patch }),

  activity: (limit = 50) => req<{ activity: ActivityItem[] }>(`/activity?limit=${limit}`),

  traffic: (days: number) => req<TrafficResponse>(`/analytics/traffic?days=${days}`),
  videoAnalytics: (id: string, days: number) =>
    req<VideoAnalyticsResponse>(`/videos/${id}/analytics?days=${days}`),
};

export interface DuplicateMatch {
  id: string;
  slug?: string | null;
  title: string;
  status: VideoStatus;
  thumbnail_url: string | null;
  created_at: string;
}

export interface ScheduledVideo {
  id: string;
  title: string;
  status: VideoStatus;
  thumbnail_url: string | null;
  scheduled_publish_at: string;
  bulk_batch: string | null;
}

export interface Share {
  name: string;
  count: number;
  share: number;
}

export interface TrafficResponse {
  available: boolean;
  days: number;
  total: number;
  sources: Share[];
  referrers: Share[];
  devices: Share[];
  series: { day: string; direct: number; search: number; social: number; referral: number; internal: number }[];
}

export interface VideoAnalyticsResponse {
  video: {
    id: string;
    slug: string | null;
    title: string;
    status: VideoStatus;
    thumbnail_url: string | null;
    duration_s: number;
    views: number;
    likes: number;
    like_ratio: number;
    published_at: string | null;
    created_at: string;
    tags: string[];
  };
  days: number;
  performance: {
    rangeViews: number;
    lifetimeViews: number;
    uniqueViewers: number;
    repeatRate: number;
    avgWatchSeconds: number;
    totalWatchSeconds: number;
    avgCompletion: number;
    trackedSessions: number;
  };
  engagement: { likes: number; likeRatio: number; engagementRate: number; viewsPerDay: number };
  retention: { pct: number; share: number }[];
  series: { day: string; views: number }[];
  discovery: { sources: Share[]; referrers: Share[] };
  audience: { devices: Share[] };
}
