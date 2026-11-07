import { DAMPLIPS_BASE_URL } from "./parse";

/**
 * How each fixed erobabe category is sourced from damplips.
 *
 * ## The order a category is walked in
 *
 * 1. **Popular feeds.** damplips' own aggregate listings are tried first, so the
 *    catalog starts with what the site itself considers popular rather than with
 *    whatever its archive happens to show first. The candidate paths are probed
 *    once per category; a path the site does not serve is skipped quietly (it
 *    costs one request, never an error in the report). Update
 *    `DAMPLIPS_POPULAR_PATHS` if damplips renames its popular section.
 * 2. **Taxonomy.** The category's own `/c/<slug>/` page, paged through, is the
 *    exact set of posts damplips files under that category.
 * 3. **Search.** The same words a visitor would type into damplips' search bar
 *    (`/?s=amateur`). It is the fallback that keeps a run going when a taxonomy
 *    slug is renamed or exhausted.
 *
 * Within a listing the importer follows damplips' own order; a post is imported
 * once, so re-walking a listing after the site publishes something only adds the
 * new post.
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
  kind: "popular" | "taxonomy" | "search";
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

  for (const path of DAMPLIPS_POPULAR_PATHS) {
    plan.push({
      kind: "popular",
      url: `${base}${path}`,
      label: `popular: ${path.replace(/\//g, "")}`,
      quiet: true,
    });
  }
  for (const taxonomy of entry.categorySlugs) {
    plan.push({
      kind: "taxonomy",
      url: categoryUrl(taxonomy, base),
      label: `category: ${taxonomy}`,
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
  return plan;
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
