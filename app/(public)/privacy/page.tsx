import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: `${SITE_URL}/privacy` },
};

export default function PrivacyPage() {
  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Legal</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Privacy Policy</h1>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Last updated: October 10, 2026 — draft, requires legal review.
      </p>

      <div className="mt-6 space-y-6 rounded-lg border border-line bg-card p-6 text-[12.5px] leading-relaxed text-ink-2">
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">What we collect</h2>
          <p className="mt-1">Public visitors: minimal, anonymized view events (hashed IP, user-agent) for analytics with bot protection. No mandatory registration for browsing. Advertisers: account details, campaign metadata, payment records needed to run placements.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">Cookies & storage</h2>
          <p className="mt-1">Functional cookies for session, age-gate confirmation. No third-party ad trackers on public site. Supabase Auth uses secure httpOnly cookies.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">Data retention</h2>
          <p className="mt-1">Invoices retained for tax compliance. Video events aggregated, raw IP hashes purged after 30 days. Rights records retained per legal requirements.</p>
        </section>
        <section>
          <h2 className="text-[13.5px] font-semibold text-ink">Your rights</h2>
          <p className="mt-1">Depending on jurisdiction you may request access, correction, export or deletion. Contact support via verified email. Operator must provide real contact before launch.</p>
        </section>
      </div>
    </div>
  );
}
