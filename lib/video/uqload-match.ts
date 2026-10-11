/**
 * Pure matching helpers for confirming a direct browser → Uqload upload.
 *
 * Why this exists (verified against the live Uqload API):
 *
 * 1. Uqload ignores every multipart field sent **after** the `file` part, so a
 *    `file_title` appended behind the file is dropped and the stored title is
 *    derived from the file name instead — spaces become underscores
 *    (`my trip.mp4` is stored as `My_Trip`). Title comparisons must therefore
 *    fold `_`, `.`, `-`, `+` and whitespace before comparing.
 * 2. `file/list?title=` is a literal substring match on the *stored* title, so
 *    it can never be used to find a file whose stored title we don't know yet.
 * 3. The only reliable way to identify a just-uploaded file is a **diff**: take
 *    a snapshot of the account's file codes before sending the bytes, then any
 *    code that appears afterwards is the upload. The title is only a ranking
 *    hint — never the sole identification.
 */

export interface LibraryFile {
  fileCode: string;
  title: string;
  uploaded?: string;
  canPlay?: boolean;
}

export interface ConfirmedUpload {
  fileCode: string;
  uploaded?: string;
  matchedBy: "title" | "only-new" | "newest-new";
}

/**
 * Folds a title for comparison: strips a file extension, then collapses
 * `_ . - +` and whitespace runs into single spaces.
 * `Naked_Girls.mp4` → `naked girls` (matches a stored `Naked_Girls`).
 */
export function normalizeTitle(value: unknown): string {
  return String(value ?? "")
    .replace(/\.[a-z0-9]{1,10}$/i, "")
    .replace(/[_+.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normalized candidate titles for an upload, most specific first. */
export function expectedTitlesFor(meta: { title?: string; fileName?: string }): string[] {
  const seen = new Set<string>();
  for (const value of [meta.title, meta.fileName]) {
    const normalized = normalizeTitle(value);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

function matchesExpectedTitle(candidate: string, expectedTitles: string[]): boolean {
  return expectedTitles.some(
    (expected) => candidate === expected || candidate.startsWith(`${expected} `)
  );
}

function newestFirst(files: LibraryFile[]): LibraryFile[] {
  return [...files].sort((a, b) => String(b.uploaded ?? "").localeCompare(String(a.uploaded ?? "")));
}

/**
 * Picks the file code of the upload we just sent, using the library diff.
 *
 * Selection order (most trustworthy first):
 *  1. a code whose title matches the expected title/filename,
 *  2. the only code that appeared after the snapshot,
 *  3. at the deadline, the newest new code — only when a pre-upload snapshot
 *     was actually readable, so an empty or missing snapshot never guesses.
 *
 * Without a readable snapshot (`knownFileCodes: null`) there is no diff
 * baseline: only an explicit title/filename match is trusted, never a guess.
 */
export function pickConfirmedUpload({
  files,
  knownFileCodes,
  expectedTitles,
  finalAttempt = false,
}: {
  files: LibraryFile[];
  /** Codes that already existed before the upload; `null` = snapshot failed. */
  knownFileCodes?: string[] | null;
  expectedTitles: string[];
  finalAttempt?: boolean;
}): ConfirmedUpload | null {
  const candidates = newestFirst(files.filter((file) => Boolean(file.fileCode)));

  if (!Array.isArray(knownFileCodes)) {
    // No diff baseline (snapshot request failed): the title is the only signal
    // that can identify the upload — never guess a file code.
    const fallbackMatch = candidates.find((file) => matchesExpectedTitle(normalizeTitle(file.title), expectedTitles));
    return fallbackMatch
      ? { fileCode: fallbackMatch.fileCode, uploaded: fallbackMatch.uploaded, matchedBy: "title" }
      : null;
  }

  const known = new Set(knownFileCodes.map(String));
  const fresh = candidates.filter((file) => !known.has(file.fileCode));
  if (!fresh.length) return null;

  // Only files that appeared *after* the snapshot can be the upload — a title
  // match among them is stronger than the count-based fallbacks.
  const titleMatch = fresh.find((file) => matchesExpectedTitle(normalizeTitle(file.title), expectedTitles));
  if (titleMatch) {
    return { fileCode: titleMatch.fileCode, uploaded: titleMatch.uploaded, matchedBy: "title" };
  }

  if (fresh.length === 1) {
    return { fileCode: fresh[0].fileCode, uploaded: fresh[0].uploaded, matchedBy: "only-new" };
  }

  if (finalAttempt) {
    return { fileCode: fresh[0].fileCode, uploaded: fresh[0].uploaded, matchedBy: "newest-new" };
  }

  return null;
}
