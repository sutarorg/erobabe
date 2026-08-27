import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, ChevronLeft, ChevronRight, Inbox,
  type LucideIcon,
} from "lucide-react";
import { resolveCategoryIcon } from "@/lib/categoryIcons";
import type { Category, Video } from "@/data/videos";
import { cn } from "@/lib/format";
import { VideoCard } from "./VideoCard";

/* ── Category icons resolve through the shared registry ── */
export const categoryIcon = (slug: string, icon?: string | null): LucideIcon =>
  resolveCategoryIcon(slug, icon);

/* ── Section header ── */
export function SectionHeader({
  eyebrow,
  title,
  href,
  icon: Icon,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4 md:mb-5", className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="hidden size-10 place-items-center rounded-xl border border-white/5 bg-ink-800 text-brand-400 sm:grid">
            <Icon className="size-4.5" aria-hidden />
          </span>
        )}
        <div>
          {eyebrow && (
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">{eyebrow}</p>
          )}
          <h2 className="text-lg font-semibold tracking-tight text-white md:text-xl">{title}</h2>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {href && (
          <Link
            to={href}
            className="group inline-flex items-center gap-1 rounded-full border border-white/8 bg-ink-800/80 px-3.5 py-1.5 text-xs font-medium text-fog-300 transition hover:border-brand-500/40 hover:text-white"
          >
            View all
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

/* ── Responsive dense grid ── */
export function VideoGrid({ videos, className }: { videos: Video[]; className?: string }) {
  if (videos.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        body="Videos published from the EroBabe admin panel appear here automatically — no redeploy needed."
      />
    );
  }
  return (
    <div
      className={cn(
        // Mobile: a single horizontally scrolling row of cards, edge-to-edge.
        "no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1",
        // Tablet and up: the dense responsive grid.
        "md:mx-0 md:grid md:grid-cols-3 md:gap-x-4 md:gap-y-8 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-4 2xl:grid-cols-5",
        className
      )}
    >
      {videos.map((v, i) => (
        <div
          key={v.id}
          // Card width mirrors the carousel so every rail on the homepage
          // scrolls with the same rhythm on small screens.
          className="w-[64vw] max-w-[300px] shrink-0 snap-start animate-fade-up sm:w-[36vw] md:w-auto"
          style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
        >
          <VideoCard video={v} priority={i < 4} />
        </div>
      ))}
    </div>
  );
}

/* ── Horizontal snap carousel ── */
export function Carousel({ videos, className }: { videos: Video[]; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) =>
    track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div className={cn("group/car relative", className)}>
      <div
        ref={track}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:gap-4 md:mx-0 md:px-0"
      >
        {videos.map((v, i) => (
          <div
            key={v.id}
            className="w-[64vw] max-w-[300px] shrink-0 snap-start animate-fade-up sm:w-[36vw] md:w-[calc((100%_-_2rem)/3)] lg:w-[calc((100%_-_3rem)/4)]"
            style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
          >
            <VideoCard video={v} priority={i < 3} />
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Scroll back"
        onClick={() => scrollBy(-1)}
        className="absolute -left-3 top-[38%] z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-ink-900/90 text-white opacity-0 shadow-xl backdrop-blur transition hover:bg-ink-700 group-hover/car:opacity-100 lg:grid"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Scroll forward"
        onClick={() => scrollBy(1)}
        className="absolute -right-3 top-[38%] z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-ink-900/90 text-white opacity-0 shadow-xl backdrop-blur transition hover:bg-ink-700 group-hover/car:opacity-100 lg:grid"
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}

/* ── Ranked "most watched" list ── */
export function RankList({ videos, className }: { videos: Video[]; className?: string }) {
  return (
    <ol className={cn("divide-y divide-white/5", className)}>
      {videos.map((v, i) => (
        <li key={v.id}>
          <Link to={`/video/${v.id}`} className="group flex items-center gap-3.5 py-3 sm:gap-5">
            <span
              aria-hidden
              className={cn(
                "w-9 shrink-0 text-center text-2xl font-bold tracking-tight tabular-nums sm:w-12 sm:text-3xl",
                i < 3 ? "text-gradient" : "text-fog-600/70"
              )}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/5 sm:w-36">
              <img
                src={v.thumbnail}
                alt={`${v.title} thumbnail`}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <span className="glass absolute bottom-1 right-1 rounded px-1 py-px text-[10px] font-semibold text-white">
                {v.durationLabel}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug text-fog-100 transition group-hover:text-brand-300">
                {v.title}
              </h3>
              <p className="mt-1 truncate text-xs text-fog-500">
                {v.viewsLabel} views · {v.dateLabel}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/* ── Category card ── */
export function CategoryCard({ category, count, className }: { category: Category; count?: number; className?: string }) {
  const Icon = categoryIcon(category.slug, category.icon);
  return (
    <Link
      to={category.href ?? `/category/${category.slug}`}
      className={cn(
        "group relative block aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-white/8 transition duration-300",
        "hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-16px_rgba(0,0,0,0.8)] hover:ring-white/15 sm:aspect-[16/10]",
        className
      )}
    >
      <img
        src={category.image}
        alt={`${category.name} category artwork`}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-108"
      />
      <div className={cn("absolute inset-0 bg-gradient-to-t via-transparent to-transparent", category.gradient)} aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden />
      <span className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur transition group-hover:scale-110 group-hover:border-white/30">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <h3 className="text-base font-semibold tracking-tight text-white md:text-lg">{category.name}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-white/60">
          {count != null ? `${count} videos` : category.blurb}
        </p>
      </div>
    </Link>
  );
}

/* ── Filter chips ── */
export interface ChipOption {
  key: string;
  label: string;
  icon?: LucideIcon;
}

export function FilterChips({
  options,
  value,
  onChange,
  className,
  ariaLabel = "Filters",
}: {
  options: ChipOption[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0", className)}>
      {options.map((o) => {
        const active = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition active:scale-95",
              active
                ? "bg-gradient-to-r from-brand-500 to-violet-600 text-white shadow-[0_6px_20px_-6px_rgba(244,63,127,0.6)]"
                : "border border-white/8 bg-ink-800/80 text-fog-400 hover:border-white/15 hover:text-white"
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Small tag chip ── */
export function Tag({ label, to, className }: { label: string; to?: string; className?: string }) {
  const cls = cn(
    "inline-flex items-center rounded-full border border-white/8 bg-ink-800/80 px-2.5 py-1 text-[11px] font-medium text-fog-400 transition",
    to && "hover:border-brand-500/40 hover:text-white",
    className
  );
  return to ? <Link to={to} className={cls}>{label}</Link> : <span className={cls}>{label}</span>;
}

/* ── Empty state ── */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-dashed border-white/10 bg-ink-900/40 px-6 py-16 text-center", className)}>
      <span className="grid size-14 place-items-center rounded-2xl border border-white/8 bg-ink-800 text-fog-500">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-white">{title}</h3>
      {body && <p className="mt-2 max-w-sm text-sm leading-relaxed text-fog-500">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ── Toggle switch ── */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-gradient-to-r from-brand-500 to-violet-600" : "bg-ink-600"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-200",
          checked ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}
