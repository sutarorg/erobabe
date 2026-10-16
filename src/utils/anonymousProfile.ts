export interface AnonymousProfile {
  id: string;
  /** Assigned by the server from the local word library when this visitor posts their first comment. */
  name?: string;
}

const STORAGE_KEY = "erobabe-anonymous-profile";
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
// Usernames are strictly two words (e.g. "Crazy Wobble")
const USERNAME_PATTERN = /^[\p{L}\p{N}'’-]+ [\p{L}\p{N}'’-]+$/u;

let fallback: AnonymousProfile | undefined;

function cleanName(raw?: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Strip any legacy hex suffix so username is strictly two words
  const stripped = raw.trim().replace(/\s+[0-9A-Fa-f]{12}$/, "");
  return USERNAME_PATTERN.test(stripped) ? stripped : undefined;
}

function readStoredProfile(): AnonymousProfile | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object" || !UUID_PATTERN.test(stored.id)) return null;

    const name = cleanName(stored.name);
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
 * generated here: names are created from the local word library when the visitor posts a first
 * comment, then persisted locally by `saveAnonymousUsername`.
 */
export function anonymousProfile(): AnonymousProfile {
  if (fallback) return fallback;

  const stored = readStoredProfile();
  if (stored) {
    fallback = stored;
    persist(stored);
    return stored;
  }

  fallback = { id: createVisitorId() };
  persist(fallback);
  return fallback;
}

/** Save the server-reserved username beside this browser's stable visitor ID. */
export function saveAnonymousUsername(name: string): AnonymousProfile {
  const cleaned = cleanName(name);
  if (!cleaned) return anonymousProfile();

  const profile = anonymousProfile();
  fallback = { id: profile.id, name: cleaned };
  persist(fallback);
  return fallback;
}
