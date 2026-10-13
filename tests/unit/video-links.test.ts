import { describe, it, expect } from "vitest";
import {
  classifyVideoSource,
  extractLinkSource,
  iframeSourceFrom,
  isDirectVideoUrl,
  looksLikeIframeMarkup,
  normalizePastedLink,
} from "@/lib/video/links";
import { normalizeEmbedEntries, normalizeRemoteEntries, splitEmbedEntries, splitUrlEntries } from "@/lib/video/entries";

/**
 * Admins paste links in whatever shape the browser or the source site produced.
 * These tests lock in the shapes the upload page and the API routes must accept,
 * starting with the exact Markdown link from the bug report.
 */

const STREAMTAPE_MARKDOWN =
  "[https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4](https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4)";

describe("normalizePastedLink", () => {
  it("unwraps the Markdown link from the bug report", () => {
    expect(normalizePastedLink(STREAMTAPE_MARKDOWN)).toBe(
      "https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4"
    );
  });

  it("unwraps Markdown links with a label, a title, and escaped brackets", () => {
    expect(normalizePastedLink("[Watch now](https://cdn.example.com/a.mp4)")).toBe("https://cdn.example.com/a.mp4");
    expect(normalizePastedLink('[clip](https://cdn.example.com/a.mp4 "1080p")')).toBe("https://cdn.example.com/a.mp4");
    expect(normalizePastedLink("[https://cdn.example.com/a.mp4](https://cdn.example.com/a.mp4)")).toBe(
      "https://cdn.example.com/a.mp4"
    );
  });

  it("unwraps angle brackets and trailing prose punctuation", () => {
    expect(normalizePastedLink("<https://cdn.example.com/a.mp4>")).toBe("https://cdn.example.com/a.mp4");
    expect(normalizePastedLink("Watch it here: https://cdn.example.com/a.mp4.")).toBe("https://cdn.example.com/a.mp4");
    expect(normalizePastedLink("(https://cdn.example.com/a.mp4)")).toBe("https://cdn.example.com/a.mp4");
  });

  it("extracts the src from pasted iframe markup", () => {
    expect(normalizePastedLink('<iframe src="https://host.example/e/abc123" allowfullscreen></iframe>')).toBe(
      "https://host.example/e/abc123"
    );
    expect(iframeSourceFrom("<iframe src='https://host.example/e/abc' ></iframe>")).toBe("https://host.example/e/abc");
    expect(looksLikeIframeMarkup('<iframe src="x"></iframe>')).toBe(true);
    expect(looksLikeIframeMarkup("https://cdn.example.com/a.mp4")).toBe(false);
  });

  it("leaves a bare URL untouched and decodes HTML entities", () => {
    expect(normalizePastedLink("https://cdn.example.com/a.mp4?token=1&amp;x=2")).toBe(
      "https://cdn.example.com/a.mp4?token=1&x=2"
    );
  });
});

describe("classifyVideoSource", () => {
  it("treats a media file as a direct link", () => {
    expect(classifyVideoSource("https://cdn.example.com/clip_4k.mp4")).toMatchObject({
      kind: "direct",
      url: "https://cdn.example.com/clip_4k.mp4",
      host: "cdn.example.com",
    });
  });

  it("treats a Streamtape watch page as an embed and converts /v/<id> to the player URL", () => {
    expect(classifyVideoSource(STREAMTAPE_MARKDOWN)).toMatchObject({
      kind: "embed",
      url: "https://streamtape.com/e/m9XLJGmaJOcbPr2",
      host: "streamtape.com",
    });
  });

  it("keeps an existing Streamtape /e/ player URL as-is", () => {
    expect(classifyVideoSource("https://streamtape.com/e/m9XLJGmaJOcbPr2")).toMatchObject({
      kind: "embed",
      url: "https://streamtape.com/e/m9XLJGmaJOcbPr2",
    });
  });

  it("converts DoodStream /d/<id> pages to /e/<id>", () => {
    expect(classifyVideoSource("https://do7go.com/d/abc123def")).toMatchObject({
      kind: "embed",
      url: "https://do7go.com/e/abc123def",
    });
  });

  it("recognises generic embed paths when the URL is not a file", () => {
    expect(classifyVideoSource("https://player.example.com/embed/abc")).toMatchObject({
      kind: "embed",
      url: "https://player.example.com/embed/abc",
    });
  });

  it("still rejects text that is neither a file nor a player page", () => {
    expect(() => classifyVideoSource("https://example.com/about")).toThrow(/not a direct video file/i);
    expect(() => classifyVideoSource("just some words")).toThrow(/not a valid http or https video URL/i);
    expect(() => classifyVideoSource("ftp://example.com/a.mp4")).toThrow(/http or https/i);
  });

  it("accepts .ts, .webm and query strings as direct files", () => {
    expect(isDirectVideoUrl("https://cdn.example.com/a.ts")).toBe(true);
    expect(isDirectVideoUrl("https://cdn.example.com/a.webm?token=123")).toBe(true);
    expect(isDirectVideoUrl("https://cdn.example.com/page")).toBe(false);
  });
});

describe("extractLinkSource", () => {
  it("returns the URL and fails loudly on empty input", () => {
    expect(extractLinkSource(STREAMTAPE_MARKDOWN)).toBe(
      "https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4"
    );
    expect(() => extractLinkSource("   ")).toThrow(/Paste a video URL/i);
  });
});

describe("entries normalisation", () => {
  it("splits Markdown links into one normalised entry each", () => {
    expect(splitUrlEntries(`${STREAMTAPE_MARKDOWN}\nhttps://cdn.example.com/a.mp4`)).toEqual([
      "https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4",
      "https://cdn.example.com/a.mp4",
    ]);
  });

  it("normalises iframe markup entries down to their src", () => {
    expect(
      splitEmbedEntries('<iframe src="https://host.example/e/1"></iframe>\n<iframe src="https://host.example/e/2"></iframe>')
    ).toEqual(["https://host.example/e/1", "https://host.example/e/2"]);
  });

  it("normalises Markdown sources sent straight to the embed route", () => {
    expect(normalizeEmbedEntries({ entries: [{ source: STREAMTAPE_MARKDOWN }] })).toEqual([
      { source: "https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4", thumbnailPath: null },
    ]);
  });

  it("normalises Markdown sources sent straight to the direct-URL route", () => {
    expect(normalizeRemoteEntries({ urls: `${STREAMTAPE_MARKDOWN}\nhttps://cdn.example.com/a.mp4` })).toEqual([
      { url: "https://streamtape.com/v/m9XLJGmaJOcbPr2/Hands_Only.mp4.ts.mp4", thumbnailPath: null },
      { url: "https://cdn.example.com/a.mp4", thumbnailPath: null },
    ]);
  });

  it("accepts entry.url and entry.source in the same payload", () => {
    expect(normalizeEmbedEntries({ entries: [{ url: "https://host.example/e/1" }, { source: "https://host.example/e/2" }] })).toEqual([
      { source: "https://host.example/e/1", thumbnailPath: null },
      { source: "https://host.example/e/2", thumbnailPath: null },
    ]);
  });
});

describe("publishing helpers accept the same pasted shapes", () => {
  it("extractIframeSource unwraps Markdown and iframe markup, and converts player pages", async () => {
    const { extractIframeSource } = await import("@/lib/video/publishing");
    expect(extractIframeSource(STREAMTAPE_MARKDOWN)).toBe("https://streamtape.com/e/m9XLJGmaJOcbPr2");
    expect(extractIframeSource('<iframe src="https://host.example/e/abc"></iframe>')).toBe("https://host.example/e/abc");
    expect(() => extractIframeSource("")).toThrow(/Paste an iframe URL/i);
  });

  it("sourceNameFromUrl never includes Markdown punctuation", async () => {
    const { sourceNameFromUrl } = await import("@/lib/video/publishing");
    expect(sourceNameFromUrl(STREAMTAPE_MARKDOWN)).toBe("Hands_Only.mp4.ts.mp4");
    expect(sourceNameFromUrl("<https://cdn.example.com/clip_4k.mp4>")).toBe("clip_4k.mp4");
  });
});
