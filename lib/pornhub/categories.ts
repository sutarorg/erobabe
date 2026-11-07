/**
 * How each fixed erobabe category is searched on Pornhub.
 *
 * The operator selects a category in `/admin/videos`; the importer types that
 * category's name into Pornhub's own search box and pages through the results,
 * so the catalog follows what the site itself considers to be that category
 * rather than a hand-maintained list of ids that goes stale.
 *
 * ## Popular videos come first
 *
 * A fresh catalog that fills itself with whatever Pornhub happens to list first
 * looks like a random dump. So every phrase is walked through Pornhub's own
 * "Sort by" orders, and the whole **most viewed** pass runs before the others:
 *
 *   1. `mv` — most viewed   (the popular videos of this category)
 *   2. `tr` — top rated
 *   3. `cm` — most commented
 *   4. ``   — the site's own relevance order
 *
 * Only after all four passes have been walked does the panel start another round.
 *
 * ## Why more than one phrase
 *
 * `searches` are tried in order. The first entry is always the plain category
 * name; later entries are narrower phrases that keep producing new (not yet
 * imported) videos once the first search is used up. The `18+` entry names
 * Pornhub's own "18 Year Old" taxonomy, which is the only age-related label this
 * catalog uses.
 */
export type PornhubCategorySource = {
  /** erobabe fixed category slug */
  slug: string;
  /** The words the importer types into Pornhub's search box. */
  searches: string[];
};

/** One search the importer performs: a phrase, in one of Pornhub's sort orders. */
export type PornhubSearchUnit = {
  phrase: string;
  /** Pornhub `o=` value: `mv`, `tr`, `cm`, or empty for its relevance order. */
  order: string;
  /** What the order means, for the admin panel. */
  orderLabel: string;
};

/**
 * Pornhub's sort orders, most popular first. The empty string is the search
 * box's own default order and is always walked last.
 */
export const PORNHUB_SEARCH_ORDERS: Array<{ order: string; label: string }> = [
  { order: "mv", label: "most viewed" },
  { order: "tr", label: "top rated" },
  { order: "cm", label: "most commented" },
  { order: "", label: "relevance" },
];

export const PORNHUB_CATEGORY_SOURCES: PornhubCategorySource[] = [
  {
    slug: "amateur",
    searches: ["amateur", "amateur homemade", "amateur couple", "amateur real"],
  },
  {
    slug: "lesbian",
    searches: ["lesbian", "lesbian amateur", "lesbian kissing", "lesbian couple"],
  },
  { slug: "milf", searches: ["milf", "milf amateur", "milf mature", "milf couple"] },
  {
    slug: "japanese",
    searches: ["japanese", "japanese amateur", "japanese uncensored", "asian japanese"],
  },
  {
    slug: "teen-18plus",
    searches: ["18 year old", "18 year old amateur", "18 year old couple", "teen 18"],
  },
  { slug: "hentai", searches: ["hentai", "hentai anime", "hentai english subbed", "3d hentai"] },
  { slug: "ebony", searches: ["ebony", "ebony amateur", "ebony couple", "black ebony"] },
  { slug: "pov", searches: ["pov", "pov amateur", "pov blowjob", "pov girlfriend"] },
  { slug: "big-ass", searches: ["big ass", "big ass amateur", "big ass milf", "big booty"] },
  {
    slug: "threesome",
    searches: ["threesome", "threesome amateur", "threesome ffm", "threesome mmf"],
  },
  {
    slug: "hardcore",
    searches: ["hardcore", "hardcore amateur", "hardcore couple", "hardcore fucking"],
  },
  { slug: "massage", searches: ["massage", "massage amateur", "massage oil", "massage parlor"] },
];

export function categorySource(slug: string): PornhubCategorySource | null {
  return PORNHUB_CATEGORY_SOURCES.find((entry) => entry.slug === slug) ?? null;
}

/**
 * Every search one category performs, in the order a run walks them.
 *
 * The outer loop is the **sort order**, so a fresh run fills the catalog with
 * the most-viewed videos of every phrase before it ever asks for a less popular
 * ordering. The inner loop is the phrase list, plain category name first.
 */
export function searchPlan(slug: string): PornhubSearchUnit[] {
  const entry = categorySource(slug);
  if (!entry) return [];
  const plan: PornhubSearchUnit[] = [];
  for (const { order, label } of PORNHUB_SEARCH_ORDERS) {
    for (const phrase of entry.searches) {
      plan.push({ phrase, order, orderLabel: label });
    }
  }
  return plan;
}

/** Every configured category slug, in panel order. */
export function configuredCategorySlugs(): string[] {
  return PORNHUB_CATEGORY_SOURCES.map((entry) => entry.slug);
}

/** What the admin panel prints under a category. */
export function describeSources(slug: string): string {
  const entry = categorySource(slug);
  if (!entry) return "no source configured";
  const phrases = entry.searches.map((value) => `“${value}”`).join(", ");
  const orders = PORNHUB_SEARCH_ORDERS.map((value) => value.label).join(" → ");
  return `searches ${phrases}, most viewed first (${orders})`;
}
