/**
 * How each fixed erobabe category is searched on Pornhub.
 *
 * The operator selects a category in `/admin/videos`; the importer types that
 * category's name into Pornhub's own search box and pages through the results,
 * so the catalog follows what the site itself considers to be that category
 * rather than a hand-maintained list of ids that goes stale.
 *
 * `searches` are tried in order. The first entry is always the plain category
 * name; later entries are narrower phrases used when the first search runs out
 * of new (not yet imported) results. The `18+` entry names Pornhub's own
 * "18 Year Old" taxonomy, which is the only age-related label this catalog uses.
 */
export type PornhubCategorySource = {
  /** erobabe fixed category slug */
  slug: string;
  /** The words the importer types into Pornhub's search box. */
  searches: string[];
};

export const PORNHUB_CATEGORY_SOURCES: PornhubCategorySource[] = [
  { slug: "amateur", searches: ["amateur", "homemade amateur"] },
  { slug: "lesbian", searches: ["lesbian", "lesbian amateur"] },
  { slug: "milf", searches: ["milf", "milf amateur"] },
  { slug: "japanese", searches: ["japanese", "japanese amateur"] },
  { slug: "teen-18plus", searches: ["18 year old", "18 year old amateur"] },
  { slug: "hentai", searches: ["hentai", "hentai anime"] },
  { slug: "ebony", searches: ["ebony", "ebony amateur"] },
  { slug: "pov", searches: ["pov", "pov amateur"] },
  { slug: "big-ass", searches: ["big ass", "big ass amateur"] },
  { slug: "threesome", searches: ["threesome", "threesome amateur"] },
  { slug: "hardcore", searches: ["hardcore", "hardcore amateur"] },
  { slug: "massage", searches: ["massage", "massage amateur"] },
];

export function categorySource(slug: string): PornhubCategorySource | null {
  return PORNHUB_CATEGORY_SOURCES.find((entry) => entry.slug === slug) ?? null;
}

/** Every configured category slug, in panel order. */
export function configuredCategorySlugs(): string[] {
  return PORNHUB_CATEGORY_SOURCES.map((entry) => entry.slug);
}

/** What the admin panel prints under a category. */
export function describeSources(slug: string): string {
  const entry = categorySource(slug);
  if (!entry) return "no source configured";
  return entry.searches.map((value) => `search “${value}”`).join(", then ");
}
