/**
 * Search and preview crawlers that must see public HTML without the age gate.
 *
 * Google's explicit-content guidelines say letting Googlebot past an age
 * interstitial is not cloaking: humans still confirm age, crawlers index the
 * same document. The overlay is client-only; this list is used on the server
 * so the first HTML response is already ungated.
 *
 * @see https://developers.google.com/search/docs/specialty/explicit/guidelines
 */
const CRAWLER_UA =
  /Googlebot|Google-InspectionTool|Storebot-Google|GoogleOther|bingbot|BingPreview|Slurp|DuckDuckBot|Baiduspider|YandexBot|YandexImages|facebookexternalhit|Twitterbot|LinkedInBot|Applebot|GPTBot|ClaudeBot|Bytespider/i;

export function isSearchCrawler(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && CRAWLER_UA.test(userAgent));
}
