/**
 * Tolerant reader for our JSON API routes.
 *
 * A plain `await response.json()` blows up with
 * `SyntaxError: Unexpected token 'R', "Request En"... is not valid JSON`
 * whenever an infrastructure layer (Vercel, a CDN, a proxy) answers with a
 * non-JSON body — the most common case being the 413 "Request Entity Too
 * Large" that Vercel returns for request bodies above its 4.5 MB function
 * limit. Read the body as text first and always surface a human message.
 */

const MAX_SNIPPET = 400;

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Turns a non-JSON (or missing) response body into something an admin can act on. */
export function describeNonJsonResponse(response: Response, body: string): string {
  if (response.status === 413) {
    return "This upload is larger than the host allows for a single server request (Vercel limits request bodies to 4.5 MB). Videos and thumbnails must go through the direct-to-storage upload — refresh the page and try again.";
  }
  if (response.status === 504) {
    return "The server timed out while processing this request. Try again with fewer or smaller files.";
  }
  if (response.status === 502 || response.status === 503) {
    return `An upstream service is unavailable (${response.status}). Try again in a moment.`;
  }
  if (response.status >= 500) {
    return `The server returned an error (${response.status}).`;
  }

  const snippet = body.trim().replace(/\s+/g, " ").slice(0, MAX_SNIPPET);
  return snippet ? `${response.status}: ${snippet}` : `Request failed (${response.status})`;
}

function pickMessage(json: any): string {
  if (!json || typeof json !== "object") return "";
  for (const key of ["error", "message", "msg", "detail"]) {
    const value = (json as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Parses a response from one of our API routes.
 * Resolves with the decoded JSON body, or throws an {@link ApiError} whose
 * `message` is always safe to show to a human.
 */
export async function readApiResponse<T = any>(response: Response): Promise<T> {
  const body = await response.text();

  let json: any = null;
  if (body) {
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const message = pickMessage(json) || describeNonJsonResponse(response, body);
    throw new ApiError(message, response.status, json?.details);
  }

  return (json ?? {}) as T;
}

/** POSTs JSON to one of our API routes and returns the decoded body. */
export async function postJson<T = any>(url: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError("Network error — the request never reached the server. Check your connection and try again.", 0);
  }
  return readApiResponse<T>(response);
}

/** GETs one of our API routes and returns the decoded body. */
export async function getJson<T = any>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("Network error — the request never reached the server. Check your connection and try again.", 0);
  }
  return readApiResponse<T>(response);
}
