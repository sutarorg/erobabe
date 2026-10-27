import { describe, expect, it } from "vitest";
import {
  damplipsProxyUrl,
  isDamplipsMediaUrl,
  selectPlaybackSource,
} from "@/lib/video/playback";

describe("validated stored playback", () => {
  it("preserves direct-media playback", () =>
    expect(selectPlaybackSource("https://cdn.example.com/a.mp4")).toEqual({
      kind: "direct",
      url: "https://cdn.example.com/a.mp4",
    }));

  it("plays a damplips direct file in our own player", () => {
    const url = "https://video.damplips.com/videos/67284.mp4";
    expect(selectPlaybackSource(url, null, "damplips")).toEqual({
      kind: "direct",
      url,
    });
  });

  it("proxies damplips media through the same-origin stream route", () => {
    const url = "https://video.damplips.com/videos/67284.mp4";
    expect(damplipsProxyUrl(url)).toBe(
      `/api/videos/stream?src=${encodeURIComponent(url)}`,
    );
    expect(isDamplipsMediaUrl(url)).toBe(true);
    expect(isDamplipsMediaUrl("https://damplips.example.com/a.mp4")).toBe(false);
  });

  it("accepts a damplips embed page", () => {
    expect(
      selectPlaybackSource(null, "https://www.damplips.com/p/67284/", "damplips"),
    ).toEqual({ kind: "embed", url: "https://www.damplips.com/p/67284/" });
  });

  it.each([
    "https://streamtape.com/e/old",
    "https://node.tapecontent.net/video.mp4",
    "https://cdn.example.com/clip.mp4",
  ])("marks retired provider media unsupported (%s)", (url) =>
    expect(
      selectPlaybackSource(url, null, url.includes("cdn.example") ? "bunny" : undefined).kind,
    ).toBe("unsupported"),
  );

  it("never hands a retired provider row to a player", () => {
    const embed = "https://iframe.mediadelivery.net/embed/123/44444444-4444-4444-8444-444444444444";
    expect(selectPlaybackSource(null, embed, "bunny")).toEqual({
      kind: "unsupported",
    });
  });

  it.each(["javascript:alert(1)", "https://user:secret@example.com/player"])(
    "rejects %s",
    (url) => expect(selectPlaybackSource(null, url).kind).toBe("missing"),
  );

  it("does not mount arbitrary iframes", () =>
    expect(selectPlaybackSource(null, "https://evil.example/embed").kind).toBe(
      "unsupported",
    ));

  it("preserves trusted historical player formats without allowing arbitrary origins", () => {
    expect(
      selectPlaybackSource(null, "https://www.youtube-nocookie.com/embed/abc123", "embed")
        .kind,
    ).toBe("embed");
    expect(
      selectPlaybackSource(null, "https://player.vimeo.com/video/123", "embed").kind,
    ).toBe("embed");
    expect(
      selectPlaybackSource(null, "https://www.youtube.com/redirect", "embed").kind,
    ).toBe("unsupported");
  });

  it("reports rows with no media destination as missing", () => {
    expect(selectPlaybackSource(null, null, "damplips")).toEqual({ kind: "missing" });
  });
});
