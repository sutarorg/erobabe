import { DAMPLIPS_BASE_URL } from "./parse";

/**
 * How each fixed erobabe category is sourced from damplips.
 *
 * ## The order a category is walked in
 *
 * 1. **Taxonomy.** The category's own `/c/<slug>/` pages, paged through, are the
 *    exact set of posts damplips files under that category. They come first so a
 *    round of 100 actually fills the category the operator selected instead of
 *    being spent entirely on the site's front page.
 * 2. **Popular feeds.** damplips' own aggregate listings (`/most-popular/`,
 *    `/popular/`), so popular videos are imported before search results and
 *    before the site's archive. The candidate paths are probed once per
 *    category; a path the site does not serve is skipped quietly (it costs one
 *    request, never an error in the report). Update `DAMPLIPS_POPULAR_PATHS` if
 *    damplips renames its popular section.
 * 3. **Search.** The same words a visitor would type into damplips' search bar
 *    (`/?s=amateur`). It is the fallback that keeps a run going when a taxonomy
 *    slug is renamed or exhausted.
 * 4. **Latest feeds.** The site's own newest-video archives. They are the depth
 *    behind a round of 100: a run that has already walked every popular page of
 *    a category still finds unseen posts here, and those are imported too.
 *
 * Within a listing the importer follows damplips' own order; a post is imported
 * once, so re-walking a listing after the site publishes something only adds the
 * new post.
 *
 * ## Posts that are not from this category
 *
 * A popular feed, a search result or a related-video link is not a promise that
 * the post belongs to the erobabe category it was found through. Those videos
 * are still imported — the catalog wants them — but they are stored with **no
 * category** instead of being filed under a category they are not part of, so
 * nothing is mislabelled on the site. `matchesCategory` decides.
 */
export type DamplipsCategorySource = {
  /** erobabe fixed category slug */
  slug: string;
  /** damplips `/c/<slug>/` candidates, most specific first */
  categorySlugs: string[];
  /** damplips search terms, used once the taxonomy is exhausted */
  searchTerms: string[];
};

/**
 * damplips' popular listings, in order, relative to the site root.
 *
 * These are real page paths on the site's WordPress theme; a path that returns
 * no cards is reported as "not served" and the plan moves on, so listing a path
 * the site does not have costs nothing but a request.
 */
export const DAMPLIPS_POPULAR_PATHS = ["/most-popular/", "/popular/"];

/**
 * damplips' newest-video archives, walked after a category's own pages.
 *
 * They are a firehose rather than a category: a post found here that does not
 * belong to the selected category is imported with no category (see
 * `matchesCategory`), which is what keeps every round producing 100 new videos
 * once the category's own listings have been used up.
 */
export const DAMPLIPS_LATEST_PATHS = ["/latest-updates/", "/new/", "/videos/"];

export const DAMPLIPS_CATEGORY_SOURCES: DamplipsCategorySource[] = [
  {
    slug: "amateur",
    categorySlugs: ["amateur-porn", "amateur", "amateur-sex", "homemade"],
    searchTerms: ["amateur", "homemade", "amateur porn"],
  },
  {
    slug: "lesbian",
    categorySlugs: ["lesbian", "lesbians", "girl-girl"],
    searchTerms: ["lesbian", "lesbian porn"],
  },
  {
    slug: "milf",
    categorySlugs: ["milf", "mature", "milfs"],
    searchTerms: ["milf", "mature milf"],
  },
  {
    slug: "japanese",
    categorySlugs: ["japanese", "asian", "japanese-porn"],
    searchTerms: ["japanese", "asian"],
  },
  {
    slug: "teen-18plus",
    categorySlugs: ["teen-sex", "teen", "teen-porn"],
    searchTerms: ["teen", "teen sex"],
  },
  {
    slug: "hentai",
    categorySlugs: ["hentai", "cartoon", "anime"],
    searchTerms: ["hentai", "anime", "cartoon"],
  },
  {
    slug: "ebony",
    categorySlugs: ["ebony", "black", "black-girls"],
    searchTerms: ["ebony", "black"],
  },
  {
    slug: "pov",
    categorySlugs: ["pov", "point-of-view"],
    searchTerms: ["pov", "point of view"],
  },
  {
    slug: "big-ass",
    categorySlugs: ["big-ass", "big-asses", "big-butt", "ass"],
    searchTerms: ["big ass", "big booty"],
  },
  {
    slug: "threesome",
    categorySlugs: ["threesome", "threesomes", "3some", "group-sex"],
    searchTerms: ["threesome", "3some"],
  },
  {
    slug: "hardcore",
    categorySlugs: ["hardcore", "hardcore-porn"],
    searchTerms: ["hardcore"],
  },
  {
    slug: "massage",
    categorySlugs: ["massage", "massage-porn"],
    searchTerms: ["massage", "massage porn"],
  },
];

/** One listing the importer walks: a popular feed, a taxonomy page or a search. */
export type DamplipsSource = {
  kind: "popular" | "taxonomy" | "search" | "latest";
  url: string;
  /** What the admin panel prints, and what a report names. */
  label: string;
  /**
   * True when the site may simply not serve this listing. A quiet source that
   * returns nothing is skipped without an error in the report.
   */
  quiet: boolean;
};

export function categorySource(slug: string): DamplipsCategorySource | null {
  return DAMPLIPS_CATEGORY_SOURCES.find((entry) => entry.slug === slug) ?? null;
}

/** damplips search-bar URL for one query (`/?s=amateur`). */
export function searchUrl(term: string, baseUrl: string = DAMPLIPS_BASE_URL): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/?s=${encodeURIComponent(term)}`;
}

/** damplips taxonomy URL for one slug (`/c/amateur/`). */
export function categoryUrl(slug: string, baseUrl: string = DAMPLIPS_BASE_URL): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/c/${encodeURIComponent(slug)}/`;
}

/**
 * Everything one category is walked through, in order: the popular feeds, then
 * every taxonomy candidate, then the search terms.
 */
export function sourcePlan(
  slug: string,
  baseUrl: string = DAMPLIPS_BASE_URL,
): DamplipsSource[] {
  const entry = categorySource(slug);
  if (!entry) return [];
  const base = baseUrl.replace(/\/$/, "");
  const plan: DamplipsSource[] = [];

  for (const taxonomy of entry.categorySlugs) {
    plan.push({
      kind: "taxonomy",
      url: categoryUrl(taxonomy, base),
      label: `category: ${taxonomy}`,
      quiet: true,
    });
  }
  for (const path of DAMPLIPS_POPULAR_PATHS) {
    plan.push({
      kind: "popular",
      url: `${base}${path}`,
      label: `popular: ${path.replace(/\//g, "")}`,
      quiet: true,
    });
  }
  for (const term of entry.searchTerms) {
    plan.push({
      kind: "search",
      url: searchUrl(term, base),
      label: `search: ${term}`,
      quiet: false,
    });
  }
  for (const path of DAMPLIPS_LATEST_PATHS) {
    plan.push({
      kind: "latest",
      url: `${base}${path}`,
      label: `latest: ${path.replace(/\//g, "")}`,
      quiet: true,
    });
  }
  return plan;
}

/**
 * Words that prove nothing about a video's subject once they appear in a title.
 * Matching on them would file every clip under every category.
 */
const MATCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "her",
  "his",
  "she",
  "him",
  "from",
  "that",
  "this",
  "porn",
  "sex",
  "video",
  "videos",
  "clip",
  "clips",
  "hd",
  "porn",
  "movie",
  "movies",
  "scene",
  "scenes",
  "full",
  "new",
]);

/** Lower-case subject words of a value, minus the noise. */
export function matchWords(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !MATCH_STOPWORDS.has(word));
}

/**
 * True when a post belongs to one erobabe category.
 *
 * Two independent claims count:
 *
 *  1. **The post's own taxonomy.** damplips files a post under
 *     `/c/<slug>/`, which is the strongest signal there is: if one of those
 *     slugs is a configured candidate for the category, the post is in it.
 *  2. **Its subject words.** Search results and related-video links come with no
 *     taxonomy at all, so the post's title and tags are matched against the
 *     category's own words (`milf`, `mature`, `3some`, …).
 *
 * A post that matches neither is still imported, just with no category — see
 * `DamplipsImportOptions.categorySlug` handling in the importer.
 */
export function matchesCategory(
  slug: string,
  signals: { title?: string | null; categorySlugs?: string[] | null; tags?: string[] | null },
): boolean {
  const entry = categorySource(slug);
  if (!entry) return false;

  const postSlugs = new Set(
    (signals.categorySlugs || []).map((value) => String(value).toLowerCase()),
  );
  for (const candidate of entry.categorySlugs) {
    if (postSlugs.has(candidate.toLowerCase())) return true;
  }

  const subject = new Set<string>();
  for (const word of matchWords(signals.title || "")) subject.add(word);
  for (const tag of signals.tags || []) for (const word of matchWords(tag)) subject.add(word);
  for (const value of postSlugs) for (const word of matchWords(value)) subject.add(word);

  for (const candidate of [...entry.categorySlugs, ...entry.searchTerms]) {
    for (const word of matchWords(candidate)) {
      if (subject.has(word)) return true;
    }
  }
  return false;
}

/** Every configured category slug, in panel order. */
export function configuredCategorySlugs(): string[] {
  return DAMPLIPS_CATEGORY_SOURCES.map((entry) => entry.slug);
}

/** damplips search queries and listings used for this erobabe category. */
export function describeSources(slug: string): string {
  const entry = categorySource(slug);
  if (!entry) return "no source";
  const popular = DAMPLIPS_POPULAR_PATHS.map((path) => `popular (${path})`).join(", ");
  const taxonomy = entry.categorySlugs.map((value) => `/c/${value}/`).join(", ");
  const searches = entry.searchTerms.map((value) => `search "${value}"`).join(", ");
  return `${popular}, then ${taxonomy}, then ${searches}`;
}
