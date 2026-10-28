import { DAMPLIPS_BASE_URL } from "./parse";

/**
 * How each fixed erobabe category is sourced from damplips.
 *
 * The operator types the same words into damplips' search bar (`/?s=amateur`
 * for Amateur). `searchTerms` are those queries, most specific first. Taxonomy
 * `/c/<slug>/` paths are kept only as a documented mapping — the importer
 * pages search results so a renamed category page cannot starve a run.
 */
export type DamplipsCategorySource = {
  /** erobabe fixed category slug */
  slug: string;
  /** damplips `/c/<slug>/` candidates, most specific first */
  categorySlugs: string[];
  /** damplips search terms used when the taxonomy cannot fill the quota */
  searchTerms: string[];
};

export const DAMPLIPS_CATEGORY_SOURCES: DamplipsCategorySource[] = [
  {
    slug: "amateur",
    categorySlugs: ["amateur-porn", "amateur", "amateur-sex", "homemade"],
    searchTerms: ["amateur", "homemade", "amateur porn"],
  },
  {
    slug: "lesbian",
    categorySlugs: ["lesbian", "lesbians", "girl-girl"],
    searchTerms: ["lesbian"],
  },
  {
    slug: "milf",
    categorySlugs: ["milf", "mature", "milfs"],
    searchTerms: ["milf"],
  },
  {
    slug: "japanese",
    categorySlugs: ["japanese", "asian", "japanese-porn"],
    searchTerms: ["japanese", "asian"],
  },
  {
    slug: "teen-18plus",
    categorySlugs: ["teen-sex", "teen", "teen-porn"],
    searchTerms: ["teen"],
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
    searchTerms: ["pov"],
  },
  {
    slug: "big-ass",
    categorySlugs: ["big-ass", "big-asses", "big-butt", "ass"],
    searchTerms: ["big ass", "big booty"],
  },
  {
    slug: "threesome",
    categorySlugs: ["threesome", "threesomes", "3some", "group-sex"],
    searchTerms: ["threesome"],
  },
  {
    slug: "hardcore",
    categorySlugs: ["hardcore"],
    searchTerms: ["hardcore"],
  },
  {
    slug: "massage",
    categorySlugs: ["massage", "massage-porn"],
    searchTerms: ["massage"],
  },
];

export function categorySource(slug: string): DamplipsCategorySource | null {
  return DAMPLIPS_CATEGORY_SOURCES.find((entry) => entry.slug === slug) ?? null;
}

/** damplips search-bar URL for one query (`/?s=amateur`). */
export function searchUrl(term: string, baseUrl: string = DAMPLIPS_BASE_URL): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/?s=${encodeURIComponent(term)}`;
}

/**
 * Ordered search URLs for one erobabe category — the same queries a visitor
 * would type into damplips' search bar, most specific first.
 */
export function sourcePlan(
  slug: string,
  baseUrl: string = DAMPLIPS_BASE_URL,
): string[] {
  const entry = categorySource(slug);
  if (!entry) return [];
  return entry.searchTerms.map((term) => searchUrl(term, baseUrl));
}

/** damplips search queries used for this erobabe category. */
export function describeSources(slug: string): string {
  const entry = categorySource(slug);
  if (!entry) return "no source";
  return entry.searchTerms.map((value) => `search "${value}"`).join(", ");
}
