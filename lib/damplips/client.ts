import { DAMPLIPS_BASE_URL, toSafeUrl } from "./parse";

/**
 * Network access for the damplips importer.
 *
 * Only damplips hosts are reachable: a URL that resolves anywhere else is
 * rejected before a request is made, so a mangled listing link can never turn
 * the importer into an arbitrary fetch proxy.
 */
export type DamplipsPage = { url: string; html: string; status: number };

/** Injectable for tests; the importer only ever sees this shape. */
export type FetchDamplipsPage = (url: string) => Promise<DamplipsPage>;

export type FetcherOptions = {
  baseUrl?: string;
  /** Milliseconds before a request is abandoned. */
  timeoutMs?: number;
  /** Retries for transient failures (429/5xx/network). */
  retries?: number;
  /** Politeness delay between retries. */
  retryDelayMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; erobabe-catalog/1.0; +https://erobabe.com/about)";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function damplipsHostAllowed(url: string, baseUrl = DAMPLIPS_BASE_URL): boolean {
  try {
    const target = new URL(url);
    const base = new URL(baseUrl);
    if (target.protocol !== "https:" && target.protocol !== "http:") return false;
    if (target.username || target.password) return false;
    const host = target.hostname.toLowerCase();
    const baseHost = base.hostname.toLowerCase().replace(/^www\./, "");
    return host === baseHost || host.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

/**
 * Reads one damplips page. Relative URLs are resolved against the base site;
 * anything off-site throws instead of being fetched.
 */
export function createDamplipsFetcher(options: FetcherOptions = {}): FetchDamplipsPage {
  const baseUrl = (options.baseUrl || DAMPLIPS_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 750;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  return async function fetchDamplipsPage(rawUrl: string): Promise<DamplipsPage> {
    const resolved = toSafeUrl(rawUrl, baseUrl);
    if (!resolved) throw new Error(`Invalid damplips URL: ${rawUrl}`);
    if (!damplipsHostAllowed(resolved, baseUrl)) {
      throw new Error(`Refusing to fetch a non-damplips host: ${resolved}`);
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(retryDelayMs * attempt);
      try {
        const response = await fetchImpl(resolved, {
          redirect: "follow",
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.8",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!damplipsHostAllowed(response.url || resolved, baseUrl)) {
          throw new Error("damplips redirected off-site");
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`damplips responded ${response.status}`);
          continue;
        }
        if (!response.ok) {
          throw new Error(`damplips responded ${response.status} for ${resolved}`);
        }
        const html = await response.text();
        return { url: response.url || resolved, html, status: response.status };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && /Refusing|redirected off-site/.test(error.message)) break;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to read ${resolved}`);
  };
}
