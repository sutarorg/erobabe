/**
 * Shared UI primitives — buttons, badges, chips, modals, skeletons, states.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

/* ---------------- buttons ---------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "glass" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return (
    <button
      className={cn(
        "ring-focus inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3.5 text-xs",
        size === "md" && "h-10 px-5 text-sm",
        size === "lg" && "h-12 px-7 text-[15px]",
        variant === "primary" &&
          "bg-gradient-to-r from-eb-rose to-eb-violet text-white shadow-lg shadow-eb-rose/25 hover:shadow-eb-rose/40 hover:brightness-110",
        variant === "glass" && "glass border border-eb-line-strong text-white hover:bg-white/10",
        variant === "ghost" && "text-eb-muted hover:bg-white/5 hover:text-white",
        variant === "outline" && "border border-eb-line-strong text-eb-text hover:border-eb-rose/60 hover:text-white",
        variant === "danger" && "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20",
        className
      )}
      {...props}
    />
  );
}

/* ---------------- badges / chips ---------------- */

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ring-focus h-8 shrink-0 cursor-pointer rounded-full border px-3.5 text-xs font-medium whitespace-nowrap transition-all duration-150",
        active
          ? "border-transparent bg-gradient-to-r from-eb-rose to-eb-violet text-white shadow-md shadow-eb-rose/20"
          : "border-eb-line-strong bg-eb-800 text-eb-muted hover:border-white/25 hover:text-white",
        className
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- section header ---------------- */

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="font-display text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-eb-faint">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- empty state ---------------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="anim-fade-up mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-eb-line bg-eb-800 text-eb-rose">
        {icon}
      </div>
      <h3 className="font-display text-lg font-bold text-white">{title}</h3>
      {body && <p className="mt-2 text-sm leading-relaxed text-eb-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ---------------- skeletons ---------------- */

export function VideoCardSkeleton() {
  return (
    <div>
      <div className="skeleton aspect-video rounded-xl" />
      <div className="mt-2.5 space-y-2">
        <div className="skeleton h-3.5 w-11/12 rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  );
}

/* ---------------- modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "anim-fade-up relative w-full rounded-t-2xl border border-eb-line bg-eb-850 p-5 shadow-2xl sm:rounded-2xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          {title ? <h3 className="font-display text-base font-bold text-white">{title}</h3> : <span />}
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="ring-focus flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-eb-muted transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ---------------- toggle ---------------- */

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "ring-focus relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
        on ? "bg-gradient-to-r from-eb-rose to-eb-violet" : "bg-eb-700"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          on && "translate-x-5"
        )}
      />
    </button>
  );
}

/* ---------------- status pill ---------------- */

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25",
  DRAFT: "bg-zinc-500/12 text-zinc-300 border-zinc-500/30",
  PROCESSING: "bg-amber-500/12 text-amber-400 border-amber-500/25",
  READY: "bg-sky-500/12 text-sky-400 border-sky-500/25",
  UNPUBLISHED: "bg-orange-500/12 text-orange-400 border-orange-500/25",
  FAILED: "bg-red-500/12 text-red-400 border-red-500/25",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider",
        STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", status === "PROCESSING" && "live-dot")} />
      {status}
    </span>
  );
}
