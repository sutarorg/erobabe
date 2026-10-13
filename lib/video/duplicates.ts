import type { ServiceClient } from "@/lib/video/publishing";

/**
 * Duplicate-upload detection for published videos.
 *
 * Two signals, both computed from the source link the admin pastes:
 *  - `source_key`: host + path, lower-cased, no query/fragment, no leading
 *    `www.`. The same link pasted twice always matches.
 *  - file name: the last path segment. The same clip mirrored on another host
 *    under the same file name is flagged too.
 *
 * `sourceKeyOf` must stay in step with the SQL backfill in migration
 * 00000000000010, which uses the same string rules.
 */

export type DuplicateMatch = {
  videoId: string;
  slug: string;
  title: string;
  reason: "same_link" | "same_file_name";
};

/** Normalises a link to the key stored in `videos.source_key`. */
export function sourceKeyOf(url: string): string {
  return String(url || "")
    .trim()
    .split("?")[0]
    .split("#")[0]
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "");
}

/** Last path segment of a link, lower-cased and percent-decoded when possible. */
export function fileNameOf(url: string): string {
  const key = sourceKeyOf(url);
  const segments = key.split("/").filter(Boolean);
  const last = segments.length > 1 ? segments[segments.length - 1] : "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * For each input link, returns the existing video it duplicates (if any).
 * Returns a Map keyed by the input link. Never throws on an empty list.
 */
export async function findDuplicateVideos(
  service: ServiceClient,
  urls: string[]
): Promise<Map<string, DuplicateMatch>> {
  const result = new Map<string, DuplicateMatch>();
  const unique = Array.from(new Set(urls.map((url) => String(url || "").trim()).filter(Boolean)));
  if (!unique.length) return result;

  const keys = unique.map(sourceKeyOf);
  const { data: sameLink, error: linkError } = await service
    .from("videos")
    .select("id, slug, title, source_key")
    .in("source_key", keys);
  if (linkError) throw linkError;

  const byKey = new Map<string, { id: string; slug: string; title: string }>();
  for (const row of (sameLink || []) as any[]) {
    if (row.source_key && !byKey.has(row.source_key)) {
      byKey.set(row.source_key, { id: String(row.id), slug: String(row.slug), title: String(row.title) });
    }
  }

  for (let index = 0; index < unique.length; index += 1) {
    const match = byKey.get(keys[index]);
    if (match) {
      result.set(unique[index], { videoId: match.id, slug: match.slug, title: match.title, reason: "same_link" });
    }
  }

  // Same file name on any host. One query per distinct file name, bounded.
  const names = Array.from(new Set(unique.map(fileNameOf).filter((name) => name.length >= 6))).slice(0, 20);
  for (let index = 0; index < unique.length; index += 1) {
    if (result.has(unique[index])) continue;
    const name = fileNameOf(unique[index]);
    if (name.length < 6 || !names.includes(name)) continue;
    const { data, error } = await service
      .from("videos")
      .select("id, slug, title, source_key")
      .like("source_key", `%/${escapeLike(name)}`)
      .limit(1);
    if (error) throw error;
    const row = ((data || []) as any[])[0];
    if (row) {
      result.set(unique[index], {
        videoId: String(row.id),
        slug: String(row.slug),
        title: String(row.title),
        reason: "same_file_name",
      });
    }
  }

  return result;
}

export function describeDuplicate(match: DuplicateMatch): string {
  const what = match.reason === "same_link" ? "the same link" : "a video with the same file name";
  return `Duplicate upload: ${what} is already published as “${match.title}” (/video/${match.slug}). Tick “publish anyway” to add it again.`;
}
