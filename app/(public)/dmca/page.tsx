import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "DMCA Notice",
  description: "DMCA copyright policy and takedown procedures for erobabe",
  alternates: { canonical: `${SITE_URL}/dmca` },
};

const SECTIONS = [
  {
    number: "01",
    title: "Third-party hosting & non-ownership statement",
    paragraphs: [
      "erobabe does not own, produce, film, or claim copyright over any of the videos uploaded to or displayed on the platform. All videos and audiovisual works Remain the sole property of their respective copyright holders, creators, or studios.",
      "erobabe operates as an online service provider within the meaning of the Digital Millennium Copyright Act (17 U.S.C. § 512) and equivalent international copyright safe-harbor laws. We respond expeditiously to remove or disable access to any material claimed to be infringing.",
    ],
  },
  {
    number: "02",
    title: "How to submit a DMCA takedown notice",
    paragraphs: [
      "If you are a copyright owner — or an agent authorized to act on behalf of a copyright owner — and believe that a video hosted on erobabe infringes your copyright, please submit a written notice containing:",
      "1. Identification of the copyrighted work claimed to have been infringed; 2. The exact erobabe URL(s) of the video(s) to be removed; 3. Your name, mailing address, telephone number, and email address; 4. A statement that you have a good-faith belief that use of the material is not authorized by the copyright owner, its agent, or the law; 5. A statement under penalty of perjury that the information in the notice is accurate and that you are authorized to act on behalf of the copyright owner; and 6. Your physical or electronic signature.",
    ],
  },
  {
    number: "03",
    title: "Expedited removal process",
    paragraphs: [
      "You can file a takedown request directly through our online Content Removal form for immediate queueing. Valid copyright and DMCA notices are reviewed and acted upon within 24–48 hours, with the reported video permanently removed from public access.",
    ],
  },
];

export default function DmcaPage() {
  return (
    <div className="mx-auto max-w-[960px] pb-12">
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Legal
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            DMCA Notice &amp; Copyright Policy
          </h1>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          erobabe does not own any uploaded videos and promptly removes content
          upon valid copyright or DMCA takedown notification.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {SECTIONS.map((s) => (
          <section
            key={s.number}
            className="rounded-xl border border-line bg-card p-5"
          >
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-[11px] font-semibold text-accent">
                {s.number}
              </span>
              <h2 className="text-[15px] font-semibold text-ink">{s.title}</h2>
            </div>
            <div className="mt-2.5 space-y-2.5 text-[13px] leading-relaxed text-ink-2">
              {s.paragraphs.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4">
        <p className="text-[12.5px] text-ink-2">
          Ready to submit a copyright takedown or removal request?
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/content-removal"
            className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Submit Removal Request
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-[12px] font-medium text-ink transition-colors hover:border-zinc-600"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}
