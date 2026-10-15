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
- OpenRouter/DeepSeek suggestions use factual non-graphic wording, 4–9-word titles, 20–25-word descriptions, and near-duplicate checks against supplied/recent titles. Suggestions still require human review. No historic metadata was rewritten. Tags describe content; no ranking claim is attached to meta keywords. AI is not called by sitemap requests.

## Required production verification

1. Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin. Configure the hosting/CDN layer to redirect HTTP and alternate domains to that origin with 301/308 redirects. HSTS is not a substitute for this redirect.
2. Configure the existing Supabase service credentials, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `OPENROUTER_API_KEY` server-side. The default model is `deepseek/deepseek-v3.2`. Never expose provider keys to the browser.
3. Test Bunny deletion using a disposable uploaded video, including bulk partial failures. External provider calls were mocked locally; no production media was deleted during development.
4. Submit `/sitemap.xml` and `/video-sitemap.xml` in Google Search Console. Watch Page Indexing and Video Indexing reports, removals, crawl errors, and sitemap fetch failures. Check representative URLs using URL Inspection.
5. Validate watch-page VideoObject markup and verify stable, crawlable thumbnails and video bytes at Bunny/CDN. Explicit-content metadata and `video:family_friendly=no` are intentionally retained. Do not bypass age checks using an unverified User-Agent string. Age-gate/CDN behavior for verified Googlebot needs production inspection.
6. Use PageSpeed Insights/CrUX and Search Console Core Web Vitals on real mobile traffic. This change prioritizes the initial hero image and lazily loads others; it is not a measured claim of passing CWV. Existing raw-image lint warnings remain.
7. Review each generated title/description against the actual video and rights/consent records. Recent-title checks are not a database-wide uniqueness guarantee, and simultaneous generation can still collide. Generic fallback drafts require editorial replacement, not automatic mass publication.
8. Keep public route lists/sitemaps aligned, omit thin/empty collections from sitemap inventory, add redirects when slugs change, and regularly crawl for broken internal links. These remain ongoing editorial/operational tasks.

## Research references

- https://developers.google.com/search/docs/specialty/explicit/guidelines
- https://developers.google.com/search/docs/appearance/title-link
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps
- https://developers.google.com/search/docs/appearance/structured-data/video

Google recommends accurate, concise, distinct titles and relevant descriptions, not keyword stuffing or fabricated stories. Search titles/snippets may be rewritten, structured data does not guarantee rich results, and neither AI nor technical SEO can guarantee a first-place ranking.
