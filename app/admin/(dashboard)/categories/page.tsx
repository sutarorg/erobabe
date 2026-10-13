import { createServiceClient } from "@/lib/supabase/server";
import CategoryManager, { type Category } from "./CategoryManager";

/**
 * Columns the admin table needs. `image_url` arrives with migration 09; when a
 * deployment runs ahead of the migration the select falls back to the original
 * column list so the page keeps working (thumbnails simply read as unset).
 */
const CATEGORY_COLUMNS = "id, label, slug, icon, description, image_url, video_count";
const LEGACY_CATEGORY_COLUMNS = "id, label, slug, icon, description, video_count";

function mapCategory(row: Record<string, any>): Category {
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    slug: String(row.slug ?? ""),
    icon: row.icon ? String(row.icon) : null,
    description: row.description ? String(row.description) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    video_count: Number(row.video_count ?? 0),
  };
}

export default async function CategoriesAdmin() {
  const supabase = createServiceClient();
  const select = (columns: string) => supabase.from("categories").select(columns).order("label");

  const { data, error } = await select(CATEGORY_COLUMNS);
  const rows = error ? (await select(LEGACY_CATEGORY_COLUMNS)).data : data;

  return <CategoryManager initialCategories={(rows || []).map(mapCategory)} />;
}
