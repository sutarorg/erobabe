import { describe, expect, it } from "vitest";
import { safeStreamtapeMediaUrl, selectPlaybackSource, streamtapeFileId } from "@/lib/video/playback";

describe("playback selection", () => {
  it.each(["e", "v", "d"])("recognises Streamtape /%s pages including misleading media names", (path) => {
    const url = `https://streamtape.com/${path}/Ab123/clip.mp4`;
    expect(streamtapeFileId(url)).toBe("Ab123");
    expect(selectPlaybackSource(null, url)).toEqual({ kind: "streamtape", fileId: "Ab123" });
    expect(selectPlaybackSource(url)).toEqual({ kind: "streamtape", fileId: "Ab123" });
  });
  it.each(["streamtape.net", "streamtape.to", "www.streamtape.com"])("supports %s", (host) => {
    expect(streamtapeFileId(`https://${host}/e/abc`)).toBe("abc");
  });
  it.each(["https://streamtape.com.evil.test/e/abc", "https://notstreamtape.com/e/abc", "https://streamtape.com/e/abc-invalid", "javascript:alert(1)"])("does not extract IDs from %s", (url) => {
    expect(streamtapeFileId(url)).toBeNull();
  });
  it("prefers a real direct replacement over a Streamtape embed", () => {
    expect(selectPlaybackSource("https://cdn.example.com/a.mp4", "https://streamtape.com/e/abc"))
      .toEqual({ kind: "direct", url: "https://cdn.example.com/a.mp4" });
  });
  it("never falls back to a malformed Streamtape iframe", () => {
    expect(selectPlaybackSource(null, "https://streamtape.com/unknown")).toEqual({ kind: "streamtape", fileId: null });
  });
  it("retains other providers and rejects executable sources", () => {
    expect(selectPlaybackSource(null, "https://example.com/embed/abc").kind).toBe("embed");
    expect(selectPlaybackSource(null, "javascript:alert(1)").kind).toBe("missing");
    expect(selectPlaybackSource().kind).toBe("missing");
  });
});

describe("Streamtape media URL validation", () => {
  it.each(["https://node.tapecontent.net/path/video.mp4?token=abc", "https://streamtape.com/get_video?id=abc&token=xyz"])("accepts media URL %s", (url) => {
    expect(safeStreamtapeMediaUrl(url)).toBe(url);
  });
  it.each([
    "http://node.tapecontent.net/video.mp4", "https://streamtape.com/e/abc",
    "https://tapecontent.net.evil.test/video.mp4", "https://api.streamtape.com/file/dl",
    "https://node.tapecontent.net/video.mp4?key=secret", "https://streamtape.com/get_video?LOGIN=secret",
    "https://user:secret@tapecontent.net/video.mp4", "http://127.0.0.1/file.mp4",
    "javascript:alert(1)", "not a URL",
  ])("rejects unsafe API output %s", (url) => {
    expect(() => safeStreamtapeMediaUrl(url)).toThrow();
  });
});
