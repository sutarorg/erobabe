// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import {
  STREAMTAPE_TICKET_MAX_ENTRIES,
  STREAMTAPE_TICKET_TTL_MS,
  cachedStreamtapeTicket,
  clearStreamtapeTicketCache,
  forgetStreamtapeTicket,
  rememberStreamtapeTicket,
  resolveStreamtapeTicket,
  streamtapeTicketCacheSize,
  warmStreamtapeTicket,
} from "@/lib/video/streamtape-tickets";

const FILE_ID = "Ab123Cd";
const MEDIA = "https://node.tapecontent.net/video.mp4?token=abc";

beforeEach(() => {
  clearStreamtapeTicketCache();
  download.mockReset().mockResolvedValue(MEDIA);
});

describe("streamtape media link cache", () => {
  it("resolves once and reuses the link for later requests", async () => {
    const first = await resolveStreamtapeTicket(FILE_ID);
    expect(first).toEqual({ url: MEDIA, fromCache: false });
    expect(download).toHaveBeenCalledTimes(1);

    const second = await resolveStreamtapeTicket(FILE_ID);
    expect(second).toEqual({ url: MEDIA, fromCache: true });
    expect(download).toHaveBeenCalledTimes(1);
    expect(cachedStreamtapeTicket(FILE_ID)).toBe(MEDIA);
  });

  it("shares one resolution between concurrent requests (single flight)", async () => {
    let release: (value: string) => void = () => {};
    download.mockImplementation(() => new Promise<string>((resolve) => { release = resolve; }));

    const requests = Promise.all([resolveStreamtapeTicket(FILE_ID), resolveStreamtapeTicket(FILE_ID)]);
    release(MEDIA);
    const [first, second] = await requests;

    expect(download).toHaveBeenCalledTimes(1);
    // The request that joined an in-flight resolution never waits for a second.
    expect([first.fromCache, second.fromCache]).toContain(true);
    expect([first.url, second.url]).toEqual([MEDIA, MEDIA]);
  });

  it("expires links so the media host never sees one past its lifetime", async () => {
    vi.useFakeTimers();
    try {
      await resolveStreamtapeTicket(FILE_ID);
      vi.advanceTimersByTime(STREAMTAPE_TICKET_TTL_MS - 1);
      expect(cachedStreamtapeTicket(FILE_ID)).toBe(MEDIA);

      vi.advanceTimersByTime(2);
      expect(cachedStreamtapeTicket(FILE_ID)).toBeNull();
      download.mockResolvedValue(`${MEDIA}&v=2`);
      expect(await resolveStreamtapeTicket(FILE_ID)).toEqual({ url: `${MEDIA}&v=2`, fromCache: false });
      expect(download).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a link on demand so the next request resolves a fresh one", async () => {
    await resolveStreamtapeTicket(FILE_ID);
    forgetStreamtapeTicket(FILE_ID);
    expect(cachedStreamtapeTicket(FILE_ID)).toBeNull();
    await resolveStreamtapeTicket(FILE_ID);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("refuses to cache anything that is not an allowlisted media host", () => {
    expect(() => rememberStreamtapeTicket(FILE_ID, "https://evil.example/video.mp4")).toThrow();
    expect(() => rememberStreamtapeTicket(FILE_ID, "https://streamtape.com/e/Ab123")).toThrow();
    expect(streamtapeTicketCacheSize()).toBe(0);
  });

  it("never stores a link that upstream rejected", async () => {
    download.mockRejectedValue(new Error("Streamtape is rate-limiting this account."));
    await expect(resolveStreamtapeTicket(FILE_ID)).rejects.toThrow(/rate-limiting/);
    expect(streamtapeTicketCacheSize()).toBe(0);
    // A background warm-up never throws to its caller.
    await expect(warmStreamtapeTicket(FILE_ID)).resolves.toBe(false);
  });

  it("keeps the cache bounded", () => {
    for (let index = 0; index <= STREAMTAPE_TICKET_MAX_ENTRIES; index++) {
      rememberStreamtapeTicket(`File${index}`, `https://node.tapecontent.net/${index}.mp4`);
    }
    expect(streamtapeTicketCacheSize()).toBe(STREAMTAPE_TICKET_MAX_ENTRIES);
    // Oldest first: the first file is the one that was evicted.
    expect(cachedStreamtapeTicket("File0")).toBeNull();
    expect(cachedStreamtapeTicket(`File${STREAMTAPE_TICKET_MAX_ENTRIES}`)).not.toBeNull();
  });

  it("ignores blank or malformed file ids", async () => {
    expect(cachedStreamtapeTicket("")).toBeNull();
    rememberStreamtapeTicket("bad id!", MEDIA);
    expect(streamtapeTicketCacheSize()).toBe(0);
    expect(await warmStreamtapeTicket("")).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
});
