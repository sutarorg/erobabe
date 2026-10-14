import { safeStreamtapeMediaUrl } from "@/lib/video/playback";

const MAX_REDIRECTS = 4;
const CONNECT_TIMEOUT_MS = 30_000;

/** Only a single byte range is supported; never forward arbitrary request headers. */
export function validMediaRange(range: string): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ([start, end].some((n) => n !== null && !Number.isSafeInteger(n))) return false;
  return start === null ? end! > 0 : end === null || end >= start;
}

/**
 * Fetch on the server that issued the ticket: download links can be IP-bound.
 * Validate EVERY redirect, and never relay HTML, cookies or upstream errors.
 * The body is streamed with backpressure, not buffered into server memory.
 */
export async function streamStreamtapeMedia(
  rawUrl: string,
  request: Request,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timeout = setTimeout(abort, CONNECT_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  };
  let upstream: Response | undefined;

  try {
    const headers = new Headers({ "Accept-Encoding": "identity" });
    const range = request.headers.get("range");
    if (range) {
      if (!validMediaRange(range)) throw new Error("Invalid media range");
      headers.set("Range", range);
    }
    let url = safeStreamtapeMediaUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(url, {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers, signal: controller.signal, redirect: "manual", cache: "no-store",
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      await upstream.body?.cancel();
      const location = upstream.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) throw new Error("Invalid media redirect");
      url = safeStreamtapeMediaUrl(new URL(location, url).toString());
    }
    clearTimeout(timeout);
    if (!upstream) throw new Error("Media unavailable");

    const responseHeaders = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    });
    if (upstream.status === 416) {
      const contentRange = upstream.headers.get("content-range");
      if (contentRange && /^bytes \*\/\d+$/.test(contentRange)) {
        responseHeaders.set("Content-Range", contentRange);
      }
      await upstream.body?.cancel();
      cleanup();
      return new Response(null, { status: 416, headers: responseHeaders });
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (
      ![200, 206].includes(upstream.status) ||
      !(contentType.startsWith("video/") || contentType === "application/octet-stream") ||
      (upstream.headers.get("content-encoding") || "identity") !== "identity"
    ) throw new Error("Upstream did not return video media");
    if (upstream.status === 206 && !/^bytes \d+-\d+\/\d+$/.test(upstream.headers.get("content-range") || "")) {
      throw new Error("Invalid partial media response");
    }
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (request.method === "HEAD") {
      await upstream.body?.cancel();
      cleanup();
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    if (!upstream.body) throw new Error("Empty media response");

    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const { done, value } = await reader.read();
          if (done) { cleanup(); target.close(); }
          else target.enqueue(value);
        } catch {
          cleanup();
          controller.abort();
          // Do not expose signed URLs or provider error bodies in stream errors.
          target.error(new Error("Video stream interrupted"));
        }
      },
      async cancel() {
        controller.abort();
        cleanup();
        await reader.cancel().catch(() => undefined);
      },
    });
    return new Response(body, { status: upstream.status, headers: responseHeaders });
  } catch {
    controller.abort();
    await upstream?.body?.cancel().catch(() => undefined);
    cleanup();
    throw new Error("Video media unavailable");
  }
}
