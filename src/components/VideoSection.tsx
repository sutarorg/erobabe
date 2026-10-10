import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

interface VideoSectionProps {
  title: string;
  /** Omit to render the section without a "View all" action. */
  onViewAll?: () => void;
  children: ReactNode;
}

export default function VideoSection({ title, onViewAll, children }: VideoSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
          >
            View all
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
