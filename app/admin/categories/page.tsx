import { createServiceClient } from "@/lib/supabase/server";
import CategoryManager from "./CategoryManager";

export default async function CategoriesAdmin() {
  const supabase = createServiceClient();
  const { data: categories } = await supabase.from("categories").select("*").order("label");

  return <CategoryManager initialCategories={(categories || []) as any[]} />;
}
