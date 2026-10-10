import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";
import RemovalForm from "./RemovalForm";

export const metadata: Metadata = {
  title: "Content Removal",
  alternates: { canonical: `${SITE_URL}/content-removal` },
};

export default function ContentRemovalPage() {
  return (
    <div className="pt-6 max-w-3xl">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Trust & Safety</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">Content Removal</h1>
      <p className="mt-2 text-[12.5px] text-ink-3">Report content that should be taken down. Valid requests are handled within 24–48 hours.</p>
      <div className="mt-6">
        <RemovalForm />
      </div>
    </div>
  );
}
