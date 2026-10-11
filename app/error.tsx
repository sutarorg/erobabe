"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[520px] rounded-xl border border-line bg-card p-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
          Something went wrong
        </p>
        <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
          We couldn&rsquo;t load this page
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          A temporary problem occurred while loading content. Please try again — if it keeps
          happening, our team has been notified.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[11px] text-ink-3">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-void px-4 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent/45 hover:text-ink"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
