import { DAMPLIPS_BASE_URL } from "./parse";

/**
 * How each fixed erobabe category is sourced from damplips.
 *
 * `categorySlugs` are damplips taxonomy slugs (their `/c/<slug>/` pages), given
 * in preference order. `searchTerms` are the fallback: when none of the
 * taxonomy slugs exists (or a slug exists but has fewer posts than we need),
 * the importer pages through damplips search results instead. Nothing here is
 * assumed to exist — the importer verifies every source against live HTML and
 * reports categories that could not be filled.
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
    categorySlugs: ["amateur-porn", "amateur"],
    searchTerms: ["amateur", "homemade"],
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

/**
 * Ordered list of URLs to try for one category, most specific first.
 *
 * Taxonomy pages are preferred because their listings are dense and stable;
 * the search pages are appended as a top-up so a category never silently
 * under-delivers just because damplips renamed a slug.
 */
export function sourcePlan(
  slug: string,
  baseUrl: string = DAMPLIPS_BASE_URL,
): string[] {
  const entry = categorySource(slug);
  if (!entry) return [];
  const base = baseUrl.replace(/\/$/, "");
  return [
    ...entry.categorySlugs.map((candidate) => `${base}/c/${candidate}/`),
    ...entry.searchTerms.map((term) => `${base}/?s=${encodeURIComponent(term)}`),
  ];
}

/** damplips taxonomy slug → erobabe category slug, for admin reporting. */
export function describeSources(slug: string): string {
  const entry = categorySource(slug);
  if (!entry) return "no source";
  return [...entry.categorySlugs.map((value) => `/c/${value}/`), ...entry.searchTerms.map((value) => `search "${value}"`)].join(", ");
}
