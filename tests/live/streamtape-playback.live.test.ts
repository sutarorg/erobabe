import { describe, it, expect, beforeAll } from "vitest";
import { getStreamtapeLink, resetPlaybackCache } from "@/lib/video/playback-cache";
import { streamStreamtapeMedia } from "@/lib/video/streamtape-media";

/**
 * LIVE Streamtape playback test — checks, against the real API and media
 * hosts, the three things instant start depends on:
 *
 *   1. how long Streamtape makes a brand-new link wait (the delay the watch
 *      page's prepare request hides before Play is pressed),
 *   2. that one link serves the iOS probe, the first frames and a seek, so a
 *      single handshake per file is enough, and
 *   3. that every later request reuses the link instead of waiting again.
 *
 * It is excluded from `npm test` (see vitest.config.ts). Run it deliberately
 * from a machine with outbound HTTPS to api.streamtape.com and the media hosts,
 * using the file id of any video you host there — the part after `/e/` or `/v/`
 * in its Streamtape link:
 *
 *   STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… STREAMTAPE_PLAYBACK_FILE_ID=… npm run test:live
 *
 * Strictly read-only. The media link is a credential, so it is never printed:
 * only timings, status codes and the media host name are logged.
 */

const login = String(process.env.STREAMTAPE_LOGIN || "").trim();
const key = String(process.env.STREAMTAPE_API_KEY || "").trim();
const fileId = String(process.env.STREAMTAPE_PLAYBACK_FILE_ID || "").trim();
const suite = login && key && fileId ? describe : describe.skip;

/** What a browser sends to the relay for one byte range. */
function rangeRequest(range: string): Request {
  return new Request("http://localhost/api/videos/live/playback", { headers: { range } });
}

/**
 * Reads up to `limit` bytes of a streamed body, then cancels the rest like a
 * browser would. `firstByteMs` counts from `requestedAt`, i.e. it includes the
 * wait for the media host's response headers.
 */
async function readSome(response: Response, limit: number, requestedAt: number): Promise<{ bytes: number; firstByteMs: number }> {
  const reader = response.body!.getReader();
  let bytes = 0;
  let firstByteMs = -1;
  while (bytes < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs < 0) firstByteMs = Math.round(performance.now() - requestedAt);
    bytes += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return { bytes, firstByteMs };
}

suite("Streamtape playback (live)", () => {
  beforeAll(() => {
    resetPlaybackCache();
  });

  it("resolves a media link once and reports how long Streamtape makes it wait", async () => {
    const start = performance.now();
    const first = await getStreamtapeLink(fileId);
    const handshakeMs = Math.round(performance.now() - start);
    console.log(`[live-playback] new link after ${handshakeMs} ms (media host ${new URL(first.link.url).hostname})`);
    expect(first.cached).toBe(false);

    const again = performance.now();
    const second = await getStreamtapeLink(fileId);
    const cachedMs = Math.round(performance.now() - again);
    console.log(`[live-playback] the same file again after ${cachedMs} ms`);
    expect(second.cached).toBe(true);
    expect(second.link).toBe(first.link);
    expect(cachedMs).toBeLessThan(50);
  }, 120_000);

  it("streams the iOS probe, the first frames and a seek with that one link", async () => {
    const { link } = await getStreamtapeLink(fileId);

    // iOS Safari always starts with a two-byte probe.
    const probe = await streamStreamtapeMedia(link.url, rangeRequest("bytes=0-1"));
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-type")).toMatch(/^(video\/|application\/octet-stream)/);
    const total = Number(probe.headers.get("content-range")?.split("/")[1]);
    expect(total).toBeGreaterThan(2);
    expect((await probe.arrayBuffer()).byteLength).toBe(2);

    // The first frames: what every browser asks for after pressing Play.
    const openedAt = performance.now();
    const opening = await streamStreamtapeMedia(link.url, rangeRequest("bytes=0-"));
    expect(opening.status).toBe(206);
    const head = await readSome(opening, 256 * 1024, openedAt);
    console.log(`[live-playback] first frames: first byte after ${head.firstByteMs} ms, ${head.bytes} bytes read of ${total}`);
    expect(head.bytes).toBeGreaterThan(0);

    // A seek to the middle of the file reuses the link without a new ticket.
    const middle = Math.floor(total / 2);
    const seekedAt = performance.now();
    const seek = await streamStreamtapeMedia(link.url, rangeRequest(`bytes=${middle}-`));
    expect(seek.status).toBe(206);
    expect(seek.headers.get("content-range")).toMatch(new RegExp(`^bytes ${middle}-\\d+/${total}$`));
    const jump = await readSome(seek, 64 * 1024, seekedAt);
    console.log(`[live-playback] seek to 50%: first byte after ${jump.firstByteMs} ms`);
    expect(jump.bytes).toBeGreaterThan(0);

    // Still the same cached link: no request above paid the ticket wait.
    const after = await getStreamtapeLink(fileId);
    expect(after.cached).toBe(true);
    expect(after.link).toBe(link);
  }, 180_000);
});
