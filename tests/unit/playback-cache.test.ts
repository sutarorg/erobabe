// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import {
  ACCESS_TTL_MS, LINK_MAX_AGE_MS, LINK_REFRESH_AFTER_MS,
  getStreamtapeLink, invalidateStreamtapeLink, prepareStreamtapeLink,
  recallPlaybackAccess, rememberPlaybackAccess, resetPlaybackCache,
} from "@/lib/video/playback-cache";

const A = "https://node.tapecontent.net/a.mp4?token=1";
const B = "https://node.tapecontent.net/a.mp4?token=2";

const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const logged = () => [...info.mock.calls, ...warn.mock.calls].map((args) => args.join(" ")).join("\n");

beforeEach(() => {
  resetPlaybackCache();
  download.mockReset().mockResolvedValueOnce(A).mockResolvedValueOnce(B);
  info.mockClear();
  warn.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("Streamtape link cache", () => {
  it("resolves once, then serves the cached link", async () => {
    const first = await getStreamtapeLink("f1");
    const second = await getStreamtapeLink("f1");
    expect(first).toMatchObject({ cached: false, link: { url: A } });
    expect(second).toMatchObject({ cached: true, link: { url: A } });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight handshake between concurrent callers", async () => {
    const results = await Promise.all([getStreamtapeLink("f1"), getStreamtapeLink("f1"), prepareStreamtapeLink("f1")]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ cached: false, link: { url: A } });
    expect(results[1]).toMatchObject({ cached: false, link: { url: A } });
  });

  it("keeps files apart", async () => {
    download.mockReset().mockImplementation(async (fileId: string) => `https://node.tapecontent.net/${fileId}.mp4`);
    expect((await getStreamtapeLink("f1")).link.url).toContain("f1.mp4");
    expect((await getStreamtapeLink("f2")).link.url).toContain("f2.mp4");
  });

  it("does not cache a failed handshake", async () => {
    download.mockReset().mockRejectedValueOnce(new Error("509")).mockResolvedValueOnce(A);
    await expect(getStreamtapeLink("f1")).rejects.toThrow("509");
    expect((await getStreamtapeLink("f1")).link.url).toBe(A);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it.each(["https://evil.example/a.mp4", "https://streamtape.com/e/abc", "https://api.streamtape.com/file/dl?key=1"])(
    "never caches a link it would refuse to fetch: %s",
    async (unsafe) => {
      download.mockReset().mockResolvedValueOnce(unsafe).mockResolvedValueOnce(A);
      await expect(getStreamtapeLink("f1")).rejects.toThrow();
      expect((await getStreamtapeLink("f1")).link.url).toBe(A);
    },
  );

  it("drops an invalidated link, but never a newer replacement", async () => {
    const { link: stale } = await getStreamtapeLink("f1");
    invalidateStreamtapeLink(stale);
    const { link: fresh, cached } = await getStreamtapeLink("f1");
    expect(cached).toBe(false);
    expect(fresh.url).toBe(B);
    invalidateStreamtapeLink(stale);
    expect(await getStreamtapeLink("f1")).toMatchObject({ cached: true, link: { url: B } });
  });

  it("serves an ageing link immediately while refreshing it in the background", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await getStreamtapeLink("f1");
    vi.setSystemTime(Date.now() + LINK_REFRESH_AFTER_MS);
    expect(await getStreamtapeLink("f1")).toMatchObject({ cached: true, link: { url: A } });
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect((await getStreamtapeLink("f1")).link.url).toBe(B));
  });

  it("waits for a new link once the old one is past its maximum age", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await getStreamtapeLink("f1");
    vi.setSystemTime(Date.now() + LINK_MAX_AGE_MS);
    expect(await getStreamtapeLink("f1")).toMatchObject({ cached: false, link: { url: B } });
  });

  it("prepare is a no-op for a fresh link and renews an ageing one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await prepareStreamtapeLink("f1");
    await prepareStreamtapeLink("f1");
    expect(download).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + LINK_REFRESH_AFTER_MS);
    await prepareStreamtapeLink("f1");
    expect(download).toHaveBeenCalledTimes(2);
    expect((await getStreamtapeLink("f1")).link.url).toBe(B);
  });

  it("a reset discards results of handshakes that were still running", async () => {
    let finish!: (url: string) => void;
    download.mockReset().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValueOnce(B);
    const pending = getStreamtapeLink("f1");
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    resetPlaybackCache();
    finish(A);
    await pending;
    expect(await getStreamtapeLink("f1")).toMatchObject({ cached: false, link: { url: B } });
  });
});

describe("logs", () => {
  it("records how long each new link took and what asked for it, never the link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    let finish!: (url: string) => void;
    download.mockReset().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = prepareStreamtapeLink("f1");
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date("2026-10-14T12:00:10.300Z"));
    finish(A);
    await pending;
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe("[playback] Streamtape link ready in 10.3 s (file f1, prepare)");
    // A cached link needs no handshake, so it writes nothing.
    await getStreamtapeLink("f1");
    expect(info).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain("token");
  });

  it("names the cause of a background refresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await getStreamtapeLink("f1");
    vi.setSystemTime(Date.now() + LINK_REFRESH_AFTER_MS);
    await getStreamtapeLink("f1");
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    expect(info.mock.calls.map(([line]) => /\(file f1, (\w+)\)/.exec(line)?.[1])).toEqual(["request", "refresh"]);
  });

  it("logs only a fixed error code when Streamtape fails", async () => {
    const providerError = Object.assign(new Error("Denied for login=y7bh key=dq6h at https://node.tapecontent.net/a.mp4?token=9"), {
      name: "StreamtapeError", code: "unauthorized",
    });
    download.mockReset().mockRejectedValueOnce(providerError).mockResolvedValueOnce("https://evil.example/a.mp4?token=7");
    await expect(getStreamtapeLink("f1")).rejects.toThrow();
    await expect(getStreamtapeLink("f1")).rejects.toThrow();
    expect(warn.mock.calls.map(([line]) => line.replace(/after [\d.]+ s/, "after N s"))).toEqual([
      "[playback] Streamtape link failed after N s (file f1, request): unauthorized",
      "[playback] Streamtape link failed after N s (file f1, request): untrusted_link",
    ]);
    expect(logged()).not.toMatch(/token|login=|key=|evil/);
  });

  it("logs a refused link's status and age, never the link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { link } = await getStreamtapeLink("f1");
    vi.setSystemTime(Date.now() + 25 * 60_000);
    invalidateStreamtapeLink(link, { status: 403, retrying: true });
    invalidateStreamtapeLink(link);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "[playback] Media host did not serve video for a Streamtape link (file f1, HTTP 403, 25 min old); retrying with a fresh link",
      "[playback] Media host did not serve video for a Streamtape link (file f1, connection failed, 25 min old)",
    ]);
    expect(logged()).not.toContain("token");
  });
});

describe("catalogue access cache", () => {
  it("remembers a positive decision only for its TTL", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect(recallPlaybackAccess("v1")).toBeNull();
    rememberPlaybackAccess("v1", "f1");
    expect(recallPlaybackAccess("v1")).toBe("f1");
    vi.setSystemTime(Date.now() + ACCESS_TTL_MS);
    expect(recallPlaybackAccess("v1")).toBeNull();
  });

  it("is bounded so it cannot grow without limit", () => {
    for (let index = 0; index < 1_100; index++) rememberPlaybackAccess(`v${index}`, `f${index}`);
    expect(recallPlaybackAccess("v0")).toBeNull();
    expect(recallPlaybackAccess("v1099")).toBe("f1099");
  });
});
