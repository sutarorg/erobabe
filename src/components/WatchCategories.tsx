import Link from "next/link";
import type { PublicCategory } from "@/lib/public/catalog";
import { resolveCategoryIcon } from "./categoryIcons";
export default function WatchCategories({ categories }: { categories: PublicCategory[] }) {
  return <section className="mt-8 border-t border-line pt-5">
    <h2 className="text-[15px] font-semibold">Top Categories</h2>
    <div className="mt-3.5 flex gap-3 overflow-x-auto pb-3" tabIndex={0} aria-label="Browse categories">
      {categories.map(c => { const Icon = resolveCategoryIcon(c.icon, c.slug); return <Link key={c.id} href={`/category/${c.slug}`} className="flex w-52 shrink-0 items-center gap-3 rounded-lg border border-line bg-card p-3 hover:border-accent">
        {c.image_url ? <img src={c.image_url} alt="" loading="lazy" className="h-14 w-16 rounded-md object-cover" /> : <Icon aria-hidden className="h-8 w-8 shrink-0 text-accent" />}
        <div className="min-w-0"><p className="text-sm font-semibold">{c.label}</p><p className="mt-1 line-clamp-2 text-xs text-ink-3">{c.description}</p></div>
      </Link>; })}
    </div>
  </section>;
}
