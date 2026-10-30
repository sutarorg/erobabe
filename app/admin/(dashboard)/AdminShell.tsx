"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import PortalSidebar from "@/src/components/PortalSidebar";
import AdminNav from "./AdminNav";

/**
 * The admin frame.
 *
 * The dashboard scrolls in its own column — the sidebar stays put, the page
 * moves. That only works if the *document* never scrolls too, and it did: the
 * `<main>` column overflowed the viewport by a few pixels as well, so the
 * browser drew a second, outer scrollbar next to the panel's own one and the
 * page could be scrolled in two competing ways.
 *
 * Three things keep it to a single scrollbar now:
 *
 * 1. `html`/`body` are locked (`admin-viewport-lock` in `globals.css`) while
 *    this shell is mounted, so the document has nothing to scroll.
 * 2. The shell is exactly one dynamic viewport tall (`100dvh`, with `100vh` for
 *    engines without dynamic units) and clips its own overflow.
 * 3. `overscroll-contain` on the column stops a scroll from chaining out to the
 *    document at either end.
 *
 * Resetting the column on navigation is part of the same fix: once the window
 * no longer scrolls, the router's "scroll to top" has nothing to move.
 */
export default function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const scroller = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("admin-viewport-lock");
    return () => root.classList.remove("admin-viewport-lock");
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    try {
      node.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch {
      node.scrollTop = 0;
    }
  }, [pathname]);

  return (
    <div className="admin-shell flex bg-void text-ink">
      <PortalSidebar portal="Admin" email={email}>
        <AdminNav />
      </PortalSidebar>
      <main
        ref={scroller}
        data-admin-scroll=""
        className="center-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="px-4 pb-10 pt-16 lg:px-6 lg:pt-5">{children}</div>
      </main>
    </div>
  );
}
