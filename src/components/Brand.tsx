import { Link } from "react-router-dom";
import { Flame, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/format";

export function Logo({ compact = false, href = "/", className }: { compact?: boolean; href?: string; className?: string }) {
  return (
    <Link
      to={href}
      aria-label="EroBabe home"
      className={cn("group inline-flex items-center gap-2.5 outline-none", className)}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-500 to-violet-600 shadow-[0_4px_24px_-4px_rgba(244,63,127,0.6)] transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
        <Flame className="size-[18px] text-white" strokeWidth={2.4} aria-hidden />
      </span>
      {!compact && (
        <span className="text-[19px] font-semibold tracking-tight text-white">
          Ero<span className="text-gradient">Babe</span>
        </span>
      )}
    </Link>
  );
}

export function AgeBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand-300",
        className
      )}
    >
      <ShieldAlert className="size-3" aria-hidden />
      18+
    </span>
  );
}
