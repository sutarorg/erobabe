import { publicPageMetadata } from "@/lib/metadata/page";
import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  title: "18 U.S.C. 2257 Statement",
  description: "18 U.S.C. § 2257 compliance and third-party content exemption statement",
  alternates: { canonical: `${SITE_URL}/2257` },
});

const SECTIONS = [
  {
    number: "01",
    title: "18 U.S.C. § 2257 Exemption Statement",
    paragraphs: [
      "erobabe is not a primary or secondary \"producer\" (as that term is defined in 18 U.S.C. § 2257 and 28 C.F.R. Part 75) of any of the visual depictions displayed on this website. erobabe does not own, film, direct, produce, or hire performers for any of the videos uploaded to the platform.",
      "With respect to all third-party videos and visual depictions uploaded to or indexed on erobabe, responsibility for maintaining records required under 18 U.S.C. § 2257 and 28 C.F.R. Part 75 rests solely with the respective third-party primary producers, studios, and copyright owners of those works.",
    ],
  },
  {
    number: "02",
    title: "Strict 18+ adult performer policy",
    paragraphs: [
      "Although erobabe does not own or produce the uploaded videos, we require that all individuals depicted in any audiovisual content hosted on the platform were at least eighteen (18) years of age at the time the visual depiction was created.",
      "We maintain a zero-tolerance policy toward any unlawful or underage material and immediately remove any content flagged or reported as violating our terms.",
    ],
  },
];

export default function Compliance2257Page() {
  return (
    <div className="mx-auto max-w-[960px] pb-12">
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Compliance
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            18 U.S.C. § 2257 Exemption Statement
          </h1>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          Record-keeping exemption notice for third-party uploaded adult content
          hosted on erobabe.
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
          Need to report a compliance concern or request content removal?
        </p>
        <Link
          href="/content-removal"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          Content Removal
        </Link>
      </div>
    </div>
  );
}
