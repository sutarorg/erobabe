export interface AnonymousProfile {
  id: string;
  /** Assigned by the server-side AI when this visitor posts their first comment. */
  name?: string;
}

const STORAGE_KEY = "erobabe-anonymous-profile";
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
// Handles created by the server end in a random hex tag so they remain unique.
const AI_USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}'’ -]{1,43} [0-9a-f]{12}$/iu;

let fallback: AnonymousProfile | undefined;

function readStoredProfile(): AnonymousProfile | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object" || !UUID_PATTERN.test(stored.id)) return null;

    // Old builds saved locally-random names. Keep the visitor ID, but let the
    // first post after this update receive a server-generated AI username.
    const name = typeof stored.name === "string" && AI_USERNAME_PATTERN.test(stored.name)
      ? stored.name
      : undefined;
    return { id: stored.id, ...(name ? { name } : {}) };
  } catch {
    // Storage may be disabled; the in-memory identity still works this visit.
    return null;
  }
}

function persist(profile: AnonymousProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage may be disabled; keep the identity in memory for this visit.
  }
}

function createVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Web Crypto is available in supported browsers even if randomUUID is not.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Read or create a stable anonymous visitor ID. A username is deliberately not
 * generated here: names are created by AI only when the visitor posts a first
 * comment, then persisted locally by `saveAnonymousUsername`.
 */
export function anonymousProfile(): AnonymousProfile {
  if (fallback) return fallback;

  const stored = readStoredProfile();
  if (stored) {
    fallback = stored;
    // Drop pre-AI random handles from older releases while preserving the ID.
    persist(stored);
    return stored;
  }

  fallback = { id: createVisitorId() };
  persist(fallback);
  return fallback;
}

/** Save the server-issued AI username beside this browser's stable visitor ID. */
export function saveAnonymousUsername(name: string): AnonymousProfile {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!AI_USERNAME_PATTERN.test(normalized)) return anonymousProfile();

  const profile = anonymousProfile();
  fallback = { id: profile.id, name: normalized };
  persist(fallback);
  return fallback;
}
