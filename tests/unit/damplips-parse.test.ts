import { describe, expect, it } from "vitest";
import {
  damplipsSlug,
  decodeEntities,
  parseCategoryLinks,
  parseDuration,
  parseListing,
  parseMedia,
  parseNextPageUrl,
  parseVideoPage,
  postIdFromUrl,
  toSafeUrl,
} from "@/lib/damplips/parse";

/**
 * Parser fixtures modelled on damplips.com's real markup: a WordPress listing
 * that links each post twice (poster anchor + title anchor), post pages that
 * advertise their player through Open Graph, JSON-LD or the video element, and
 * the ad networks that sit next to every one of them.
 */

const POSTER = "https://video.damplips.com/pics/wp-content/uploads/2026/10/67284.jpg";

const LISTING_HTML = `
<div class="row">
  <a href="https://www.damplips.com/p/67284/" title="Charli Rose gets a hard lesson in the study">
    <img data-src="${POSTER}" alt="Charli Rose">
  </a>
  <h2><a href="https://www.damplips.com/p/67284/">Charli Rose gets a hard lesson in the study</a></h2>
  <a href="https://www.damplips.com/p/67285/"><img src="https://video.damplips.com/pics/2026/10/67285.jpg"></a>
  <a href="https://www.damplips.com/p/67285/">Two friends share one long afternoon together</a>
  <a href="https://www.damplips.com/c/hardcore/">Hardcore</a>
  <a href="https://a.adtng.com/get/1234" title="Sponsored sexy cam girls near you">Sponsored</a>
  <a href="https://www.damplips.com/p/67284/#comments">12 comments</a>
  <a class="next page-numbers" href="https://www.damplips.com/c/hardcore/page/2/">Next</a>
</div>`;

describe("listing parsing", () => {
  it("merges the poster and title anchors of one post into a single card", () => {
    const { cards } = parseListing(LISTING_HTML);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      sourceId: "67284",
      sourceUrl: "https://www.damplips.com/p/67284/",
      title: "Charli Rose gets a hard lesson in the study",
      thumbnailUrl: POSTER,
    });
    expect(cards[1].sourceId).toBe("67285");
    expect(cards[1].thumbnailUrl).toBe("https://video.damplips.com/pics/2026/10/67285.jpg");
  });

  it("ignores advertisements, navigation and comment anchors", () => {
    const { cards } = parseListing(LISTING_HTML);
    expect(cards.map((card) => card.sourceId)).toEqual(["67284", "67285"]);
  });

  it("finds the next listing page and refuses to follow it off-site", () => {
    expect(parseNextPageUrl(LISTING_HTML, "https://www.damplips.com/c/hardcore/")).toBe(
      "https://www.damplips.com/c/hardcore/page/2/",
    );
    expect(
      parseNextPageUrl(
        '<a class="next" href="https://evil.example/page/2/">Next</a>',
        "https://www.damplips.com/c/hardcore/",
      ),
    ).toBeNull();
  });

  it("resolves relative hrefs against the page it is parsing", () => {
    const { cards } = parseListing('<a href="/p/9001/">A reasonably long post headline</a>');
    expect(cards[0].sourceUrl).toBe("https://www.damplips.com/p/9001/");
  });

  it("drops anchors that are not posts", () => {
    expect(parseListing('<a href="/about/">About damplips and its privacy policy</a>').cards).toEqual([]);
  });

  it("reads the category links on a page", () => {
    const links = parseCategoryLinks(LISTING_HTML);
    expect(links.get("hardcore")).toBe("https://www.damplips.com/c/hardcore/");
  });
});

describe("post page parsing", () => {
  it("reads title, poster, duration and a direct file from Open Graph", () => {
    const html = `<html><head>
      <meta property="og:title" content="Charli Rose gets a hard lesson in the study">
      <meta property="og:image" content="${POSTER}">
      <meta property="og:description" content="A study session that stops being about books.">
      <meta property="video:duration" content="754">
      <meta property="og:video" content="https://video.damplips.com/videos/67284.mp4">
    </head><body></body></html>`;

    const detail = parseVideoPage(html, "https://www.damplips.com/p/67284/");
    expect(detail).toMatchObject({
      sourceId: "67284",
      sourceUrl: "https://www.damplips.com/p/67284/",
      title: "Charli Rose gets a hard lesson in the study",
      thumbnailUrl: POSTER,
      durationSeconds: 754,
      media: { kind: "direct", url: "https://video.damplips.com/videos/67284.mp4" },
    });
  });

  it("reads a videojs style player configuration", () => {
    const html = `<html><head><meta property="og:title" content="A player configuration post"></head>
      <body><script>
        videojs("player", { sources: [{ file: "https://video.damplips.com/hls/67284/index.m3u8", type: "application/x-mpegURL" }] });
      </script></body></html>`;
    expect(parseMedia(html, "https://www.damplips.com/p/67284/")?.url).toBe(
      "https://video.damplips.com/hls/67284/index.m3u8",
    );
  });

  it("prefers a direct file over a framed player", () => {
    const html = `<meta property="og:title" content="Two destinations on one page">
      <iframe src="https://www.damplips.com/embed/67284/"></iframe>
      <video><source src="https://video.damplips.com/videos/67284.mp4" type="video/mp4"></video>`;
    expect(parseMedia(html, "https://www.damplips.com/p/67284/")).toEqual({
      kind: "direct",
      url: "https://video.damplips.com/videos/67284.mp4",
    });
  });

  it("reads the media damplips actually publishes today", () => {
    // The current post markup: a server-rendered video.js element whose
    // `<source>` is a plain file on the media host — the URL an importer must
    // store as `playable_url` so the browser can stream it directly.
    const file = "https://video.damplips.com/video7/717/79.mp4";
    const html = `<html><head><meta property="og:title" content="Paramedic could not stop"></head>
      <body>
        <div class="video-player">
          <video id="player" class="video-js vjs-tech" poster="${POSTER}" preload="auto">
            <source src="${file}" type="video/mp4">
          </video>
        </div>
      </body></html>`;

    expect(parseMedia(html, "https://www.damplips.com/p/67284/")).toEqual({
      kind: "direct",
      url: file,
    });
    expect(parseVideoPage(html, "https://www.damplips.com/p/67284/")?.media).toEqual({
      kind: "direct",
      url: file,
    });
  });

  it("reads a media URL a player wrote with escaped slashes", () => {
    // Players configured from JavaScript publish `https:\/\/…`; without
    // unescaping, those posts import as "no media".
    const html = `<html><head><meta property="og:title" content="A JavaScript player"></head>
      <body><script>
        jwplayer("v").setup({ file: "https:\/\/video.damplips.com\/video7\/717\/80.mp4" });
      </script></body></html>`;
    expect(parseMedia(html, "https://www.damplips.com/p/67285/")?.url).toBe(
      "https://video.damplips.com/video7/717/80.mp4",
    );
  });

  it("accepts a damplips embed page when the post frames its own player", () => {
    const html = `<meta property="og:title" content="A framed damplips player">
      <iframe src="https://www.damplips.com/embed/67284/"></iframe>`;
    expect(parseMedia(html, "https://www.damplips.com/p/67284/")).toEqual({
      kind: "embed",
      url: "https://www.damplips.com/embed/67284/",
    });
  });

  it("never takes media from an advertising host", () => {
    const html = `<meta property="og:title" content="Advertising heavy post page">
      <iframe src="https://tgp1.brazzersnetwork.com/x.mp4"></iframe>
      <a href="https://join.brokensluts.net/?utm=1">Join</a>
      <script>var ad = "https://a.adtng.com/get/1234.mp4";</script>`;
    expect(parseMedia(html, "https://www.damplips.com/p/67284/")).toBeNull();
  });

  it("reports a post with no media as having none", () => {
    const html = `<meta property="og:title" content="A post without a player yet">
      <meta property="og:image" content="${POSTER}">`;
    const detail = parseVideoPage(html, "https://www.damplips.com/p/67284/");
    expect(detail?.media).toBeNull();
    expect(detail?.thumbnailUrl).toBe(POSTER);
  });

  it("falls back to the poster image in the body when og:image is absent", () => {
    const html = `<h1>Body poster post</h1><img src="${POSTER}">`;
    expect(parseVideoPage(html, "https://www.damplips.com/p/67284/")?.thumbnailUrl).toBe(POSTER);
  });

  it("returns null when a page has no title (an error page, not a video)", () => {
    expect(parseVideoPage("<html><body>Not found</body></html>", "https://www.damplips.com/p/1/")).toBeNull();
  });

  it("decodes entities in titles", () => {
    const html = `<h1>Rope &amp; candles &#8217;n&#8217; things</h1>`;
    expect(parseVideoPage(html, "https://www.damplips.com/p/67284/")?.title).toBe(
      "Rope & candles ’n’ things",
    );
  });
});

describe("helpers", () => {
  it("normalises durations", () => {
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("12:34")).toBe(754);
    expect(parseDuration("754")).toBe(754);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("not a duration")).toBeNull();
  });

  it("extracts the post id from any URL shape", () => {
    expect(postIdFromUrl("https://www.damplips.com/p/67284/")).toBe("67284");
    expect(postIdFromUrl("/p/67284/?utm=1")).toBe("67284");
    expect(postIdFromUrl("https://www.damplips.com/c/hardcore/")).toBeNull();
  });

  it("builds a stable, id-suffixed slug", () => {
    expect(damplipsSlug("Charli Rose: A Hard Lesson!", "67284")).toBe(
      "charli-rose-a-hard-lesson-67284",
    );
    expect(damplipsSlug("!!!", "7")).toBe("video-7");
  });

  it("decodes the entities damplips actually uses", () => {
    expect(decodeEntities("A &amp; B &lt;3 &nbsp;")).toBe("A & B <3  ");
  });

  it("only accepts http(s) URLs", () => {
    expect(toSafeUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeUrl("https://www.damplips.com/p/1/")).toBe("https://www.damplips.com/p/1/");
  });
});
