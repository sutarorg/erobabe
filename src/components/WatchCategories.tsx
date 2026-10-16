import Categories from "./Categories";
import type { PublicCategory } from "@/lib/public/catalog";

export default function WatchCategories({
  categories,
  activeCategory,
}: {
  categories: PublicCategory[];
  activeCategory?: string | null;
}) {
  const categoryCards = categories.map((category) => ({
    id: category.id,
    label: category.label,
    slug: category.slug,
    icon: category.icon || undefined,
    image: category.image_url || undefined,
  }));

  return (
    <section className="mt-8 border-t border-line pt-5" aria-label="Browse categories">
      <Categories categories={categoryCards} activeCategory={activeCategory} />
    </section>
  );
}
