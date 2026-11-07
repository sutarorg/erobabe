import { PORNHUB_BASE_URL, toSafeUrl } from "./parse";

/**
 * Network access for the Pornhub importer.
 *
 * Only pornhub.com is reachable: a URL that resolves anywhere else is rejected
 * before a request is made, so a mangled listing link can never turn the
 * importer into an arbitrary fetch proxy.
 */
export type PornhubPage = { url: string; html: string; status: number };

/** Injectable for tests; the importer only ever sees this shape. */
export type FetchPornhubPage = (url: string) => Promise<PornhubPage>;

export type PornhubFetcherOptions = {
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

/**
 * A browser-shaped user agent.
 *
 * Pornhub answers its public search pages to ordinary browsers, and rejects
 * clients that announce themselves as bots. This is a plain HTTP GET of a page
 * a visitor can open — not a credential, not a login, not a bypass.
 */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True only for pornhub.com and its subdomains. */
export function pornhubHostAllowed(url: string, baseUrl = PORNHUB_BASE_URL): boolean {
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
 * Thrown when Pornhub answers with a block page instead of results.
 *
 * The operator action is different from every other failure — the import cannot
 * succeed from this server's egress address, so the admin panel says so instead
 * of reporting "no new videos".
 */
export class PornhubBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PornhubBlockedError";
  }
}

/**
 * Reads one Pornhub page. Relative URLs are resolved against the base site;
 * anything off-site throws instead of being fetched.
 */
export function createPornhubFetcher(options: PornhubFetcherOptions = {}): FetchPornhubPage {
  const baseUrl = (options.baseUrl || PORNHUB_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 900;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  return async function fetchPornhubPage(rawUrl: string): Promise<PornhubPage> {
    const resolved = toSafeUrl(rawUrl, baseUrl);
    if (!resolved) throw new Error(`Invalid Pornhub URL: ${rawUrl}`);
    if (!pornhubHostAllowed(resolved, baseUrl)) {
      throw new Error(`Refusing to fetch a non-Pornhub host: ${resolved}`);
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(retryDelayMs * attempt);
      try {
        const response = await fetchImpl(resolved, {
          redirect: "follow",
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            referer: `${baseUrl}/`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!pornhubHostAllowed(response.url || resolved, baseUrl)) {
          throw new Error("Pornhub redirected off-site");
        }
        // A block page is not a transient failure; retrying it only burns the
        // operator's time and the site's patience.
        if (response.status === 403 || response.status === 451) {
          throw new PornhubBlockedError(
            `Pornhub refused the request from this server (HTTP ${response.status}). ` +
              "The import needs an egress address Pornhub serves to browsers.",
          );
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Pornhub responded ${response.status}`);
          continue;
        }
        if (!response.ok) {
          throw new Error(`Pornhub responded ${response.status} for ${resolved}`);
        }
        const html = await response.text();
        return { url: response.url || resolved, html, status: response.status };
      } catch (error) {
        lastError = error;
        if (
          error instanceof PornhubBlockedError ||
          (error instanceof Error && /Refusing|redirected off-site/.test(error.message))
        ) {
          break;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to read ${resolved}`);
  };
}
