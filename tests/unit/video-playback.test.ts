import { describe, expect, it } from "vitest";
import { selectPlaybackSource } from "@/lib/video/playback";
describe("stored playback selection", () => {
  it("preserves direct legacy playback", () => expect(selectPlaybackSource("https://cdn.example.com/a.mp4")).toEqual({ kind: "direct", url: "https://cdn.example.com/a.mp4" }));
  it("uses returned FileKosh embed without manufacturing paths", () => expect(selectPlaybackSource(null, "https://filekosh.com/embed/returned-slug")).toEqual({ kind: "embed", url: "https://filekosh.com/embed/returned-slug" }));
  it.each(["https://streamtape.com/e/old", "https://node.tapecontent.net/video.mp4"])("marks retired %s unsupported without API calls", url => expect(selectPlaybackSource(url).kind).toBe("unsupported"));
  it.each(["javascript:alert(1)", "https://user:secret@example.com/player"])("rejects %s", url => expect(selectPlaybackSource(null, url).kind).toBe("missing"));
  it("never treats FileKosh share data as native media", () => {
    expect(selectPlaybackSource("https://filekosh.com/w/share", "https://filekosh.com/embed/returned", "filekosh")).toEqual({ kind: "embed", url: "https://filekosh.com/embed/returned" });
    expect(selectPlaybackSource("https://filekosh.com/w/share", null, "filekosh").kind).toBe("missing");
    expect(selectPlaybackSource(null, "https://evil.example/player", "filekosh").kind).toBe("missing");
  });

});
