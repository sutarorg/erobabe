import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Parental Controls",
  description: "Parental control tools and age-restriction guidance for erobabe",
  alternates: { canonical: `${SITE_URL}/parental-controls` },
};

const SECTIONS = [
  {
    number: "01",
    title: "Restricted to adults 18+",
    paragraphs: [
      "erobabe is strictly intended for adults aged eighteen (18) years or older (or the age of legal majority in your jurisdiction). We enforce an age-verification gate before entry and include industry-standard adult content meta tags so parental filtering software can automatically recognize and block access by minors.",
    ],
  },
  {
    number: "02",
    title: "Device & network filtering tools",
    paragraphs: [
      "Parents and guardians who wish to prevent minors from accessing adult websites can enable built-in operating-system restrictions (Apple Screen Time, Google Family Link, Microsoft Family Safety) or third-party parental control filters such as Net Nanny, Qustodio, CyberPatrol, Bark, or CleanBrowsing DNS.",
    ],
  },
];

export default function ParentalControlsPage() {
  return (
    <div className="mx-auto max-w-[960px] pb-12">
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Safety
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Parental Controls
          </h1>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          How parents and guardians can restrict access to adult-oriented
          content on shared devices and home networks.
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
          Questions about site safety or compliance?
        </p>
        <Link
          href="/contact"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          Contact Us
        </Link>
      </div>
    </div>
  );
}
