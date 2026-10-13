import { revalidateTag } from "next/cache";

/**
 * Invalidates one of the cached public listings (`lib/public/catalog.ts`).
 *
 * `revalidateTag` requires Next's static-generation store, which does not exist
 * when a route module is exercised by a unit test, a script, or any other call
 * outside a real request — there it throws
 * `Invariant: static generation store missing`. Cache invalidation is an
 * optimisation (the entries expire on their own within 30–120 s), so it must
 * never fail the write that triggered it.
 */
export function revalidatePublicTag(tag: string): void {
  try {
    revalidateTag(tag);
  } catch {
    // Outside a Next.js request context — the cached entry expires on its own.
  }
}
