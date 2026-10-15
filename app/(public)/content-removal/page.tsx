import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";
import RemovalForm from "./RemovalForm";

export const metadata: Metadata = publicPageMetadata({
  title: "Content Removal",
  alternates: { canonical: `${SITE_URL}/content-removal` },
});

export default function ContentRemovalPage() {
  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Trust & Safety</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Content Removal</h1>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Report content that should be taken down. Valid requests are handled within 24–48 hours.
      </p>
      <div className="mt-6">
        <RemovalForm />
      </div>
    </div>
  );
}
