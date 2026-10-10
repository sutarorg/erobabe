import { ChevronDown, X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";

/* ------------------------------ Card ------------------------------ */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-line bg-pcard", className)}>{children}</div>
  );
}

/* ---------------------------- IconBox ----------------------------- */

export function IconBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ----------------------------- Button ----------------------------- */

type BtnVariant = "primary" | "outline" | "accentOutline" | "ghost";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "sm" | "md";
}

const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-soft border border-transparent",
  outline: "border border-line bg-transparent text-ink hover:border-zinc-500",
  accentOutline: "border border-accent/50 bg-transparent text-accent hover:bg-accent/10",
  ghost: "border border-transparent text-ink-2 hover:text-ink hover:bg-white/5",
};

export function Btn({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-[12px]" : "h-9 px-4 text-[12.5px]",
        btnVariants[variant],
        className
      )}
      {...props}
    />
  );
}

/* ----------------------------- Select ----------------------------- */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ className, label, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      {label && <span className="sr-only">{label}</span>}
      <select
        aria-label={label}
        className="h-8 appearance-none rounded-md border border-line bg-pcard-2 pl-2.5 pr-7 text-[11.5px] font-medium text-ink-2 outline-none transition-colors hover:border-zinc-500 focus:border-accent/60"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ink-3" aria-hidden />
    </span>
  );
}

/* --------------------------- StatusPill --------------------------- */

const pillStyles: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  available: "border-line bg-transparent text-ink-3",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  completed: "border-line bg-white/[0.03] text-ink-3",
  rejected: "border-red-500/30 bg-red-500/10 text-red-400",
  paused: "border-line bg-white/[0.03] text-ink-2",
};

const dotStyles: Record<string, string> = {
  active: "bg-emerald-400",
  available: "bg-zinc-600",
  pending: "bg-amber-400",
  completed: "bg-zinc-500",
  rejected: "bg-red-400",
  paused: "bg-zinc-400",
};

const statusLabels: Record<string, string> = {
  active: "Active",
  available: "Available",
  pending: "Pending",
  completed: "Completed",
  rejected: "Rejected",
  paused: "Paused",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-semibold",
        pillStyles[status] ?? pillStyles.available,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[status] ?? dotStyles.available)} />
      {statusLabels[status] ?? status}
    </span>
  );
}

/* ------------------------------ Modal ----------------------------- */

export function Modal({
  onClose,
  children,
  maxW = "max-w-md",
  labelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  maxW?: string;
  labelledBy?: string;
}) {
  return (
    <div className="fixed inset-0 z-[80]">
      <div className="eb-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={cn(
              "eb-panel relative w-full rounded-xl border border-line bg-pcard-2 shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
              maxW
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModalHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[11.5px] text-ink-3">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close dialog"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/5 hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------ Drawer ---------------------------- */

export function Drawer({
  onClose,
  title,
  sub,
  children,
}: {
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80]">
      <div className="eb-backdrop absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="eb-drawer center-scroll absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-psidebar sm:w-[400px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {sub && <p className="mt-0.5 text-[11.5px] text-ink-3">{sub}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/5 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/* ------------------------------ Fields ---------------------------- */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Field({ label, error, hint, className, ...props }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">{label}</span>
      <input
        className={cn(
          "h-9 w-full rounded-md border bg-void px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3",
          error ? "border-red-500/60" : "border-line focus:border-accent/60"
        )}
        {...props}
      />
      {error ? (
        <span className="mt-1 block text-[11px] text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export function TextArea({ label, error, className, ...props }: TextAreaProps) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">{label}</span>
      <textarea
        className={cn(
          "w-full rounded-md border bg-void px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3",
          error ? "border-red-500/60" : "border-line focus:border-accent/60"
        )}
        rows={4}
        {...props}
      />
      {error && <span className="mt-1 block text-[11px] text-red-400">{error}</span>}
    </label>
  );
}

/* --------------------------- PageHeader --------------------------- */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
