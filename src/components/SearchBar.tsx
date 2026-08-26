import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Film, Hash, LayoutGrid, Search, X } from "lucide-react";
import { suggest } from "@/data/videos";
import { useRecentSearches } from "@/hooks/store";
import { cn } from "@/lib/format";

interface Item {
  label: string;
  kind: "recent" | "video" | "category" | "tag";
  id?: string;
}

const kindIcon = (kind: Item["kind"]) =>
  kind === "recent" ? Clock : kind === "video" ? Film : kind === "category" ? LayoutGrid : Hash;

export function SearchBar({
  autoFocus = false,
  size = "md",
  onNavigate,
  className,
  placeholder = "Search videos, categories, tags…",
}: {
  autoFocus?: boolean;
  size?: "md" | "lg";
  onNavigate?: () => void;
  className?: string;
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const { list: recent, add: addRecent } = useRecentSearches();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    if (!q.trim()) return recent.map<Item>((label) => ({ label, kind: "recent" }));
    return suggest(q).map<Item>((s) => ({ label: s.label, kind: s.kind, id: s.id }));
  }, [q, recent]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const commit = (term: string) => {
    const t = term.trim();
    if (!t) return;
    addRecent(t);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    onNavigate?.();
    navigate(`/search?q=${encodeURIComponent(t)}`);
  };

  const pick = (item: Item) => {
    if (item.kind === "video" && item.id) {
      addRecent(item.label);
      setOpen(false);
      setQ("");
      onNavigate?.();
      navigate(`/watch/${item.id}`);
      return;
    }
    commit(item.label);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) pick(items[active]);
      else commit(q);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); commit(q); }} className="relative">
        <Search
          className={cn(
            "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fog-500",
            size === "lg" ? "size-5" : "size-4"
          )}
          aria-hidden
        />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search videos"
          placeholder={placeholder}
          className={cn(
            "w-full rounded-full border border-white/10 bg-ink-800/80 pl-10 text-white placeholder-fog-600 transition",
            "hover:border-white/15 focus:border-brand-500/50 focus:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
            size === "lg" ? "h-13 pr-24 text-[15px]" : "h-10.5 pr-14 text-sm"
          )}
          style={{ WebkitAppearance: "none" }}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQ("");
                setActive(-1);
                inputRef.current?.focus();
              }}
              className="grid size-8 place-items-center rounded-full text-fog-500 transition hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
          {size === "lg" && (
            <button
              type="submit"
              className="hidden h-10 items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 sm:inline-flex"
            >
              Search
            </button>
          )}
        </div>
      </form>

      {open && items.length > 0 && (
        <div className="glass absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 py-1.5 shadow-2xl animate-scale-in">
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fog-600">
            {q.trim() ? "Suggestions" : "Recent searches"}
          </p>
          <ul role="listbox" aria-label="Search suggestions">
            {items.map((item, i) => {
              const Icon = kindIcon(item.kind);
              return (
                <li key={`${item.kind}-${item.label}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(item)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition",
                      i === active ? "bg-white/8 text-white" : "text-fog-300"
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-fog-500" aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {item.kind === "video" && (
                      <span className="ml-auto shrink-0 text-[11px] text-fog-600">Video</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
