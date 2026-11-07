// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  embedUrlFor,
  maxQualityHeight,
  parseDuration,
  parseSearchListing,
  parseVideoPage,
  pornhubSlug,
  searchUrl,
  viewkeyFromUrl,
  watchUrlFor,
} from "@/lib/pornhub/parse";

/**
 * The parser is the only thing standing between Pornhub's markup and the
 * catalog, so it is pinned against a faithful slice of a real search page.
 *
 * The fixture keeps the shape the site has published for years: each result is
 * a list item carrying `data-video-vkey`, `data-thumb_url`, `data-title` and
 * `data-duration`, with the poster anchor, the duration badge and the HD badge
 * inside it. Two things are deliberate:
 *
 *  - one card is linked twice (poster and title anchors), as the real page does;
 *  - one card carries no HD badge, which is how a non-HD result looks.
 */
const SEARCH_HTML = `
<html><head><title>amateur videos</title></head>
<body>
<ul class="pcVideoListItem-list">
  <li class="pcVideoListItem js-pop" data-video-vkey="68a1b2c3d4e5f" data-thumb_url="https://ei.phncdn.com/videos/202408/27/45678901/original/(m=qW8RZGa)(mh=abc)_1.jpg" data-title="Morning coffee with my neighbour" data-duration="12:34">
    <div class="phimage">
      <a href="/view_video.php?viewkey=68a1b2c3d4e5f" title="Morning coffee with my neighbour" class="js-typed-link">
        <img src="https://ei.phncdn.com/videos/202408/27/45678901/original/(m=qW8RZGa)(mh=abc)_1.jpg" alt="Morning coffee with my neighbour" />
      </a>
      <div class="marker-overlays">
        <var class="duration">12:34</var>
        <var class="hd-thumbnail">HD</var>
      </div>
    </div>
    <div class="thumbnail-info-wrapper">
      <a href="/view_video.php?viewkey=68a1b2c3d4e5f" class="title">Morning coffee with my neighbour</a>
    </div>
  </li>
  <li class="pcVideoListItem js-pop" data-video-vkey="68b2c3d4e5f60" data-thumb_url="https://ev.phncdn.com/videos/202407/11/99887766/original/(m=xyz)_2.jpg" data-title="Low bitrate home clip" data-duration="04:05">
    <div class="phimage">
      <a href="/view_video.php?viewkey=68b2c3d4e5f60">
        <img src="https://ev.phncdn.com/videos/202407/11/99887766/original/(m=xyz)_2.jpg" alt="" />
      </a>
      <div class="marker-overlays"><var class="duration">04:05</var></div>
    </div>
  </li>
  <li class="pcVideoListItem js-pop" data-video-vkey="68c3d4e5f6071">
    <div class="phimage">
      <a href="/view_video.php?viewkey=68c3d4e5f6071" title="Afternoon in the garden">
        <img data-src="https://ci.phncdn.com/videos/202406/02/11223344/original/(m=qq)_3.jpg" alt="Afternoon in the garden" />
      </a>
      <div class="marker-overlays"><span class="duration">21:10</span></div>
    </div>
  </li>
  <li class="pcVideoListItem js-pop" data-video-vkey="68d4e5f607182">
    <div class="phimage">
      <a href="/view_video.php?viewkey=68d4e5f607182" title="Clip with a tracking image">
        <img src="https://ads.example.com/tracker.jpg" alt="Clip with a tracking image" />
      </a>
      <div class="marker-overlays"><var class="duration">08:00</var></div>
    </div>
  </li>
  <li class="pcVideoListItem">
    <div class="phimage">
      <a href="/video/search?search=amateur&page=2">Navigation link</a>
    </div>
  </li>
</ul>
<div class="pagination">
  <a href="/video/search?search=amateur&page=2">2</a>
  <a href="/video/search?search=amateur&page=3">3</a>
  <a href="/video/search?search=amateur&page=42">Next</a>
</div>
</body></html>`;

/** A page with no HD badge anywhere: the parser must say "unknown", not "no". */
const SEARCH_HTML_WITHOUT_BADGES = SEARCH_HTML.replace(
  /<var class="hd-thumbnail">HD<\/var>/g,
  "",
).replace(/<var class="duration">12:34<\/var>\s*<var class="hd-thumbnail">HD<\/var>/, "");

const VIDEO_HTML = `
<html><head>
  <meta property="og:title" content="Morning coffee with my neighbour - Pornhub.com" />
  <meta property="og:description" content="A quiet morning at home." />
  <meta property="og:image" content="https://ei.phncdn.com/videos/202408/27/45678901/original/(m=qW8RZGa)(mh=abc)_1.jpg" />
  <meta property="video:duration" content="754" />
</head><body>
  <script>
    var flashvars_45678901 = {
      "video_duration": "12:34",
      "quality": [
        {"quality":"240","videoUrl":"https://ev.phncdn.com/v/240.mp4"},
        {"quality":"720","videoUrl":"https://ev.phncdn.com/v/720.mp4"},
        {"quality":"1080","videoUrl":"https://ev.phncdn.com/v/1080.mp4"}
      ]
    };
  </script>
</body></html>`;

describe("Pornhub search parsing", () => {
  it("reads every card on the page, keyed by viewkey", () => {
    const { cards } = parseSearchListing(SEARCH_HTML);
    expect(cards.map((card) => card.viewkey)).toEqual([
      "68a1b2c3d4e5f",
      "68b2c3d4e5f60",
      "68c3d4e5f6071",
      "68d4e5f607182",
    ]);

    const first = cards[0];
    expect(first.title).toBe("Morning coffee with my neighbour");
    expect(first.thumbnailUrl).toContain("ei.phncdn.com");
    expect(first.durationSeconds).toBe(754);
    expect(first.hd).toBe(true);
    expect(first.sourceUrl).toBe(
      "https://www.pornhub.com/view_video.php?viewkey=68a1b2c3d4e5f",
    );
  });

  it("merges the poster and title anchors of one card instead of duplicating it", () => {
    const { cards } = parseSearchListing(SEARCH_HTML);
    expect(cards.filter((card) => card.viewkey === "68a1b2c3d4e5f")).toHaveLength(1);
    // The second anchor of the same card carried no data attributes of its own.
    expect(cards[0].thumbnailUrl).toContain("(m=qW8RZGa)");
  });

  it("labels a page that marks some cards HD, and leaves the others unmarked", () => {
    const { cards, hdSignal } = parseSearchListing(SEARCH_HTML);
    // The page carries HD badges, so a card without one is a non-HD result and
    // the importer skips it. The parser reports the absence, not a verdict.
    expect(hdSignal).toBe(true);
    expect(cards[0].hd).toBe(true);
    expect(cards[1].hd).not.toBe(true);
    expect(cards[2].hd).not.toBe(true);
  });

  it("reports 'unknown' rather than 'not HD' when the page has no badge at all", () => {
    const { cards, hdSignal } = parseSearchListing(SEARCH_HTML_WITHOUT_BADGES);
    expect(hdSignal).toBe(false);
    expect(cards.every((card) => card.hd === null)).toBe(true);
  });

  it("never takes a poster from a third-party tracking host", () => {
    const { cards } = parseSearchListing(SEARCH_HTML);
    const tracked = cards.find((card) => card.viewkey === "68d4e5f607182");
    expect(tracked?.thumbnailUrl).toBeNull();
  });

  it("keeps a lazily-loaded poster and a <span class=duration> badge", () => {
    const { cards } = parseSearchListing(SEARCH_HTML);
    const lazy = cards.find((card) => card.viewkey === "68c3d4e5f6071");
    expect(lazy?.thumbnailUrl).toContain("ci.phncdn.com");
    expect(lazy?.durationSeconds).toBe(1270);
  });

  it("ignores navigation links that are not videos", () => {
    const { cards } = parseSearchListing(SEARCH_HTML);
    expect(cards.some((card) => card.title === "Navigation link")).toBe(false);
  });

  it("reads the last page number from the pagination block", () => {
    expect(parseSearchListing(SEARCH_HTML).totalPages).toBe(42);
    expect(parseSearchListing("<html><body>nothing</body></html>")).toEqual({
      cards: [],
      totalPages: null,
      hdSignal: false,
    });
  });
});

describe("Pornhub links", () => {
  it("builds the same search a visitor would type", () => {
    expect(searchUrl("18 year old")).toBe(
      "https://www.pornhub.com/video/search?search=18+year+old",
    );
    expect(searchUrl("amateur", 3)).toBe(
      "https://www.pornhub.com/video/search?search=amateur&page=3",
    );
  });

  it("builds the embed URL from the viewkey only", () => {
    expect(embedUrlFor("68a1b2c3d4e5f")).toBe("https://www.pornhub.com/embed/68a1b2c3d4e5f");
    expect(watchUrlFor("68a1b2c3d4e5f")).toBe(
      "https://www.pornhub.com/view_video.php?viewkey=68a1b2c3d4e5f",
    );
  });

  it("recognises a viewkey in every URL shape Pornhub uses", () => {
    expect(viewkeyFromUrl("https://www.pornhub.com/view_video.php?viewkey=68a1b2c3d4e5f")).toBe(
      "68a1b2c3d4e5f",
    );
    expect(viewkeyFromUrl("https://www.pornhub.com/embed/68a1b2c3d4e5f")).toBe("68a1b2c3d4e5f");
    expect(viewkeyFromUrl("/view_video.php?viewkey=68a1b2c3d4e5f&t=3")).toBe("68a1b2c3d4e5f");
    expect(viewkeyFromUrl("68a1b2c3d4e5f")).toBe("68a1b2c3d4e5f");
    expect(viewkeyFromUrl("https://www.pornhub.com/video/search?search=amateur")).toBeNull();
  });

  it("makes a unique, readable slug from the title and the viewkey", () => {
    expect(pornhubSlug("Morning coffee with my neighbour", "68A1B2C3D4E5F")).toBe(
      "morning-coffee-with-my-neighbour-68a1b2c3d4e5f",
    );
    expect(pornhubSlug("", "68a1b2c3d4e5f")).toBe("video-68a1b2c3d4e5f");
  });
});

describe("Pornhub durations and quality", () => {
  it("parses every duration shape the site publishes", () => {
    expect(parseDuration("12:34")).toBe(754);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("754")).toBe(754);
    expect(parseDuration("PT12M34S")).toBe(754);
    expect(parseDuration("nope")).toBeNull();
    expect(parseDuration("0:00")).toBeNull();
  });

  it("finds the tallest stream on a watch page", () => {
    expect(maxQualityHeight(VIDEO_HTML)).toBe(1080);
    expect(maxQualityHeight("<html>no player</html>")).toBeNull();
  });

  it("reads the title, poster, duration and description of a watch page", () => {
    const detail = parseVideoPage(VIDEO_HTML, "68a1b2c3d4e5f");
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("Morning coffee with my neighbour");
    expect(detail!.thumbnailUrl).toContain("ei.phncdn.com");
    expect(detail!.durationSeconds).toBe(754);
    expect(detail!.maxHeight).toBe(1080);
    expect(detail!.sourceUrl).toContain("viewkey=68a1b2c3d4e5f");
  });

  it("returns null for a page with no title at all", () => {
    expect(parseVideoPage("<html><body>blocked</body></html>", "68a1b2c3d4e5f")).toBeNull();
  });
});
