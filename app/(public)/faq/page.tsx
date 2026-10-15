import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = publicPageMetadata({
  title: "FAQ",
  alternates: { canonical: `${SITE_URL}/faq` },
});

const FAQS = [
  { q: "Do I need an account to watch?", a: "No. The public library is free to browse after the 18+ age gate. Accounts are only required for advertisers." },
  { q: "How does advertising work?", a: "Pick any available slot, reserve it for USD $99 per 30 days, upload a 16:9 creative (1200×675 recommended). Creatives are reviewed before going live. Payments are via cryptocurrency through NOWPayments." },
  { q: "Does erobabe own the uploaded videos?", a: "No. erobabe does not own, produce, or claim copyright over any of the videos uploaded to the platform. All videos remain the property of their respective third-party creators, studios, or copyright owners." },
  { q: "How do I request removal or file a DMCA notice?", a: "Use the Content Removal or DMCA Notice page with the video URL and reason. Valid takedown and removal requests are processed promptly within 24–48 hours." },
  { q: "What payment methods?", a: "USDT on Ethereum (ERC-20) via NOWPayments. You receive a payment QR code, address, and payable amount at checkout. Campaigns activate once payment is confirmed." },
];

export default function FAQPage() {
  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Support</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">FAQ</h1>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Quick answers about browsing, advertising and moderation.
      </p>
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
