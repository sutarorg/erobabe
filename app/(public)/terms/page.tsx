import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: `${SITE_URL}/terms` },
};

export default function TermsPage() {
  return (
    <div className="pt-6 max-w-3xl">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Legal</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-[12px] text-ink-3">Last updated: October 10, 2026 — requires legal review before publication.</p>

      <div className="mt-6 space-y-6 rounded-lg border border-line bg-card p-6 text-[12.5px] leading-relaxed text-ink-2">
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">1. Eligibility</h2>
          <p className="mt-1">erobabe is strictly for adults. You must be at least 18 years old (or the age of majority in your jurisdiction) to access any part of the service. By entering, you represent that you meet this requirement.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">2. Content ownership</h2>
          <p className="mt-1">All videos are uploaded by authorized administrators and are owned by or licensed to erobabe. No user-generated video uploads are permitted for the initial launch. Rights clearance is tracked in private records and must be verified before publication.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">3. Advertising & payments</h2>
          <p className="mt-1">Ad placements are ten fixed 16:9 slots sold at USD $99 per 30-day period. Payments are processed via Bcon Global cryptocurrency integration. Campaigns become eligible only after payment is confirmed, creative is approved, and schedule allows delivery. No campaign activates based on unverified payment.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">4. Moderation</h2>
          <p className="mt-1">We review every video and creative. Reported content is assessed promptly. Illegal, non-consensual, or exploitative material is prohibited and will be removed with audit logging.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">5. Limitation of liability</h2>
          <p className="mt-1">Service provided “as is”. Operator details, business address, registration, and contact must be verified and inserted before launch. Do not rely on placeholder legal identity.</p>
        </section>
      </div>

      <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] text-amber-100/70">
        This document is a draft template. Owner must provide verified legal name, address, jurisdiction, and have it reviewed by counsel before publishing. Remove this notice only after review.
      </div>
    </div>
  );
}
