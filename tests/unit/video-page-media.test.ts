import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEAD_PADDING,
  PAGE_BYTE_CAP,
  RESOLUTION_TTL_MS,
  clearPageMediaCache,
  forgetPageMedia,
  readPageMedia,
  recallPageMedia,
  rememberPageMedia,
  resolvePageMedia,
  resolveWithin,
} from "@/lib/video/page-media";

/**
 * Resolving a damplips post page is on the critical path of playback, so these
 * tests pin the two properties that keep it fast: the document is abandoned as
 * soon as the media tag appears, and the answer is remembered (and shared)
 * instead of being rediscovered for every byte the player asks for.
 */

const POST = "https://www.damplips.com/p/67300/";
const FILE = "https://video.damplips.com/videos/67300.mp4";
const POSTER = "https://video.damplips.com/pics/67300.jpg";

/** A page whose head names its file, followed by a body that never ends. */
function endlessPage(mediaUrl = FILE) {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `<!DOCTYPE html><html><head><meta property="og:title" content="A post">` +
            `<meta property="og:image" content="${POSTER}">` +
            `<meta property="og:video" content="${mediaUrl}"></head><body>`,
        ),
      );
      // Deliberately never closes: a reader that waits for the end of an
      // ad-heavy page would hang here forever.
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
    wasCancelled: () => cancelled,
  };
}

function htmlPage(html: string, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

beforeEach(() => {
  clearPageMediaCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPageMediaCache();
});

describe("readPageMedia", () => {
  it("stops at the media tag instead of draining the page", async () => {
    const { response, wasCancelled } = endlessPage();
    const media = await readPageMedia(response, POST);

    expect(media).toBe(FILE);
    // Returning at all proves the scan stopped early; the cancel proves the
    // connection was dropped rather than left to download the rest.
    expect(wasCancelled()).toBe(true);
  });

  it("resolves a relative media URL against the page address", async () => {
    const media = await readPageMedia(
      htmlPage('<html><head><meta property="og:video" content="/videos/67300.mp4"></head></html>'),
      POST,
    );
    expect(media).toBe("https://www.damplips.com/videos/67300.mp4");
  });

  it("upgrades an http media URL to https", async () => {
    const media = await readPageMedia(
      htmlPage('<html><head><meta property="og:video" content="http://video.damplips.com/a.mp4"></head></html>'),
      POST,
    );
    expect(media).toBe("https://video.damplips.com/a.mp4");
  });

  it("only accepts a direct file, never an embed page", async () => {
    const media = await readPageMedia(
      htmlPage('<html><head><meta property="og:video:url" content="https://www.damplips.com/embed/67300/"></head></html>'),
      POST,
    );
    expect(media).toBeNull();
  });

  it("gives up after the head plus padding when no file is published", async () => {
    const body = "x".repeat(HEAD_PADDING + PAGE_BYTE_CAP);
    const media = await readPageMedia(htmlPage(`<html><head></head><body>${body}</body></html>`), POST);
    expect(media).toBeNull();
  });

  it("finds a player configuration that sits in the body", async () => {
    const media = await readPageMedia(
      htmlPage(
        `<html><head></head><body><script>videojs("p",{sources:[{file:"${FILE}"}]});</script></body></html>`,
      ),
      POST,
    );
    expect(media).toBe(FILE);
  });
});

describe("resolvePageMedia", () => {
  it("does not fetch for a media file, only for a post page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolvePageMedia(FILE)).toBeNull();
    expect(await resolvePageMedia("https://www.damplips.com/c/hardcore/")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a post page and reuses the answer", async () => {
    const fetchMock = vi.fn(async () => htmlPage(`<meta property="og:video" content="${FILE}">`));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolvePageMedia(POST)).toBe(FILE);
    expect(await resolvePageMedia(POST)).toBe(FILE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recallPageMedia(POST)).toBe(FILE);
  });

  it("collapses concurrent lookups for the same page into one request", async () => {
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);

    const first = resolvePageMedia(POST);
    const second = resolvePageMedia(POST);
    release(htmlPage(`<meta property="og:video" content="${FILE}">`));

    expect(await first).toBe(FILE);
    expect(await second).toBe(FILE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when asked to ignore a remembered answer that stopped working", async () => {
    const fetchMock = vi.fn(async () => htmlPage(`<meta property="og:video" content="${FILE}">`));
    vi.stubGlobal("fetch", fetchMock);

    await resolvePageMedia(POST);
    await resolvePageMedia(POST, { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports no file for an unreachable page, an error page, or a page with none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await resolvePageMedia(POST)).toBeNull();

    clearPageMediaCache();
    vi.stubGlobal("fetch", vi.fn(async () => htmlPage("gone", 404)));
    expect(await resolvePageMedia(POST)).toBeNull();

    clearPageMediaCache();
    vi.stubGlobal("fetch", vi.fn(async () => htmlPage("<html><body>removed</body></html>")));
    expect(await resolvePageMedia(POST)).toBeNull();
  });

  it("follows a redirect to the canonical post URL", async () => {
    const canonical = "https://www.damplips.com/p/67300/";
    const fetchMock = vi.fn(async (url: string) =>
      url === "https://damplips.com/p/67300"
        ? new Response(null, { status: 301, headers: { location: canonical } })
        : htmlPage(`<meta property="og:video" content="${FILE}">`),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolvePageMedia("https://damplips.com/p/67300")).toBe(FILE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveWithin", () => {
  it("returns the answer when it arrives in time", async () => {
    expect(await resolveWithin(Promise.resolve(FILE), 200)).toBe(FILE);
  });

  it("gives up instead of holding the page behind a slow page fetch", async () => {
    const never = new Promise<string | null>(() => {});
    expect(await resolveWithin(never, 10)).toBeNull();
  });

  it("treats a rejected resolution as no answer", async () => {
    expect(await resolveWithin(Promise.reject(new Error("boom")), 200)).toBeNull();
  });
});

describe("resolution cache", () => {
  it("expires an answer after the ttl", () => {
    const now = Date.now();
    rememberPageMedia(POST, FILE, now);
    expect(recallPageMedia(POST, now + RESOLUTION_TTL_MS)).toBe(FILE);
    expect(recallPageMedia(POST, now + RESOLUTION_TTL_MS + 1)).toBeNull();
  });

  it("forgets an answer on request", () => {
    rememberPageMedia(POST, FILE);
    forgetPageMedia(POST);
    expect(recallPageMedia(POST)).toBeNull();
  });
});
