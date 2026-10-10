import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  alternates: { canonical: `${SITE_URL}/faq` },
};

const FAQS = [
  { q: "Do I need an account to watch?", a: "No. The public library is free to browse after the 18+ age gate. Accounts are only required for advertisers." },
  { q: "How does advertising work?", a: "Pick any available slot, reserve it for USD $99 per 30 days, upload a 16:9 creative (1200×675 recommended). Creatives are reviewed before going live. Payments are via cryptocurrency through Bcon Global." },
  { q: "Is the content verified?", a: "Yes. All scenes are owned or licensed by erobabe, with rights clearance tracked privately and verified before publication." },
  { q: "How do I request removal?", a: "Use the Content Removal form with video URL and reason. Valid requests are processed within 24–48 hours." },
  { q: "What payment methods?", a: "Cryptocurrency via Bcon Global. You receive a payment address, amount, network, and QR code. Payments require confirmed status (2 confirmations) before campaign activation." },
];

export default function FAQPage() {
  return (
    <div className="pt-6 max-w-3xl">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Support</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">FAQ</h1>
      <div className="mt-6 divide-y divide-line rounded-lg border border-line bg-card">
        {FAQS.map((f, i) => (
          <div key={i} className="p-5">
            <p className="text-[13px] font-medium">{f.q}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
