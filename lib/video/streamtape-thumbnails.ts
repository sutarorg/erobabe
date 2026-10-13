/**
 * Attaching the thumbnails an admin keeps in the Streamtape file manager.
 *
 * How it works: the admin stores one image per video in a file-manager folder
 * (for example `home/thumbnails`) whose file names match the video. This module
 * lists that folder over the Streamtape API, matches each video to an image by
 * name, copies the image into Erobabe's own public `video-thumbnails` bucket,
 * and writes the resulting public URL onto the video row.
 *
 * Why copy instead of linking: Streamtape download links are ticketed and
 * expire. A public page must never render a URL that stops working an hour
 * later, so the bytes are mirrored once and the stored URL is ours.
 *
 * Server-only. Credentials never leave the server and never appear in a result.
 */

import { randomUUID } from "crypto";
import type { ServiceClient } from "@/lib/video/publishing";
import { ensureStorageBuckets, THUMBNAIL_BUCKET, removeThumbnailObject } from "@/lib/video/storage";
import {
  downloadImage,
  findFolder,
  listFolder,
  StreamtapeError,
  STREAMTAPE_NOT_CONFIGURED_MESSAGE,
  streamtapeConfigured,
  type FolderPath,
  type StreamtapeFile,
} from "./streamtape";

/** Default file-manager folder to look in when no id is configured. */
export const DEFAULT_THUMBNAIL_FOLDER_NAME = "thumbnails";

export function thumbnailFolderName(): string {
  const configured = String(process.env.STREAMTAPE_THUMBNAIL_FOLDER_NAME || "").trim();
  return configured || DEFAULT_THUMBNAIL_FOLDER_NAME;
}

export function thumbnailFolderId(): string {
  return String(process.env.STREAMTAPE_THUMBNAIL_FOLDER_ID || "").trim();
}

export function streamtapeThumbnailsConfigured(): boolean {
  return streamtapeConfigured();
}

export type ThumbnailTarget = {
  id: string;
  slug: string;
  title: string;
  thumbnail_url: string | null;
  playable_url?: string | null;
  embed_url?: string | null;
  source_key?: string | null;
  /** Extra file names to match on (the original upload name, for example). */
  extraNames?: string[];
};

/* ------------------------------------------------------------------------- */
/* Name matching                                                             */
/* ------------------------------------------------------------------------- */

/** Container suffixes that must not stop two names from matching. */
const MEDIA_EXTENSIONS =
  "mp4|ts|mkv|mov|webm|m4v|avi|flv|wmv|m2ts|mpg|mpeg|3gp|jpg|jpeg|png|gif|webp|avif";

/** Tokens that carry no identity: resolution, container, and site noise. */
const NOISE_TOKENS = new Set([
  "mp4",
  "mkv",
  "webm",
  "mov",
  "avi",
  "wmv",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "1080p",
  "720p",
  "480p",
  "2160p",
  "1440p",
  "4k",
  "8k",
  "hd",
  "fhd",
  "uhd",
  "sd",
  "h264",
  "x264",
  "h265",
  "hevc",
  "www",
  "com",
  "net",
  "org",
  "the",
  "a",
  "an",
  "thumb",
  "thumbs",
  "thumbnail",
  "thumbnails",
  "thumnail",
  "thumnails",
  "poster",
  "cover",
  "final",
  "copy",
  "new",
  "official",
  "video",
  "vid",
  "clip",
  "scene",
]);

/**
 * Reduces a file name or a title to the key two records are compared on:
 * `Petite_Desi.Amateur-1080p.jpg` → `petite desi amateur 1080p`.
 *
 * Deliberately lossy — separators, case, brackets, extensions, and a leading
 * running number (`01 - name`) all disappear, because the same video is named
 * slightly differently in the library and in the file manager.
 */
export function normalizeMatchKey(value: string): string {
  let text = String(value || "");

  try {
    text = decodeURIComponent(text);
  } catch {
    /* not percent-encoded — keep the raw value */
  }

  return text
    .toLowerCase()
    .replace(new RegExp(`\\.(?:${MEDIA_EXTENSIONS})(?![a-z0-9])`, "gi"), " ")
    .replace(/\.[a-z0-9]{1,5}$/i, " ")
    // Bracketed quality tags — "(1080p)", "[4K]", "{HD}" — are dropped whether
    // or not they are pure digits, so the key is just the name.
    .replace(/[([{]\s*(?:\d{3,4}p|8k|4k|uhd|fhd|hd|\d+)\s*[)\]}]/gi, " ")
    .replace(/^\s*\d{1,3}\s*[-_.]\s*/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTokens(key: string): string[] {
  return key
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !NOISE_TOKENS.has(token));
}

/** Strips the query/fragment and returns the last path segment of a URL. */
function fileNameFromUrl(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split(/[?#]/)[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  if (!last || !/[a-z0-9]/i.test(last)) return "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function fileNameFromSourceKey(sourceKey: string | null | undefined): string {
  return fileNameFromUrl(sourceKey);
}

/**
 * Every name a video is known by, most specific first.
 *
 * The title is what the admin sees; the slug is the URL form of it; the file
 * name is what the upload was actually called — which is usually exactly what
 * the matching image in the file manager was named after.
 */
export function videoMatchKeys(video: ThumbnailTarget): string[] {
  const raw = [
    fileNameFromUrl(video.playable_url),
    fileNameFromUrl(video.source_key),
    video.slug,
    video.title,
    ...(video.extraNames || []),
  ];

  const keys: string[] = [];
  for (const value of raw) {
    const key = normalizeMatchKey(String(value || ""));
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Confidence that two normalised names denote the same video. `0` = no match. */
export function scoreNameMatch(left: string, right: string): number {
  const a = normalizeMatchKey(left);
  const b = normalizeMatchKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 10 && longer.includes(shorter)) return 0.94;
  if (shorter.length >= 6 && longer.includes(shorter)) return 0.85;
  if (shorter.length >= 6 && longer.startsWith(shorter)) return 0.8;

  const leftTokens = matchTokens(a);
  const rightTokens = matchTokens(b);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token));
  if (!shared.length) return 0;

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = shared.length / union;
  const coverage = shared.length / Math.min(leftTokens.length, rightTokens.length);

  if (jaccard >= 0.5) return 0.55 + 0.35 * jaccard; // 0.725 – 0.9
  if (coverage >= 0.75) return 0.5 + 0.25 * coverage; // 0.6875 – 0.75
  return 0;
}

/** Below this, a name is considered a coincidence rather than a match. */
export const MATCH_THRESHOLD = 0.68;

export type ThumbnailMatch = { file: StreamtapeFile; score: number; key: string };

/** Best image in `files` for one video, or `null` when nothing is convincing. */
export function matchThumbnailFile(files: StreamtapeFile[], video: ThumbnailTarget): ThumbnailMatch | null {
  const keys = videoMatchKeys(video);
  if (!keys.length) return null;

  let best: ThumbnailMatch | null = null;
  for (const file of files) {
    const fileKey = normalizeMatchKey(file.name);
    if (!fileKey) continue;
    for (const key of keys) {
      const score = scoreNameMatch(key, fileKey);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { file, score, key };
    }
  }

  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

/* ------------------------------------------------------------------------- */
/* Auto-attach at publish time                                                */
/* ------------------------------------------------------------------------- */

/** How long a folder listing is reused within one warm server process. */
const INDEX_TTL_MS = 60_000;

let indexCache: (ThumbnailIndex & { at: number }) | null = null;

/** Drops the cached folder listing — used by tests and after an import. */
export function resetThumbnailIndexCache(): void {
  indexCache = null;
}

/**
 * The folder listing, cached briefly.
 *
 * Publishing twenty links in one request would otherwise list the folder
 * twenty times. A minute of staleness is invisible to an admin and cannot
 * hide an image for long.
 */
async function cachedThumbnailIndex(): Promise<ThumbnailIndex> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) {
    return { folder: indexCache.folder, files: indexCache.files };
  }
  const index = await loadThumbnailIndex();
  indexCache = { ...index, at: Date.now() };
  return index;
}

/**
 * Finds and mirrors the thumbnail for one freshly published video, or `null`
 * when there is nothing to attach.
 *
 * Best-effort by design: publishing a video must never fail because the
 * thumbnail folder was unreachable, misnamed, or simply has no match yet. The
 * caller is responsible for writing the returned URL onto the row.
 */
export async function tryStreamtapeThumbnailFor(
  service: ServiceClient,
  userId: string,
  video: ThumbnailTarget
): Promise<{ thumbnailUrl: string; matchedFile: string } | null> {
  try {
    if (!streamtapeConfigured()) return null;

    const { files } = await cachedThumbnailIndex();
    const match = matchThumbnailFile(files, video);
    if (!match) return null;

    const image = await downloadImage(match.file.linkid, match.file.name);
    const thumbnailUrl = await storeThumbnail(service, userId, image);
    return { thumbnailUrl, matchedFile: match.file.name };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[streamtape-thumbnails] automatic lookup failed for "${video.slug}": ${reason}`);
    return null;
  }
}

const IMAGE_NAME = /\.(jpe?g|png|gif|webp|avif)$/i;

function isImageFile(file: StreamtapeFile): boolean {
  return IMAGE_NAME.test(String(file.name || "").trim());
}

/* ------------------------------------------------------------------------- */
/* Storage                                                                    */
/* ------------------------------------------------------------------------- */

function extensionFor(contentType: string, fileName: string): string {
  const fromName = (fileName.split(".").pop() || "").toLowerCase();
  if (/^(jpe?g|png|gif|webp)$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const fromType = contentType.split("/")[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (fromType === "jpeg") return "jpg";
  if (/^(png|gif|webp)$/.test(fromType)) return fromType;
  return "jpg";
}

/** Mirrors downloaded bytes into the public thumbnail bucket. */
async function storeThumbnail(
  service: ServiceClient,
  userId: string,
  image: { bytes: Uint8Array; contentType: string; fileName: string }
): Promise<string> {
  await ensureStorageBuckets(service);

  const storagePath = `${userId}/${randomUUID()}.${extensionFor(image.contentType, image.fileName)}`;
  const bucket = service.storage.from(THUMBNAIL_BUCKET);
  const { error } = await bucket.upload(storagePath, image.bytes, {
    contentType: image.contentType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`Could not store the thumbnail: ${error.message}`);

  const { data } = bucket.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error("The stored thumbnail did not resolve to a public URL");
  return data.publicUrl;
}

/* ------------------------------------------------------------------------- */
/* Folder index                                                               */
/* ------------------------------------------------------------------------- */

export type ThumbnailIndex = {
  folder: FolderPath | null;
  files: StreamtapeFile[];
};

/**
 * Finds the thumbnails folder and lists the images in it.
 *
 * Falls back to the file-manager root when no folder matches — an admin who
 * dropped the images at the top level still gets thumbnails instead of an
 * error.
 */
export async function loadThumbnailIndex(): Promise<ThumbnailIndex> {
  if (!streamtapeConfigured()) throw new StreamtapeError(STREAMTAPE_NOT_CONFIGURED_MESSAGE, "not_configured");

  const folder = await findFolder(thumbnailFolderName(), { folderId: thumbnailFolderId() || undefined });
  let files: StreamtapeFile[] = [];

  if (folder) {
    const listing = await listFolder(folder.id);
    files = listing.files.filter(isImageFile);
  }

  if (!files.length) {
    const root = await listFolder(null);
    files = root.files.filter(isImageFile);
  }

  return { folder, files };
}

/* ------------------------------------------------------------------------- */
/* Import                                                                     */
/* ------------------------------------------------------------------------- */

export type ImportOutcome = {
  id: string;
  status: "imported" | "skipped" | "unmatched" | "failed";
  thumbnailUrl?: string;
  matchedFile?: string;
  score?: number;
  error?: string;
};

export type ImportSummary = {
  folder: FolderPath | null;
  fileCount: number;
  results: ImportOutcome[];
  imported: number;
};

export type ImportOptions = {
  /** Replace an existing thumbnail. Off by default — an admin's own image wins. */
  overwrite?: boolean;
  /** Hard cap so one request cannot run a serverless function out of time. */
  maxVideos?: number;
};

/**
 * Matches every target against the Streamtape thumbnails folder and copies the
 * image it finds onto the video row.
 *
 * Per-video problems (unmatched name, a file that is not an image, a download
 * that fails) are reported per row and never abort the batch. A configuration
 * or folder problem aborts before any row is touched, because every row would
 * fail the same way.
 */
export async function importStreamtapeThumbnails(
  service: ServiceClient,
  userId: string,
  videos: ThumbnailTarget[],
  options: ImportOptions = {}
): Promise<ImportSummary> {
  if (!videos.length) {
    return { folder: null, fileCount: 0, results: [], imported: 0 };
  }

  const { folder, files } = await loadThumbnailIndex();
  const limit = Math.max(1, Math.min(options.maxVideos ?? 25, 200));
  const targets = videos.slice(0, limit);

  const results: ImportOutcome[] = [];
  let imported = 0;

  for (const video of targets) {
    if (video.thumbnail_url && !options.overwrite) {
      results.push({ id: video.id, status: "skipped", error: "Already has a thumbnail" });
      continue;
    }

    const match = matchThumbnailFile(files, video);
    if (!match) {
      results.push({
        id: video.id,
        status: "unmatched",
        error: files.length
          ? "No image in the Streamtape thumbnails folder matches this video's name"
          : "The Streamtape thumbnails folder holds no images",
      });
      continue;
    }

    let storedUrl: string | null = null;
    try {
      const image = await downloadImage(match.file.linkid, match.file.name);
      storedUrl = await storeThumbnail(service, userId, image);

      // A manual upload may land while the download is in flight, so unless the
      // admin asked to overwrite, the write is guarded by "still has no
      // thumbnail" instead of clobbering the newer image.
      let query = service.from("videos").update({ thumbnail_url: storedUrl }).eq("id", video.id);
      if (!options.overwrite) query = query.is("thumbnail_url", null);
      const { data: updated, error: updateError } = await query.select("id").maybeSingle();

      if (updateError) throw updateError;
      if (!updated) {
        await removeThumbnailObject(service, storedUrl);
        results.push({ id: video.id, status: "skipped", error: "A thumbnail was added while the import was running" });
        continue;
      }

      await service.from("audit_logs").insert({
        actor_id: userId,
        action: "video_thumbnail_imported",
        target_type: "video",
        target_id: video.id,
        level: "info",
        metadata: {
          slug: video.slug,
          source: "streamtape-file-manager",
          folder: folder?.path ?? null,
          file: match.file.name,
          score: Number(match.score.toFixed(3)),
        },
      });

      imported += 1;
      results.push({ id: video.id, status: "imported", thumbnailUrl: storedUrl, matchedFile: match.file.name, score: match.score });
    } catch (error: unknown) {
      if (storedUrl) await removeThumbnailObject(service, storedUrl);
      const message = error instanceof Error ? error.message : "Could not import the thumbnail";
      results.push({ id: video.id, status: "failed", error: message, matchedFile: match.file.name, score: match.score });
    }
  }

  return { folder, fileCount: files.length, results, imported };
}

/* ------------------------------------------------------------------------- */
/* Scan (no writes)                                                           */
/* ------------------------------------------------------------------------- */

export type ScanOutcome = {
  id: string;
  title: string;
  hasThumbnail: boolean;
  matchedFile: string | null;
  score: number | null;
};

export type ScanSummary = {
  configured: boolean;
  folder: FolderPath | null;
  folderName: string;
  fileCount: number;
  matches: ScanOutcome[];
  error?: string;
};

/**
 * Reports what the importer *would* do, without downloading or writing
 * anything. Used by the admin UI's “Find thumbnails” check so a misconfigured
 * folder is visible before a slow batch runs.
 */
export async function scanStreamtapeThumbnails(
  videos: ThumbnailTarget[],
  maxVideos = 200
): Promise<ScanSummary> {
  const folderName = thumbnailFolderName();
  const base: ScanSummary = {
    configured: streamtapeConfigured(),
    folder: null,
    folderName,
    fileCount: 0,
    matches: [],
  };

  if (!base.configured) {
    return { ...base, error: STREAMTAPE_NOT_CONFIGURED_MESSAGE };
  }

  let index: ThumbnailIndex;
  try {
    index = await loadThumbnailIndex();
  } catch (error: unknown) {
    return { ...base, error: error instanceof Error ? error.message : "Could not read the Streamtape file manager" };
  }

  const matches = videos.slice(0, Math.max(1, maxVideos)).map((video) => {
    const match = matchThumbnailFile(index.files, video);
    return {
      id: video.id,
      title: video.title,
      hasThumbnail: Boolean(video.thumbnail_url),
      matchedFile: match?.file.name ?? null,
      score: match ? Number(match.score.toFixed(3)) : null,
    };
  });

  return {
    ...base,
    folder: index.folder,
    fileCount: index.files.length,
    matches,
    ...(index.folder ? {} : { error: `No folder named “${folderName}” was found in the Streamtape file manager; the file-manager root was searched instead.` }),
  };
}
