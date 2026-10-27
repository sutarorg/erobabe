import { describe, expect, it } from "vitest";
import { isHlsContentType, isHlsUrl, rewriteHlsPlaylist } from "@/lib/video/hls";

/**
 * Playlists are documents: every URI inside them is a separate request. The
 * proxy rewrites each one so a segment can never be resolved against the wrong
 * base, and never fetched straight from damplips where CORS would stop it.
 */

const proxify = (url: string) => `/api/videos/stream?src=${encodeURIComponent(url)}`;
const PLAYLIST = "https://video.damplips.com/videos/67284/index.m3u8";

describe("HLS playlist rewriting", () => {
  it("recognises playlists by type and by path", () => {
    expect(isHlsContentType("application/vnd.apple.mpegurl")).toBe(true);
    expect(isHlsContentType("application/x-mpegURL; charset=utf-8")).toBe(true);
    expect(isHlsContentType("video/mp4")).toBe(false);
    expect(isHlsContentType(null)).toBe(false);
    expect(isHlsUrl("https://video.damplips.com/v/1/index.m3u8?token=1")).toBe(true);
    expect(isHlsUrl("https://video.damplips.com/v/1/clip.mp4")).toBe(false);
  });

  it("resolves relative segment paths against the playlist", () => {
    const output = rewriteHlsPlaylist("#EXTM3U\nseg-1.ts", PLAYLIST, proxify);
    expect(output).toBe(`#EXTM3U\n${proxify("https://video.damplips.com/videos/67284/seg-1.ts")}`);
  });

  it("proxies absolute segment URLs instead of leaving them for the browser", () => {
    const output = rewriteHlsPlaylist(
      "#EXTM3U\nhttps://video.damplips.com/videos/67284/seg-1.ts",
      PLAYLIST,
      proxify,
    );
    expect(output).toContain(proxify("https://video.damplips.com/videos/67284/seg-1.ts"));
    expect(output).not.toContain("\nhttps://video.damplips.com");
  });

  it("rewrites keys, init maps and renditions carried in attributes", () => {
    const output = rewriteHlsPlaylist(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
        '#EXT-X-MAP:URI="/init.mp4"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio/en.m3u8"',
      ].join("\n"),
      PLAYLIST,
      proxify,
    );
    expect(output).toContain(`URI="${proxify("https://video.damplips.com/videos/67284/key.bin")}"`);
    expect(output).toContain(`URI="${proxify("https://video.damplips.com/init.mp4")}"`);
    expect(output).toContain(`URI="${proxify("https://video.damplips.com/videos/67284/audio/en.m3u8")}"`);
    expect(output).toContain("METHOD=AES-128");
    expect(output).toContain("IV=0x1");
  });

  it("leaves tags and blank lines untouched, and keeps the playlist valid", () => {
    const input = "#EXTM3U\n#EXT-X-VERSION:3\n\n#EXT-X-ENDLIST\n";
    expect(rewriteHlsPlaylist(input, PLAYLIST, proxify)).toBe(input);
  });

  it("never proxies a URI the caller refuses", () => {
    const output = rewriteHlsPlaylist(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="https://other.example/a.m3u8"\nseg.ts',
      PLAYLIST,
      (url) => (url.includes("damplips.com") ? proxify(url) : null),
    );
    expect(output).toContain('URI="https://other.example/a.m3u8"');
    expect(output).toContain(proxify("https://video.damplips.com/videos/67284/seg.ts"));
  });

  it("ignores data: URIs", () => {
    const output = rewriteHlsPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE,URI="data:text/plain,x"', PLAYLIST, proxify);
    expect(output).toContain('URI="data:text/plain,x"');
  });
});
