"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Boundary for an unexpected analytics failure.
 *
 * The loaders already turn a database problem into an inline state, so reaching
 * this boundary means something else broke (a render error, a bad URL). It
 * offers a retry and never shows a stack trace.
 */
export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the digest for the server logs; never log row data.
    console.error("Admin analytics failed", error.digest || error.message);
  }, [error]);

  return (
    <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-6 text-center">
      <AlertTriangle aria-hidden className="mx-auto h-5 w-5 text-red-300" />
      <p className="mt-2 text-[13px] font-semibold">This report failed to render</p>
      <p className="mx-auto mt-1 max-w-[520px] text-[12px] leading-relaxed text-ink-3">
        The analytics data was not changed. Retry the report; if it keeps failing, check the server
        logs for the matching digest{error.digest ? ` (${error.digest})` : ""}.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white"
      >
        Retry
      </button>
    </div>
  );
}
