/**
 * Per-category catalog counts, shared by every provider surface.
 *
 * The admin video manager, the import panel and the system-health page all ask
 * the same question — "how much of this category can a visitor actually watch?"
 * — so the predicate lives in one place and cannot drift between them.
 */

/** The slice of the Supabase service client these counters use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ImportService = { from: (table: string) => any };

export type CategoryCount = {
  id: string;
  slug: string;
  label: string;
  /**
   * How many videos a visitor can watch in this category right now — the same
   * predicate the public category page counts with, so the admin figure and the
   * public figure are never two different numbers.
   */
  published: number;
  /**
   * Every row filed under the category for this provider, drafts included. This
   * is what the importer treats as already present, so it explains why a
   * category that looks empty on the site may still hold a review backlog.
   */
  total: number;
};

/** PostgREST pages at 1 000 rows; a larger catalog would otherwise be truncated. */
const CATALOG_PAGE = 1000;

/** The predicate the public catalog uses for a playable, published video. */
function playableFilter(query: Record<string, any>): Record<string, any> {
  return query
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .eq("requires_reupload", false)
    .or("playable_url.not.is.null,embed_url.not.is.null");
}

/**
 * Counts one category's rows — for every provider.
 *
 * The count used to be taken by selecting every row and tallying them in
 * JavaScript. PostgREST serves at most `CATALOG_PAGE` rows per request, so once
 * the catalog grew past a thousand videos every category was silently
 * under-counted — and a category that happened to fall outside the first page
 * read as 0 even though it was full. Asking Postgres for an exact count has no
 * page to fall off, and it transfers a number instead of thousands of rows.
 */
async function countCategoryVideos(
  service: ImportService,
  categoryId: string,
  liveOnly: boolean,
): Promise<number> {
  // No provider filter on purpose: the number the operator sees must be the
  // number a visitor sees, whatever source a row came from.
  const filters = (query: Record<string, any>) => {
    const scoped = query.eq("category_id", categoryId);
    return liveOnly ? playableFilter(scoped) : scoped;
  };

  try {
    const { count, error } = await filters(
      service.from("videos").select("id", { count: "exact", head: true }),
    );
    if (!error && typeof count === "number") return count;
  } catch {
    /* Fall through to the paged read below. */
  }

  // Clients that do not answer with a count still get an exact total, just the
  // slower way: every page, then stop at the first short one.
  let total = 0;
  let from = 0;
  for (;;) {
    let query = filters(service.from("videos").select("id"));
    if (typeof query.range === "function") query = query.range(from, from + CATALOG_PAGE - 1);
    const { data, error } = await query;
    if (error) throw new Error(error.message || "Unable to count the catalog");
    const batch = (data || []) as unknown[];
    total += batch.length;
    if (batch.length < CATALOG_PAGE) break;
    from += CATALOG_PAGE;
  }
  return total;
}

/** Exact per-category counts for the admin panel and the health page. */
export async function categoryCounts(service: ImportService): Promise<CategoryCount[]> {
  const { data: categories, error } = await service
    .from("categories")
    .select("id, label, slug")
    .order("label");
  if (error) throw new Error(error.message || "Unable to read categories");

  const rows = (categories as Array<Record<string, unknown>> | null) || [];
  // Every count is requested at once: twenty-four exact counts in parallel cost
  // less wall time than one page of rows did before.
  return Promise.all(
    rows.map(async (category) => {
      const id = String(category.id);
      const [published, total] = await Promise.all([
        countCategoryVideos(service, id, true),
        countCategoryVideos(service, id, false),
      ]);
      return {
        id,
        slug: String(category.slug),
        label: String(category.label),
        // Published rows are a subset of all rows; guard the display if a
        // hand-edited row ever breaks that.
        published: Math.min(published, total),
        total,
      };
    }),
  );
}
