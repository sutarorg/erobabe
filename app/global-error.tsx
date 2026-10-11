"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself and
 * renders branded markup instead of Next.js' raw "Application error" screen.
 * It must render its own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-ink antialiased">
        <div className="flex min-h-screen items-center justify-center px-6 py-16">
          <div className="w-full max-w-[520px] rounded-xl border border-line bg-card p-8 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
              erobabe
            </p>
            <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
              We couldn&rsquo;t load this page
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              A temporary problem occurred while loading content. Please try again in a moment.
            </p>
            {error.digest ? (
              <p className="mt-2 text-[11px] text-ink-3">Reference: {error.digest}</p>
            ) : null}
            <div className="mt-6 flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white"
              >
                Try again
              </button>
              <a
                href="/"
                className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-void px-4 text-[13px] font-medium text-ink-2"
              >
                Back to home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
