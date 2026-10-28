import Link from "next/link";
import JsonLd from "@/src/components/JsonLd";
import { breadcrumbJsonLd, type BreadcrumbItem } from "@/lib/seo/json-ld";

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(items)} />
      <nav aria-label="Breadcrumb" className="text-[12px] text-ink-3">
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((item, index) => {
            const last = index === items.length - 1;
            return (
              <li key={`${item.path}:${item.name}`} className="flex min-w-0 items-center gap-1.5">
                {index > 0 ? <span aria-hidden>/</span> : null}
                {last ? (
                  <span className="line-clamp-1 text-ink-2" aria-current="page">
                    {item.name}
                  </span>
                ) : (
                  <Link href={item.path} prefetch className="hover:text-accent">
                    {item.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
