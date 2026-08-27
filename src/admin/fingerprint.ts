/* ──────────────────────────────────────────────────────────────
 * Content fingerprinting for duplicate detection.
 *
 * Hashing a 2 GB file end-to-end would take minutes, so instead we
 * sample three 1 MB windows (head / middle / tail) and mix in the exact
 * byte length. Two files sharing all four are the same video for every
 * practical purpose, while the hash completes in milliseconds.
 *
 * The ORIGINAL source file is always fingerprinted — never the
 * optimized output, whose bytes vary between encoder runs.
 * ────────────────────────────────────────────────────────────── */

const WINDOW = 1024 * 1024; // 1 MB

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Cheap, stable fallback when SubtleCrypto is unavailable (insecure origin). */
function fallbackHash(file: File): string {
  const seed = `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `fb${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** SHA-256 over sampled windows + byte length. Returns a hex digest. */
export async function fingerprintFile(file: File): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return fallbackHash(file);
  try {
    const slices: ArrayBuffer[] = [];
    slices.push(await file.slice(0, Math.min(WINDOW, file.size)).arrayBuffer());

    if (file.size > WINDOW * 3) {
      const mid = Math.floor(file.size / 2 - WINDOW / 2);
      slices.push(await file.slice(mid, mid + WINDOW).arrayBuffer());
    }
    if (file.size > WINDOW) {
      slices.push(await file.slice(Math.max(0, file.size - WINDOW)).arrayBuffer());
    }

    const tail = new TextEncoder().encode(`|${file.size}`);
    const total = slices.reduce((n, s) => n + s.byteLength, 0) + tail.byteLength;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const s of slices) {
      merged.set(new Uint8Array(s), offset);
      offset += s.byteLength;
    }
    merged.set(tail, offset);

    return toHex(await crypto.subtle.digest("SHA-256", merged));
  } catch {
    return fallbackHash(file);
  }
}

export type { DuplicateMatch } from "./api";
