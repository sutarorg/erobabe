# SEO deployment and monitoring

## Implemented in this change

- Mobile hero arrows use viewport breakpoints (no container-query override); swipe and dots remain.
- Mobile account/menu controls hide during search; desktop controls remain available.
- Likes are stored immediately per video in localStorage, including when community sync fails. Clearing site data or blocking storage prevents persistence. Likes are device/browser-specific, not cross-device account preferences.
- Admin single/bulk deletion calls Bunny Stream before deleting its catalog row. Missing remote media (404) is idempotent success. Provider failures retain the row. If the database write fails after Bunny succeeds, retry the deletion; the remote 404 will allow catalog cleanup. This cannot be an atomic transaction across Bunny and Supabase.
- `/sitemap.xml` is rendered dynamically. Video queries are paginated in batches of 1,000 instead of relying on a 5,000-row limit (which Supabase can itself truncate). Both sitemaps currently have a 45,000-video safety ceiling; introduce sitemap-index sharding before reaching it. Static route entries are maintained explicitly when adding/removing public routes.
- The video sitemap uses the actual validated player/media URL, not the watch-page URL as a player URL. Missing-thumbnail and unplayable entries are omitted.
- Listing metadata, legal-page metadata, social previews, a global 404, auth noindex metadata, private URL noindex HTTP headers and production HSTS have been added. Empty category pages are noindex.
- VideoObject uses validated playback URLs, no invented publication timestamp, and script-safe JSON serialization.
- OpenRouter/DeepSeek upload suggestions are generated from the administrator-selected category only; filenames, default titles, and existing tags are intentionally excluded from the model prompt. Titles are written in the site's publishing voice — `VIDEO_TITLE_STYLE=explicit` by default, which means blunt adult copy that names the act and the body parts (fuck, cock, dick, pussy, ass, blowjob, creampie), because that is what this catalog is and what its searches use. A randomized direction varies the sentence shape, while per-voice checks keep output constrained: the explicit voice requires a 6–16-word title (35–150 characters) containing the selected category word and at least one sexual term, and rejects euphemistic magazine wording; the `editorial` voice keeps the older 4–9-word non-graphic headline. Both voices check descriptions at exactly 20–25 words and run the same non-negotiable compliance floor (no age-ambiguous wording, no family-role framing, nothing implying a partner who cannot consent, no age claims). When the model is unconfigured, out of credits or declines adults-only copy, `lib/metadata/explicit-titles.ts` composes a title and description in the same voice offline, so a listing never publishes a filename and never silently reverts to programme-note wording. The admin API compares suggestions with catalog titles (paged up to 50,000), caches that index briefly, and serializes/reserves titles per server instance; the upload queue drafts copy as soon as a category is known (before Start) and also serializes in-batch generation. These are editorial safeguards, not a guarantee against collisions across separate serverless instances. Suggestions and offline drafts should be reviewed against the actual video; the upload flow can auto-publish after encoding, so preview/edit is recommended before starting. No historic metadata was rewritten, and AI is not called by sitemap requests.
- The title/description word budgets are product requirements, not Google ranking formulas. Google can rewrite title links and snippets; a category-only prompt cannot research search volume, confirm scene facts, or guarantee a first-place ranking. Review copy for accuracy and monitor impressions, clicks, title rewrites, and video indexing in Search Console.

## Required production verification

1. Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin. Configure the hosting/CDN layer to redirect HTTP and alternate domains to that origin with 301/308 redirects. HSTS is not a substitute for this redirect.
2. Configure the existing Supabase service credentials, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `OPENROUTER_API_KEY` server-side. The default model is `deepseek/deepseek-v3.2`. Never expose provider keys to the browser.
3. Test Bunny deletion using a disposable uploaded video, including bulk partial failures. External provider calls were mocked locally; no production media was deleted during development.
4. Submit `/sitemap.xml` and `/video-sitemap.xml` in Google Search Console. Watch Page Indexing and Video Indexing reports, removals, crawl errors, and sitemap fetch failures. Check representative URLs using URL Inspection.
5. Validate watch-page VideoObject markup and verify stable, crawlable thumbnails and video bytes at Bunny/CDN. Explicit-content metadata and `video:family_friendly=no` are intentionally retained. Do not bypass age checks using an unverified User-Agent string. Age-gate/CDN behavior for verified Googlebot needs production inspection.
6. Use PageSpeed Insights/CrUX and Search Console Core Web Vitals on real mobile traffic. This change prioritizes the initial hero image and lazily loads others; it is not a measured claim of passing CWV. Existing raw-image lint warnings remain.
7. Review each generated title/description against the actual video and rights/consent records. Generation intentionally receives only the selected category, so it cannot substantiate scene-specific claims. The API scans catalog titles and the upload queue avoids concurrent in-batch duplicates, but separate administrators generating simultaneously can still collide. Category-only fallback drafts are editorial starting points, not verified descriptions.
8. Keep public route lists/sitemaps aligned, omit thin/empty collections from sitemap inventory, add redirects when slugs change, and regularly crawl for broken internal links. These remain ongoing editorial/operational tasks.

## Research references

- https://developers.google.com/search/docs/specialty/explicit/guidelines
- https://developers.google.com/search/docs/appearance/title-link
- https://developers.google.com/search/docs/appearance/snippet
- https://developers.google.com/search/docs/appearance/video
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps
- https://developers.google.com/search/docs/appearance/structured-data/video
- https://developers.google.com/search/docs/essentials/spam-policies#scaled-content

Google's current guidance emphasizes accurate, concise, distinct title links and page-specific descriptions, while noting that snippets are selected from page content and title links can be rewritten. For video features, unique watch-page metadata is only one part of eligibility: the watch page must be indexed and perform well, the video must be prominent, and thumbnails/media must be crawlable and stable. Explicit-content sites should follow Google's SafeSearch labeling and crawling guidance. The per-voice title budgets (6–16 explicit words, 4–9 editorial) and the 20–25-word description limit are local editorial constraints—not Google ranking formulas. Keyword stuffing, fabricated plot details, mass-produced near-identical pages, and ranking guarantees are not SEO strategies.
