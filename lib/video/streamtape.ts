/**
 * Streamtape file-manager client — server-only.
 *
 * Reads thumbnail images from the file manager into Erobabe storage, and
 * resolves fresh media download links for native playback of legacy videos.
 * Video links are issued and consumed server-side on demand (they can be
 * IP-bound), never persisted as playable_url or sent to the visitor. Public
 * playback streams media bytes, never the Streamtape advertising iframe.
 *
 * Credentials are `STREAMTAPE_LOGIN` and `STREAMTAPE_API_KEY`. They are
 * server-only: they are added to the query string of a server-side fetch and
 * must never reach a browser, a log line, or an audit row. Every error this
 * module throws is scrubbed of the request URL.
 *
 * Endpoint contract (https://streamtape.com/api): base
 * `https://api.streamtape.com`, HTTPS only, `login` + `key` query parameters,
 * envelope `{ status, msg, result }`. The **envelope** status — not the HTTP
 * status — decides success (200 OK · 400 · 403 · 404 · 451 legal · 509
 * bandwidth · 50x).
 */

export const STREAMTAPE_API_BASE = "https://api.streamtape.com";

export const STREAMTAPE_LIST_TIMEOUT_MS = 20_000;
export const STREAMTAPE_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Largest image we will pull out of the file manager. */
export const STREAMTAPE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Longest we will wait out a `wait_time` returned by `/file/dlticket`. */
const MAX_TICKET_WAIT_SECONDS = 15;

export type StreamtapeCredentials = { login: string; key: string };

export type StreamtapeErrorCode =
  | "not_configured"
  | "unreachable"
  | "unauthorized"
  | "not_found"
  | "bandwidth"
  | "unavailable"
  | "bad_response";

export class StreamtapeError extends Error {
  readonly code: StreamtapeErrorCode;

  constructor(message: string, code: StreamtapeErrorCode) {
    super(message);
    this.name = "StreamtapeError";
    this.code = code;
  }
}

/** Reads the server-only credentials. `null` when either one is missing. */
export function streamtapeCredentials(): StreamtapeCredentials | null {
  const login = String(process.env.STREAMTAPE_LOGIN || "").trim();
  const key = String(process.env.STREAMTAPE_API_KEY || "").trim();
  if (!login || !key) return null;
  return { login, key };
}

export function streamtapeConfigured(): boolean {
  return streamtapeCredentials() !== null;
}

export const STREAMTAPE_NOT_CONFIGURED_MESSAGE =
  "Streamtape is not configured — set the STREAMTAPE_LOGIN and STREAMTAPE_API_KEY server variables (Streamtape panel → Account Settings), then redeploy.";

/**
 * Strips credentials off a URL before it can reach a log or a browser. The
 * login and key travel in the query string, so every failure path goes through
 * this instead of echoing `error.message` from `fetch`.
 */
export function redactStreamtapeUrl(value: unknown): string {
  return String(value ?? "")
    .replace(/([?&])(login|key)=[^&]*/gi, "$1$2=<redacted>")
    .replace(/\b(login|key)=[^&\s]+/gi, "$1=<redacted>");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maps an envelope status onto an actionable, credential-free message. */
function errorForStatus(status: number, msg: unknown, path: string): StreamtapeError {
  const detail = String(msg ?? "").trim().slice(0, 200);
  switch (status) {
    case 401:
    case 403:
      return new StreamtapeError(
        "Streamtape rejected the API login/key. Copy the current API Login and API Key from the Streamtape panel → Account Settings and update the server variables.",
        "unauthorized"
      );
    case 404:
      return new StreamtapeError(
        `Streamtape could not find that ${path.startsWith("file/") ? "file" : "resource"} (404). It may have been deleted from the file manager.`,
        "not_found"
      );
    case 451:
      return new StreamtapeError("Streamtape refused this file for legal reasons (451).", "unavailable");
    case 509:
      return new StreamtapeError("The Streamtape account is out of bandwidth (509).", "bandwidth");
    case 429:
      return new StreamtapeError("Streamtape is rate-limiting this account. Try again shortly.", "unavailable");
    default:
      return new StreamtapeError(
        `Streamtape answered with status ${status}${detail ? ` (${detail})` : ""} for ${path}.`,
        "bad_response"
      );
  }
}

/**
 * One call against the Streamtape API. Returns `result`, whatever shape it has.
 *
 * Every failure is mapped to a {@link StreamtapeError} whose message is safe to
 * show an admin: no credentials, no request URL, no stack.
 */
export async function streamtapeCall(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
  timeoutMs: number = STREAMTAPE_LIST_TIMEOUT_MS
): Promise<unknown> {
  const credentials = streamtapeCredentials();
  if (!credentials) throw new StreamtapeError(STREAMTAPE_NOT_CONFIGURED_MESSAGE, "not_configured");

  const url = new URL(`${STREAMTAPE_API_BASE}/${String(path).replace(/^\/+/, "")}`);
  url.searchParams.set("login", credentials.login);
  url.searchParams.set("key", credentials.key);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new StreamtapeError("Streamtape did not answer in time. Try again.", "unreachable");
    }
    throw new StreamtapeError("Could not reach the Streamtape API. Try again.", "unreachable");
  }

  const text = await response.text().catch(() => "");
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // `/file/dl` and `/file/getsplash` are documented to answer with a bare
    // string, and some nodes answer with `text/plain`. Anything else that is
    // not JSON and not OK is an upstream error page we must not echo.
    if (response.ok && text.trim()) return text.trim();
  }

  if (payload && typeof payload === "object" && "status" in payload) {
    const status = Number(payload.status);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw errorForStatus(Number.isFinite(status) ? status : response.status, payload.msg, path);
    }
    return payload.result;
  }

  if (!response.ok) {
    throw errorForStatus(response.status, null, path);
  }

  return payload ?? text;
}

/* ------------------------------------------------------------------------- */
/* Account                                                                    */
/* ------------------------------------------------------------------------- */

/** `GET /account/info` — the health check. Never throws the credentials. */
export async function getAccountInfo(): Promise<{ email?: string; balance?: number } | null> {
  const result = await streamtapeCall("account/info");
  if (!result || typeof result !== "object") return null;
  const row = result as Record<string, unknown>;
  return {
    email: typeof row.email === "string" ? row.email : undefined,
    balance: Number.isFinite(Number(row.balance)) ? Number(row.balance) : undefined,
  };
}

/* ------------------------------------------------------------------------- */
/* File manager                                                               */
/* ------------------------------------------------------------------------- */

export type StreamtapeFolder = { id: string; name: string };
export type StreamtapeFile = {
  /** The id every other file endpoint takes (`linkid`). */
  linkid: string;
  name: string;
  size?: number | null;
};

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    // Some answers key files by their link id instead of returning a list.
    return Object.values(value as Record<string, unknown>);
  }
  return [];
}

function toFolder(value: unknown): StreamtapeFolder | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? row.folderid ?? row.folder_id ?? "").trim();
  const name = String(row.name ?? row.title ?? "").trim();
  if (!id) return null;
  return { id, name: name || id };
}

function toFile(value: unknown): StreamtapeFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const linkid = String(row.linkid ?? row.id ?? row.file ?? "").trim();
  const name = String(row.name ?? row.title ?? "").trim();
  if (!linkid) return null;
  const size = Number(row.size ?? row.bytes ?? NaN);
  return { linkid, name, size: Number.isFinite(size) ? size : null };
}

export type FolderListing = { folders: StreamtapeFolder[]; files: StreamtapeFile[] };

/**
 * `GET /file/listfolder` — one folder's sub-folders and files.
 *
 * Omitting `folder` lists the account root. The response shape is tolerated
 * defensively (list, map, or `result.files` only) because Streamtape does not
 * document it beyond the happy path.
 */
export async function listFolder(folderId?: string | null): Promise<FolderListing> {
  const result = await streamtapeCall("file/listfolder", folderId ? { folder: folderId } : {});

  const source = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const folders = toArray(source.folders ?? source.folder)
    .map(toFolder)
    .filter((folder): folder is StreamtapeFolder => folder !== null);
  const files = toArray(
    source.files ?? (Array.isArray(result) ? result : null) ?? (result && typeof result === "object" && !source.folders && !source.files ? result : null)
  )
    .map(toFile)
    .filter((file): file is StreamtapeFile => file !== null);

  return { folders, files };
}

export type FolderPath = { id: string; name: string; path: string; depth: number };

/**
 * Walks the file manager looking for the thumbnails folder.
 *
 * The admin only knows the folder by its file-manager path (`home/thumbnails`),
 * so the id is discovered instead of demanded: an explicit
 * `STREAMTAPE_THUMBNAIL_FOLDER_ID` wins, otherwise the tree is searched
 * breadth-first to a shallow depth and the best-named match is used.
 */
export async function findFolder(
  wantedName: string,
  options: { folderId?: string; maxDepth?: number; maxFolders?: number } = {}
): Promise<FolderPath | null> {
  // An explicit id needs no search — and must not fail if the folder is empty.
  if (options.folderId) {
    const id = String(options.folderId).trim();
    return { id, name: wantedName || id, path: wantedName || id, depth: 0 };
  }

  const target = normalizeFolderName(wantedName);
  const maxDepth = options.maxDepth ?? 3;
  const maxFolders = options.maxFolders ?? 40;

  let best: FolderPath | null = null;
  let bestScore = 0;

  const queue: FolderPath[] = [{ id: "", name: "", path: "", depth: 0 }];
  let visited = 0;

  while (queue.length) {
    const current = queue.shift() as FolderPath;
    if (visited >= maxFolders) break;
    visited += 1;

    let listing: FolderListing;
    try {
      listing = await listFolder(current.id || null);
    } catch {
      continue;
    }

    for (const folder of listing.folders) {
      const path = current.path ? `${current.path}/${folder.name}` : folder.name;
      const entry: FolderPath = { id: folder.id, name: folder.name, path, depth: current.depth + 1 };
      const score = folderNameScore(target, folder.name, path);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
      if (current.depth + 1 < maxDepth) queue.push(entry);
    }
  }

  return bestScore > 0 ? best : null;
}

/** Normalises a folder name for comparison: `Home/Thumbs-1` → `home thumbs 1`. */
export function normalizeFolderName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How strongly a folder looks like the thumbnails folder.
 *
 * `0` means "not it". Exact name matches beat path-suffix matches, which beat a
 * folder that merely contains the word. Common misspellings
 * (`thumnails`, `thumbs`) are accepted because the folder is typed by hand in
 * the Streamtape panel.
 */
export function folderNameScore(target: string, name: string, path: string): number {
  const wanted = normalizeFolderName(target);
  if (!wanted) return 0;

  const folderName = normalizeFolderName(name);
  const folderPath = normalizeFolderName(path);
  if (!folderName) return 0;

  if (folderName === wanted) return 1;
  if ((wanted === "thumbnails" || wanted === "thumbnail") && /^thum(b|n)?(nail)?s?$/.test(folderName)) return 0.98;

  const pathParts = folderPath.split(" ").filter(Boolean);
  if (pathParts.length && pathParts[pathParts.length - 1] === wanted) return 0.9;
  if (folderPath.endsWith(` ${wanted}`)) return 0.9;
  if (folderPath === wanted) return 0.88;
  if (pathParts.includes(wanted)) return 0.7;
  if (folderName.includes(wanted)) return 0.5;
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Downloading                                                                */
/* ------------------------------------------------------------------------- */

/**
 * `GET /file/getsplash` — the splash image Streamtape generated for a video.
 *
 * Only useful for video files; images in the file manager have no splash. It is
 * kept as a fallback for an admin who pointed the thumbnails folder at the
 * videos themselves.
 */
export async function getSplashUrl(fileId: string): Promise<string | null> {
  const result = await streamtapeCall("file/getsplash", { file: fileId }, STREAMTAPE_LIST_TIMEOUT_MS);
  const value = typeof result === "string" ? result : String((result as any)?.url ?? "");
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Reads a `/file/dlticket` → `/file/dl` pair into a direct download URL. */
export async function createDownloadUrl(fileId: string): Promise<string> {
  const ticket = (await streamtapeCall("file/dlticket", { file: fileId }, STREAMTAPE_DOWNLOAD_TIMEOUT_MS)) as any;
  const ticketValue = typeof ticket === "string" ? ticket : String(ticket?.ticket ?? "");
  const waitSeconds = Math.min(Math.max(Number(ticket?.wait_time ?? 0) || 0, 0), MAX_TICKET_WAIT_SECONDS);

  if (!ticketValue) throw new StreamtapeError("Streamtape did not return a download ticket for that file.", "bad_response");
  if (waitSeconds > 0) await sleep(waitSeconds * 1000);

  const download = (await streamtapeCall(
    "file/dl",
    { file: fileId, ticket: ticketValue },
    STREAMTAPE_DOWNLOAD_TIMEOUT_MS
  )) as any;

  const url = (typeof download === "string" ? download : String(download?.url ?? "")).trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new StreamtapeError("Streamtape did not return a download link for that file.", "bad_response");
  }
  return url;
}

export type DownloadedImage = {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
};

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif)$/i;

function contentTypeFromName(fileName: string): string | null {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  return null;
}

/**
 * Downloads one file from the Streamtape file manager and checks it really is
 * an image before it is handed to storage.
 *
 * The size is capped while streaming so a mis-picked video cannot pull 2 GB
 * into a serverless function: the first bytes over the cap end the read.
 */
export async function downloadImage(fileId: string, fallbackName = ""): Promise<DownloadedImage> {
  const url = await createDownloadUrl(fileId);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(STREAMTAPE_DOWNLOAD_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new StreamtapeError("The thumbnail download timed out. Try again.", "unreachable");
    }
    throw new StreamtapeError("Could not download the thumbnail from Streamtape.", "unreachable");
  }

  if (!response.ok) {
    throw new StreamtapeError(`Streamtape answered the thumbnail download with HTTP ${response.status}.`, "bad_response");
  }

  const headerType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const pathName = (() => {
    try {
      return new URL(response.url || url).pathname;
    } catch {
      return "";
    }
  })();

  const contentType = headerType && headerType.startsWith("image/") ? headerType : contentTypeFromName(pathName);
  if (!contentType) {
    throw new StreamtapeError(
      "That Streamtape file is not an image. Point the thumbnails folder at JPG/PNG/WebP files whose names match the videos.",
      "bad_response"
    );
  }

  const stream = response.body;
  let bytes: Uint8Array;
  if (stream && typeof (stream as any).getReader === "function") {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > STREAMTAPE_MAX_IMAGE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new StreamtapeError("That thumbnail is larger than 10 MB.", "bad_response");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > STREAMTAPE_MAX_IMAGE_BYTES) {
      throw new StreamtapeError("That thumbnail is larger than 10 MB.", "bad_response");
    }
    bytes = new Uint8Array(buffer);
  }

  if (!bytes.byteLength) throw new StreamtapeError("Streamtape returned an empty thumbnail.", "bad_response");

  const nameFromUrl = decodeURIComponent(pathName.split("/").pop() || "");
  const fileName = IMAGE_EXTENSIONS.test(nameFromUrl) ? nameFromUrl : fallbackName || "thumbnail.jpg";

  return { bytes, contentType, fileName };
}
