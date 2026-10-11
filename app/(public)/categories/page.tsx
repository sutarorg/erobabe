import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import CategoryIcon from "@/src/components/CategoryIcon";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Categories",
  alternates: { canonical: `${SITE_URL}/categories` },
};

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase.from("categories").select("id, label, slug, icon").order("label");

  return (
    <div className="pt-4">
      <h1 className="text-[22px] font-semibold tracking-tight">Categories</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Browse all genres</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {(categories || []).map((cat: any) => (
          <Link
            key={cat.id}
            href={`/category/${cat.slug}`}
            className="group flex h-[92px] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-card transition-colors hover:border-accent/45 hover:bg-card-hover"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 transition-colors group-hover:border-accent/45">
              <CategoryIcon
                icon={cat.icon ? String(cat.icon) : null}
                fallbackKey={cat.slug ? String(cat.slug) : cat.label}
                className="h-[18px] w-[18px] text-accent transition-transform duration-200 group-hover:scale-110"
              />
            </span>
            <span className="text-[13px] font-medium text-ink group-hover:text-accent">{cat.label}</span>
          </Link>
        ))}
      </div>

      {(!categories || categories.length === 0) && (
        <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-[14px]">No categories yet</p>
        </div>
      )}
    </div>
  );
}
