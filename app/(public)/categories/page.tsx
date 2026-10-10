import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Categories",
  alternates: { canonical: `${SITE_URL}/categories` },
};

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase.from("categories").select("*").order("label");

  // Count videos per category
  const { data: counts } = await supabase
    .from("videos")
    .select("category_id")
    .eq("status", "published")
    .eq("visibility", "public");

  const countMap = new Map<string, number>();
  (counts || []).forEach((v: any) => {
    if (v.category_id) countMap.set(v.category_id, (countMap.get(v.category_id) || 0) + 1);
  });

  return (
    <div className="pt-4">
      <h1 className="text-[22px] font-semibold tracking-tight">Categories</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Browse all genres</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {(categories || []).map((cat: any) => {
          const count = countMap.get(cat.id) || 0;
          return (
            <Link
              key={cat.id}
              href={`/category/${cat.slug}`}
              className="group flex h-[92px] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-card transition-colors hover:border-accent/45 hover:bg-card-hover"
            >
              <span className="text-[13px] font-medium text-ink group-hover:text-accent">{cat.label}</span>
              <span className="text-[11px] text-ink-3">{count} videos</span>
            </Link>
          );
        })}
      </div>

      {(!categories || categories.length === 0) && (
        <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-[14px]">No categories yet</p>
        </div>
      )}
    </div>
  );
}
