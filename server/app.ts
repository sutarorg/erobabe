/**
 * ============================================================================
 * EroBabe secure API — single provider-agnostic router (Web-standard
 * Request/Response). Mounted by:
 *   • Vercel  → api/[...path].ts
 *   • Netlify → netlify/functions/api.ts
 *
 * SECURITY MODEL
 *  • Admin password exists only as a scrypt hash in ADMIN_PASSWORD_HASH.
 *  • Sessions are HMAC-signed HttpOnly cookies, verified server-side on
 *    every privileged request. Nothing privileged lives in localStorage.
 *  • Supabase service-role key and R2 credentials never leave this process.
 *  • Public endpoints expose status = 'PUBLISHED' rows only.
 *  • Login + upload + view endpoints are rate limited (fixed window).
 *  • Uploads go browser → R2 via presigned multipart URLs (server only
 *    signs; bytes never pass through this function).
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const env = (k: string, d = ""): string => {
  // Works in Node (process.env) and edge runtimes that inject globals.
  const p = (globalThis as any).process?.env?.[k];
  return p ?? (globalThis as any)[k] ?? d;
};

const CFG = {
  siteUrl: env("PUBLIC_SITE_URL", "http://localhost:5173"),
  supabaseUrl: env("SUPABASE_URL"),
  supabaseAnon: env("SUPABASE_ANON_KEY"),
  serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  r2: {
    accountId: env("R2_ACCOUNT_ID"),
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secret: env("R2_SECRET_ACCESS_KEY"),
    bucket: env("R2_BUCKET_NAME", "erobabe"),
    publicBase: env("R2_PUBLIC_BASE_URL"),
  },
  admin: { user: env("ADMIN_USERNAME"), passHash: env("ADMIN_PASSWORD_HASH") },
  sessionSecret: env("SESSION_SECRET"),
  processingProvider: env("PROCESSING_PROVIDER", ""), // e.g. "ffmpeg-worker"
  maxUploadBytes: Number(env("MAX_UPLOAD_BYTES", 2 * 1024 * 1024 * 1024)),
  allowedVideoTypes: ["video/mp4", "video/webm", "video/quicktime"],
};

/* ------------------------------------------------------------------ */
/* Tiny helpers                                                        */
/* ------------------------------------------------------------------ */

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const err = (status: number, message: string) => json({ error: message }, status);

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const uuid = () => (globalThis.crypto as any).randomUUID();

/* ------------------------------------------------------------------ */
/* Rate limiting (fixed window, per instance — good enough for basic   */
/* abuse protection; upgrade to Redis/Upstash for multi-instance)      */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { n: number; reset: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (b.n >= limit) return false;
  b.n++;
  return true;
}
const ipOf = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? "unknown";

/* ------------------------------------------------------------------ */
/* Sessions — HMAC-signed tokens in HttpOnly cookies                   */
/* ------------------------------------------------------------------ */

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CFG.sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

const TOKEN_TTL = 8 * 3600e3;

async function issueToken(user: string): Promise<string> {
  const payload = `${user}.${Date.now() + TOKEN_TTL}.${uuid()}`;
  return `${payload}.${await hmac(payload)}`;
}

async function verifyToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 4) return null;
  const sig = parts.pop()!;
  const payload = parts.join(".");
  if ((await hmac(payload)) !== sig) return null;
  const [user, exp] = payload.split(".");
  if (!user || Number(exp) < Date.now()) return null;
  return user;
}

const cookieFor = (token: string, maxAge: number) =>
  `eb_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CFG.siteUrl.startsWith("https") ? "; Secure" : ""}`;

const sessionUser = async (req: Request) => {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(/(?:^|;\s*)eb_admin=([^;]+)/)?.[1];
  return verifyToken(token);
};

/* ------------------------------------------------------------------ */
/* Password — scrypt hash: scrypt:N:salt_hex:hash_hex                  */
/* Generate with: node -e "crypto.scrypt('PASS','SALT',64,(e,k)=>console.log('scrypt:16384:SALT_HEX:'+k.toString('hex')))" */
/* ------------------------------------------------------------------ */

async function verifyPassword(pw: string): Promise<boolean> {
  const [scheme, nStr, saltHex, hashHex] = CFG.admin.passHash.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const N = Number(nStr) || 16384;
  // Node runtime path
  if ((globalThis as any).process?.versions?.node) {
    const { scrypt } = await import("node:crypto");
    const derived: Buffer = await new Promise((res, rej) =>
      scrypt(pw, Buffer.from(saltHex, "hex"), Buffer.from(hashHex, "hex").length, { N }, (e, k) => (e ? rej(e) : res(k)))
    );
    return Buffer.from(hashHex, "hex").equals(derived as Buffer);
  }
  return false; // require Node runtime for login
}

/* ------------------------------------------------------------------ */
/* Supabase (PostgREST) — service key server-side only                 */
/* ------------------------------------------------------------------ */

async function db(path: string, init: RequestInit = {}, service = true): Promise<any> {
  const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: service ? CFG.serviceKey : CFG.supabaseAnon,
      authorization: `Bearer ${service ? CFG.serviceKey : CFG.supabaseAnon}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* ------------------------------------------------------------------ */
/* Cloudflare R2 — presigned multipart uploads. AWS SDK is dynamically */
/* imported so local/demo builds don't need the dependency installed.  */
/* ------------------------------------------------------------------ */

function r2Configured(): boolean {
  return Boolean(CFG.r2.accountId && CFG.r2.accessKeyId && CFG.r2.secret && CFG.r2.bucket);
}

async function r2Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: `https://${CFG.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: CFG.r2.accessKeyId, secretAccessKey: CFG.r2.secret },
  });
}

async function r2Sign(commandName: "create" | "part" | "complete" | "abort", payload: Record<string, unknown>) {
  const client = await r2Client();
  const s3 = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const common = { Bucket: CFG.r2.bucket, ...payload } as any;
  if (commandName === "create") {
    const out = await client.send(new s3.CreateMultipartUploadCommand(common));
    return { uploadId: out.UploadId };
  }
  if (commandName === "part") {
    const url = await getSignedUrl(client, new s3.UploadPartCommand(common), { expiresIn: 3600 });
    return { url };
  }
  if (commandName === "complete") {
    const out = await client.send(new s3.CompleteMultipartUploadCommand(common));
    return { location: out.Location, etag: out.ETag };
  }
  await client.send(new s3.AbortMultipartUploadCommand(common));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Video processing provider abstraction                               */
/* ------------------------------------------------------------------ */

interface ProcessingJobInfo {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  progress: number;
  outputs?: Record<string, string>;
  error?: string;
}

interface VideoProcessingProvider {
  name: string;
  createJob(videoId: string, sourceKey: string): Promise<ProcessingJobInfo>;
  getJobStatus(jobId: string): Promise<ProcessingJobInfo>;
  cancelJob(jobId: string): Promise<void>;
}

/**
 * FFmpegWorkerProvider — posts to your own FFmpeg worker/service
 * (PROCESSING_PROVIDER_URL). Swap in Cloudflare Stream or another
 * provider by implementing the same interface; the admin UI never changes.
 */
class FFmpegWorkerProvider implements VideoProcessingProvider {
  name = "ffmpeg-worker";
  constructor(private url: string, private key: string) {}
  async createJob(videoId: string, sourceKey: string): Promise<ProcessingJobInfo> {
    const res = await fetch(`${this.url}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.key },
      body: JSON.stringify({ videoId, sourceKey, bucket: CFG.r2.bucket, renditions: ["360p", "480p", "720p", "1080p"], hls: true }),
    });
    if (!res.ok) throw new Error(`processing provider error ${res.status}`);
    return (await res.json()) as ProcessingJobInfo;
  }
  async getJobStatus(jobId: string): Promise<ProcessingJobInfo> {
    const res = await fetch(`${this.url}/jobs/${jobId}`, { headers: { "x-api-key": this.key } });
    if (!res.ok) throw new Error(`processing provider error ${res.status}`);
    return (await res.json()) as ProcessingJobInfo;
  }
  async cancelJob(jobId: string): Promise<void> {
    await fetch(`${this.url}/jobs/${jobId}`, { method: "DELETE", headers: { "x-api-key": this.key } });
  }
}

function getProcessingProvider(): VideoProcessingProvider | null {
  const url = env("PROCESSING_PROVIDER_URL");
  const key = env("PROCESSING_PROVIDER_API_KEY");
  if (CFG.processingProvider === "ffmpeg-worker" && url) return new FFmpegWorkerProvider(url, key);
  return null; // honest "not configured" state surfaced to the admin UI
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;
const routes: { method: string; pattern: RegExp; keys: string[]; admin?: boolean; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler, admin = false) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$"
  );
  routes.push({ method, pattern, keys, admin, handler });
}

const pub = (v: any) => ({
  id: v.id, slug: v.slug, title: v.title, description: v.description,
  category: v.category_slug, tags: v.tags ?? [], performer: v.performer,
  studio: v.studio, quality: v.quality, durationSec: v.duration_sec,
  views: v.views, thumbnail: v.thumbnail_url, videoUrl: v.playback_url,
  hlsUrl: v.hls_master_url, featured: v.featured, trending: v.trending,
  daysAgo: v.published_at ? Math.max(0, Math.floor((Date.now() - Date.parse(v.published_at)) / 864e5)) : 0,
  createdAt: v.created_at,
});

/* ------------------------------ PUBLIC ----------------------------- */

route("GET", "/videos", async (req) => {
  const url = new URL(req.url);
  const sort = url.searchParams.get("sort") ?? "popular";
  const cat = url.searchParams.get("category");
  const qp = new URLSearchParams({ select: "*", status: "eq.PUBLISHED" });
  if (cat) qp.set("category_slug", `eq.${cat}`);
  if (sort === "newest") qp.set("order", "published_at.desc");
  else if (sort === "trending") qp.set("order", "views.desc"); // see /trending for scored feed
  else qp.set("order", "views.desc");
  qp.set("limit", url.searchParams.get("limit") ?? "60");
  const rows = await db(`videos?${qp}`, {}, false);
  return json(rows.map(pub));
});

route("GET", "/videos/:id", async (_req, p) => {
  const qp = new URLSearchParams({ select: "*", status: "eq.PUBLISHED", or: `(id.eq.${p.id},slug.eq.${p.id})`, limit: "1" });
  const rows = await db(`videos?${qp}`, {}, false);
  if (!rows?.length) return err(404, "Video unavailable");
  return json(pub(rows[0]));
});

route("GET", "/categories", async () => json(await db("categories?select=*&order=sort_order.asc", {}, false)));

route("GET", "/trending", async (req) => {
  const limit = new URL(req.url).searchParams.get("limit") ?? "24";
  const rows = await db(`trending_videos?select=*&limit=${limit}`, {}, false);
  return json(rows.map(pub));
});

route("GET", "/popular", async () => json((await db("videos?select=*&status=eq.PUBLISHED&order=views.desc&limit=40", {}, false)).map(pub)));
route("GET", "/featured", async () => json((await db("videos?select=*&status=eq.PUBLISHED&featured=eq.true&order=published_at.desc&limit=8", {}, false)).map(pub)));

route("GET", "/search", async (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return json([]);
  const safe = q.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/\s+/g, " & ");
  const rows = await db(
    `videos?select=*&status=eq.PUBLISHED&textSearch=(title,description,performer)&q=${encodeURIComponent(safe)}&limit=40`,
    {}, false
  ).catch(() => db(`videos?select=*&status=eq.PUBLISHED&title=ilike.*${encodeURIComponent(q)}*&limit=40`, {}, false));
  return json((rows ?? []).map(pub));
});

route("POST", "/views", async (req) => {
  if (!rateLimit(`view:${ipOf(req)}`, 30, 60e3)) return err(429, "Rate limited");
  const body = await req.json().catch(() => null) as any;
  const videoId = String(body?.videoId ?? "");
  const seconds = Math.min(86400, Math.max(0, Number(body?.seconds ?? 0)));
  const session = String(body?.session ?? "").slice(0, 64);
  if (!videoId || !session || seconds < 3) return err(400, "Invalid view event");
  // anti-abuse: same session + video within 6h is ignored
  const dup = await db(
    `view_events?select=id&video_id=eq.${videoId}&session_id=eq.${encodeURIComponent(session)}&ts=gte.${new Date(Date.now() - 6 * 3600e3).toISOString()}&limit=1`
  );
  if (dup?.length) return json({ ok: true, counted: false, reason: "duplicate-window" });
  const exists = await db(`videos?select=id&id=eq.${videoId}&status=eq.PUBLISHED`);
  if (!exists?.length) return err(404, "Unknown video");
  await db("view_events", { method: "POST", body: JSON.stringify({ video_id: videoId, seconds, session_id: session }) });
  await db(`rpc/increment_views`, { method: "POST", body: JSON.stringify({ vid: videoId }) }).catch(() => null);
  return json({ ok: true, counted: true });
});

/* ------------------------------ ADMIN ------------------------------ */

route("POST", "/admin/login", async (req) => {
  const ip = ipOf(req);
  if (!rateLimit(`login:${ip}`, 5, 10 * 60e3)) return err(429, "Too many attempts — try again later");
  const body = await req.json().catch(() => null) as any;
  const user = String(body?.username ?? "");
  const pass = String(body?.password ?? "");
  const ok = Boolean(CFG.admin.user) && user === CFG.admin.user && (await verifyPassword(pass));
  if (!ok) return err(401, "Invalid credentials"); // generic — never reveal which part failed
  const token = await issueToken(user);
  return json(
    { ok: true, user },
    200,
    { "set-cookie": cookieFor(token, TOKEN_TTL / 1000), "content-type": "application/json" }
  );
});

route("POST", "/admin/logout", async () => json({ ok: true }, 200, { "set-cookie": cookieFor("", 0) }));
route("GET", "/admin/me", async (req) => json({ user: await sessionUser(req) }));

route("GET", "/admin/stats", async () => {
  const videos = await db("videos?select=id,status,views,duration_sec");
  const since = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const today = await db(`view_events?select=id&ts=gte.${since(24)}`);
  const week = await db(`view_events?select=id&ts=gte.${since(24 * 7)}`);
  return json({
    total: videos.length,
    published: videos.filter((v: any) => v.status === "PUBLISHED").length,
    drafts: videos.filter((v: any) => v.status === "DRAFT" || v.status === "READY").length,
    processing: videos.filter((v: any) => v.status === "PROCESSING").length,
    failed: videos.filter((v: any) => v.status === "FAILED").length,
    totalViews: videos.reduce((a: number, v: any) => a + (v.views ?? 0), 0),
    viewsToday: today?.length ?? 0,
    viewsWeek: week?.length ?? 0,
  });
});

route("GET", "/admin/videos", async () => json(await db("videos?select=*&order=updated_at.desc")));

route("POST", "/admin/videos", async (req) => {
  const body = (await req.json()) as any;
  if (!body?.title || !body?.category_slug) return err(400, "title and category_slug are required");
  const slug = body.slug ?? `${String(body.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${uuid().slice(0, 6)}`;
  const rows = await db("videos", { method: "POST", body: JSON.stringify({ ...body, slug, status: "DRAFT" }) });
  await db("activity_logs", { method: "POST", body: JSON.stringify({ action: "Created video", entity: "video", entity_id: rows[0].id, detail: rows[0].title }) });
  return json(rows[0], 201);
});

route("PATCH", "/admin/videos/:id", async (req, p) => {
  const body = (await req.json()) as any;
  delete body.id;
  const rows = await db(`videos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(body) });
  await db("activity_logs", { method: "POST", body: JSON.stringify({ action: "Edited video", entity: "video", entity_id: p.id }) });
  return json(rows?.[0] ?? {});
});

route("DELETE", "/admin/videos/:id", async (_req, p) => {
  // collect object keys then delete row; R2 deletion is best-effort here
  const rows = await db(`videos?select=original_key,thumbnail_url,hls_master_url&id=eq.${p.id}`);
  await db(`videos?id=eq.${p.id}`, { method: "DELETE" });
  await db("activity_logs", { method: "POST", body: JSON.stringify({ action: "Deleted video", entity: "video", entity_id: p.id, detail: JSON.stringify(rows?.[0] ?? {}) }) });
  return json({ ok: true, removedObjects: rows?.[0] ?? null });
});

async function changeStatus(p: Record<string, string>, status: string, req: Request) {
  const rows = await db(`videos?select=title,thumbnail_url,playback_url,hls_master_url,category_slug,status&id=eq.${p.id}`);
  const v = rows?.[0];
  if (!v) return err(404, "Not found");
  if (status === "PUBLISHED") {
    const missing: string[] = [];
    if (!v.thumbnail_url) missing.push("thumbnail");
    if (!v.playback_url && !v.hls_master_url) missing.push("playback source");
    if (!v.category_slug) missing.push("category");
    if (v.status === "PROCESSING") missing.push("processing to finish");
    if (missing.length) return err(422, `Cannot publish — missing ${missing.join(", ")}`);
  }
  await db(`videos?id=eq.${p.id}`, {
    method: "PATCH",
    body: JSON.stringify(status === "PUBLISHED" ? { status, published_at: new Date().toISOString() } : { status }),
  });
  await db("activity_logs", { method: "POST", body: JSON.stringify({ action: `${status === "PUBLISHED" ? "Published" : "Unpublished"} video`, entity: "video", entity_id: p.id, detail: v.title }) });
  void req;
  return json({ ok: true, status });
}
route("POST", "/admin/videos/:id/publish", (req, p) => changeStatus(p, "PUBLISHED", req));
route("POST", "/admin/videos/:id/unpublish", (req, p) => changeStatus(p, "UNPUBLISHED", req));

/* ------- upload: presigned multipart, direct browser → R2 ---------- */

route("POST", "/admin/upload/init", async (req) => {
  if (!rateLimit(`upload:${ipOf(req)}`, 20, 3600e3)) return err(429, "Upload rate limit reached");
  if (!r2Configured()) return err(501, "Cloudflare R2 is not configured (R2_* env vars missing)");
  const body = (await req.json()) as any;
  const size = Number(body?.size ?? 0);
  const type = String(body?.type ?? "");
  if (!CFG.allowedVideoTypes.includes(type)) return err(415, `Unsupported content type "${type}"`);
  if (size <= 0 || size > CFG.maxUploadBytes) return err(413, `File size must be 1 byte – ${CFG.maxUploadBytes} bytes`);
  const videoId = uuid();
  const key = `originals/${videoId}/source.${type === "video/quicktime" ? "mov" : type.split("/")[1]}`;
  const { uploadId } = await r2Sign("create", { Key: key, ContentType: type });
  const parts = Math.max(1, Math.ceil(size / (64 * 1024 * 1024))); // 64 MiB parts
  return json({ videoId, key, uploadId, partSize: 64 * 1024 * 1024, parts });
});

route("POST", "/admin/upload/sign-part", async (req) => {
  const body = (await req.json()) as any;
  const { key, uploadId, partNumber } = body ?? {};
  if (!key || !uploadId || !partNumber || String(key).includes("..")) return err(400, "Invalid part request");
  return json(await r2Sign("part", { Key: key, UploadId: uploadId, PartNumber: partNumber }));
});

route("POST", "/admin/upload/complete", async (req) => {
  const body = (await req.json()) as any;
  const { key, uploadId, parts } = body ?? {};
  if (!key || !uploadId || !Array.isArray(parts)) return err(400, "Invalid completion request");
  const out = await r2Sign("complete", { Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } });
  const videoId = String(key).split("/")[1];
  const playback = CFG.r2.publicBase ? `${CFG.r2.publicBase}/${key}` : out.location;
  await db("videos", {
    method: "POST",
    body: JSON.stringify({
      id: videoId, title: "Untitled upload", slug: `video-${videoId.slice(0, 8)}`, status: "PROCESSING",
      original_key: key, playback_url: playback,
    }),
  });
  const provider = getProcessingProvider();
  if (!provider) {
    await db(`videos?id=eq.${videoId}`, { method: "PATCH", body: JSON.stringify({ status: "READY", error: null }) });
    return json({ ok: true, videoId, playback, processing: "not-configured", message: "Processing provider not configured — original file ready as single-source." });
  }
  const job = await provider.createJob(videoId, key);
  await db("processing_jobs", { method: "POST", body: JSON.stringify({ id: job.id, video_id: videoId, provider: provider.name, status: job.status }) });
  return json({ ok: true, videoId, playback, processing: job.status, jobId: job.id });
});

/* ------- categories / tags ------- */

route("POST", "/admin/categories", async (req) => json((await db("categories", { method: "POST", body: JSON.stringify(await req.json()) }))[0], 201));
route("PATCH", "/admin/categories/:slug", async (req, p) => json(await db(`categories?slug=eq.${p.slug}`, { method: "PATCH", body: JSON.stringify(await req.json()) })));
route("DELETE", "/admin/categories/:slug", async (_req, p) => json(await db(`categories?slug=eq.${p.slug}`, { method: "DELETE" })));
route("POST", "/admin/tags", async (req) => json((await db("tags", { method: "POST", body: JSON.stringify(await req.json()) }))[0], 201));
route("DELETE", "/admin/tags/:name", async (_req, p) => json(await db(`tags?name=eq.${encodeURIComponent(p.name)}`, { method: "DELETE" })));

/* ------- analytics / storage / activity / settings ------- */

route("GET", "/admin/analytics", async (req) => {
  const days = Math.min(90, Number(new URL(req.url).searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const events = await db(`view_events?select=video_id,ts,seconds,session_id&ts=gte.${since}&order=ts.asc&limit=20000`);
  return json({ days, events: events ?? [] });
});

route("GET", "/admin/storage", async () => {
  const videos = await db("videos?select=id,original_key,thumbnail_url,hls_master_url,duration_sec");
  return json({ videos: videos ?? [], r2Configured: r2Configured(), note: r2Configured() ? "Exact bucket sizes require the Cloudflare GraphQL analytics API (account token)." : "R2 not configured" });
});

route("GET", "/admin/activity", async () => json(await db("activity_logs?select=*&order=ts.desc&limit=200")));

route("GET", "/admin/settings", async () => json(await db("site_settings?select=*")));
route("PUT", "/admin/settings", async (req) => {
  const body = (await req.json()) as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    await db("site_settings", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ key, value }) });
  }
  await db("activity_logs", { method: "POST", body: JSON.stringify({ action: "Updated site settings", entity: "settings", entity_id: "site" }) });
  return json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/.netlify\/functions\/api/, "") || "/";
  const method = req.method.toUpperCase();

  // CORS: only the configured site origin may call mutating routes
  const origin = req.headers.get("origin");
  const corsHeaders: Record<string, string> = {};
  if (origin && (origin === CFG.siteUrl || origin.endsWith(new URL(CFG.siteUrl).host))) {
    corsHeaders["access-control-allow-origin"] = origin;
    corsHeaders["access-control-allow-credentials"] = "true";
    corsHeaders["vary"] = "Origin";
  }
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...corsHeaders, "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-allow-headers": "content-type" } });
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

    if (r.admin) {
      if (path === "/admin/login") {
        // login handles its own rate limiting
      } else {
        const user = await sessionUser(req);
        if (!user) return err(401, "Unauthorized");
        // naive CSRF mitigation for cookie sessions: mutations must share origin
        if (method !== "GET" && origin && !corsHeaders["access-control-allow-origin"]) {
          return err(403, "Cross-origin request rejected");
        }
      }
    }

    try {
      const res = await r.handler(req, params);
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set("x-content-type-options", "nosniff");
      res.headers.set("x-frame-options", "DENY");
      return res;
    } catch (e) {
      return json({ error: "Internal error", detail: e instanceof Error ? e.message.slice(0, 160) : "unknown" }, 500, corsHeaders);
    }
  }
  return err(404, "Not found");
}

// mark admin-protected routes
routes.forEach((r) => {
  if (r.pattern.source.includes("admin")) r.admin = true;
});
