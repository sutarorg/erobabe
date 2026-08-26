import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X, type LucideIcon,
} from "lucide-react";
import { cn, formatDuration, formatViews } from "@/lib/format";
import type { VideoStatus } from "./api";
import { Toggle } from "@/components/Sections";

export { Toggle };

/* ── async data helper ── */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    set((s) => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then((d) => set({ data: d, loading: false, error: null }))
      .catch((e) => set({ data: null, loading: false, error: e?.message ?? "Something went wrong" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((d) => alive && set({ data: d, loading: false, error: null }))
      .catch((e) => alive && set({ data: null, loading: false, error: e?.message ?? "Something went wrong" }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ── buttons ── */
type BtnVariant = "primary" | "outline" | "ghost" | "danger" | "subtle";
const btnCls = (variant: BtnVariant = "outline", size: "sm" | "md" = "md") =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8.5 px-3 text-xs" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-gradient-to-r from-brand-500 to-violet-600 text-white hover:brightness-110",
    variant === "outline" && "border border-white/10 bg-white/4 text-fog-200 hover:border-white/20 hover:text-white",
    variant === "ghost" && "text-fog-400 hover:bg-white/5 hover:text-white",
    variant === "subtle" && "bg-ink-700 text-fog-200 hover:bg-ink-600 hover:text-white",
    variant === "danger" && "bg-red-600/90 text-white hover:bg-red-500"
  );

export function Btn({
  variant, size, className, busy, icon: Icon, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: "sm" | "md"; busy?: boolean; icon?: LucideIcon;
}) {
  return (
    <button type="button" {...rest} disabled={busy || rest.disabled} className={cn(btnCls(variant, size), className)}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function BtnLink({
  to, variant, size, className, icon: Icon, children, ...rest
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string; variant?: BtnVariant; size?: "sm" | "md"; icon?: LucideIcon; children: ReactNode;
}) {
  return (
    <Link to={to} className={cn(btnCls(variant, size), className)} {...rest}>
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </Link>
  );
}

/* ── form primitives ── */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fog-500">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[11px] text-fog-600">{hint}</span>}
      {error && <span className="mt-1.5 block text-[11px] font-medium text-red-400">{error}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-ink-850 px-3.5 text-sm text-white placeholder-fog-600 outline-none transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, "h-10.5", props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "min-h-28 py-2.5 leading-relaxed", props.className)} />;
}
export function Select({ children, className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(inputCls, "h-10.5 appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function SearchInput({
  value, onChange, placeholder = "Search…", className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fog-600" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(inputCls, "h-10.5 pl-9")}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-fog-500 hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ── status badge ── */
const STATUS_STYLE: Record<VideoStatus, { label: string; cls: string; dot: string }> = {
  uploading: { label: "Uploading", cls: "bg-sky-500/12 text-sky-300 ring-sky-500/30", dot: "bg-sky-400" },
  draft: { label: "Draft", cls: "bg-zinc-500/12 text-zinc-300 ring-zinc-500/30", dot: "bg-zinc-400" },
  processing: { label: "Processing", cls: "bg-amber-500/12 text-amber-300 ring-amber-500/30", dot: "bg-amber-400" },
  ready: { label: "Ready", cls: "bg-cyan-500/12 text-cyan-300 ring-cyan-500/30", dot: "bg-cyan-400" },
  published: { label: "Published", cls: "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30", dot: "bg-emerald-400" },
  unpublished: { label: "Unpublished", cls: "bg-fog-500/12 text-fog-400 ring-fog-500/30", dot: "bg-fog-500" },
};

export function StatusBadge({ status }: { status: VideoStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", s.cls)}>
      <span className={cn("size-1.5 rounded-full", s.dot, (status === "processing" || status === "uploading") && "animate-pulse")} />
      {s.label}
    </span>
  );
}

/* ── layout bits ── */
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-fog-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sub, accent }: { icon: LucideIcon; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-fog-600">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", accent ? "bg-brand-500/15 text-brand-400" : "bg-white/5 text-fog-500")}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fog-600">{sub}</p>}
    </div>
  );
}

export const fmtViews = formatViews;
export const fmtDur = (s: number | null | undefined) => (s == null ? "—" : formatDuration(s));
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

export function EmptyBlock({ icon: Icon = Inbox, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-ink-900/40 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-white/8 bg-ink-800 text-fog-500">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm text-fog-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-fog-500" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label ?? "Loading…"}</span>
    </div>
  );
}

/* ── modal + confirm ── */
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[88] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={cn("relative w-full rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-2xl animate-scale-in md:p-6", wide ? "max-w-2xl" : "max-w-lg")}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-full text-fog-500 hover:bg-white/5 hover:text-white">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({
  open, onClose, onConfirm, title, body, confirmLabel = "Confirm", busy,
}: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: string; confirmLabel?: string; busy?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-400">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <p className="text-sm leading-relaxed text-fog-400">{body}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

/* ── chart (pure CSS bars) ── */
export function BarsChart({ data, className }: { data: { day: string; views: number }[]; className?: string }) {
  const max = Math.max(...data.map((d) => d.views), 1);
  return (
    <div className={cn("flex h-36 items-end gap-1", className)} role="img" aria-label="Daily views chart">
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div
            className="w-full rounded-t-md bg-gradient-to-t from-brand-500/70 to-violet-500/70 transition-all group-hover:from-brand-500 group-hover:to-violet-500"
            style={{ height: `${Math.max((d.views / max) * 100, d.views > 0 ? 4 : 1.5)}%` }}
          />
          <div className="glass pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-white group-hover:block">
            {d.views} views · {new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── tags editor ── */
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/\s+/g, " ");
    if (t && !tags.includes(t) && tags.length < 12) onChange([...tags, t]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-ink-850 p-2">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-white/6 px-2 py-1 text-xs text-fog-200">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="text-fog-500 hover:text-white">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={tags.length ? "" : "Add tags, press Enter…"}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-fog-600 outline-none"
        />
      </div>
      <p className="mt-1.5 text-[11px] text-fog-600">Up to 12 tags · Enter or comma to add</p>
    </div>
  );
}

/* ── pagination ── */
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <Btn variant="subtle" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" aria-hidden />
      </Btn>
      <span className="px-2 text-xs font-medium text-fog-500">
        Page {page} of {pages}
      </span>
      <Btn variant="subtle" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="size-4" aria-hidden />
      </Btn>
    </div>
  );
}

/* ── tabs ── */
export function Tabs({
  tabs, active, onChange,
}: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-6 flex gap-1 rounded-xl border border-white/6 bg-ink-900/60 p-1 w-fit">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold transition",
            active === t.key ? "bg-gradient-to-r from-brand-500/90 to-violet-600/90 text-white" : "text-fog-400 hover:text-white"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
