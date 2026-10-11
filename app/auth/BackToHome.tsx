import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackToHome({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      prefetch
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent ${className}`}
    >
      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
      Back to home
    </Link>
  );
}
