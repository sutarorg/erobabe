import { describe, expect, it } from "vitest";
import { bunnyEmbedUrl, selectPlaybackSource } from "@/lib/video/playback";
const guid = "44444444-4444-4444-8444-444444444444";
describe("validated stored playback", () => {
  it("preserves historical direct-media playback", () =>
    expect(selectPlaybackSource("https://cdn.example.com/a.mp4")).toEqual({
      kind: "direct",
      url: "https://cdn.example.com/a.mp4",
    }));
  it("builds Bunny embed from stored identity", () => {
    const url = bunnyEmbedUrl("123", guid);
    expect(selectPlaybackSource(null, url, "bunny", "123", guid)).toEqual({
      kind: "embed",
      url,
    });
  });
  it.each([
    "https://evil.example/player",
    `https://iframe.mediadelivery.net/embed/999/${guid}`,
    `https://iframe.mediadelivery.net/embed/123/${guid}?arbitrary=1`,
  ])("rejects mismatched/untrusted %s", (url) =>
    expect(selectPlaybackSource(null, url, "bunny", "123", guid).kind).toBe(
      "missing",
    ),
  );
  it.each(["0", "x", "123/x"])("rejects library %s", (id) =>
    expect(() => bunnyEmbedUrl(id, guid)).toThrow(),
  );
  it("never falls back to native media for Bunny", () =>
    expect(
      selectPlaybackSource(
        "https://cdn.example.com/w",
        null,
        "bunny",
        "123",
        guid,
      ).kind,
    ).toBe("missing"));
  it.each([
    "https://streamtape.com/e/old",
    "https://node.tapecontent.net/video.mp4",
  ])("marks retired %s unsupported", (url) =>
    expect(selectPlaybackSource(url).kind).toBe("unsupported"),
  );
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
      selectPlaybackSource(
        null,
        "https://www.youtube-nocookie.com/embed/abc123",
        "embed",
      ).kind,
    ).toBe("embed");
    expect(
      selectPlaybackSource(null, "https://player.vimeo.com/video/123", "embed")
        .kind,
    ).toBe("embed");
    expect(
      selectPlaybackSource(null, "https://www.youtube.com/redirect", "embed")
        .kind,
    ).toBe("unsupported");
  });
});
