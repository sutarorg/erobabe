import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AdminSignInForm from "./AdminSignInForm";

export const metadata: Metadata = {
  title: "Admin sign in — EroBabe",
  // Staff-only surface: never let a crawler index or follow it.
  robots: { index: false, follow: false },
};

/**
 * `/admin/signin` — the administrator sign-in page.
 *
 * It is intentionally separate from the account-free public advertising
 * checkout. A successful sign-in is accepted only for an active admin profile.
 *
 * `middleware.ts` keeps this path reachable while the rest of `/admin` requires
 * a session.
 */
export default function AdminSignInPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-void px-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute -inset-16 opacity-90 blur-3xl"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 20% 22%, rgba(124,58,151,0.45) 0%, transparent 42%), radial-gradient(ellipse at 78% 30%, rgba(245,22,85,0.38) 0%, transparent 40%), radial-gradient(ellipse at 50% 90%, rgba(15,23,42,0.85) 0%, transparent 55%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-black/35 to-black/60" />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center">
        <AdminSignInForm />
        <Link
          href="/"
          prefetch
          className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back to site
        </Link>
      </div>
    </div>
  );
}
