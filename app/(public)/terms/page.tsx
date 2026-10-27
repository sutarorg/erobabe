import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";

const EFFECTIVE_DATE = "October 27, 2026";

const SECTIONS: { number: string; title: string; paragraphs: string[] }[] = [
  {
    number: "01",
    title: "Eligibility and age requirement",
    paragraphs: [
      "You must be at least eighteen (18) years of age — or the age of legal majority in the jurisdiction from which you access the site, whichever is higher — to view, browse, or interact with erobabe in any way.",
      "By continuing past the age gate you represent and warrant that you meet this requirement and that accessing adult-oriented material is lawful where you are located. Please exit immediately if either condition is not met.",
    ],
  },
  {
    number: "02",
    title: "Permitted personal use",
    paragraphs: [
      "erobabe is provided for personal, non-commercial viewing inside a standard web browser. You may not scrape, mirror, bulk-download, re-host, redistribute, frame, or build automated indices of the catalog, thumbnails, or page metadata without prior written permission.",
      "Automated traffic that degrades delivery for other viewers, probes non-public endpoints, or attempts to bypass rate limits or security controls is prohibited.",
    ],
  },
  {
    number: "03",
    title: "No ownership of uploaded videos & third-party content",
    paragraphs: [
      "erobabe does not own, produce, film, direct, or claim copyright ownership over any of the videos uploaded to or displayed on the platform. All videos, clips, and associated audiovisual media are provided by third-party content partners, studios, or uploaders, and all intellectual property rights remain the sole property of their respective copyright owners.",
      "erobabe operates strictly as an online hosting and indexing platform and makes no representations of ownership over uploaded video files. The erobabe interface design, branding, and software code remain the property of erobabe.",
    ],
  },
  {
    number: "04",
    title: "Prohibited conduct & zero-tolerance policy",
    paragraphs: [
      "erobabe maintains a strict zero-tolerance policy against non-consensual content, underage material, unlawful recordings, and copyright infringement. Attempting to upload, distribute, or link to prohibited content results in immediate removal and permanent restriction.",
      "You may not use the site in any manner that violates applicable local, national, or international law, or that interferes with the security or availability of our infrastructure.",
    ],
  },
  {
    number: "05",
    title: "Advertising and sponsored placements",
    paragraphs: [
      "Advertising checkout is account-free. You must provide accurate contact and business information, upload a 16:9 creative, and pay the exact USD amount shown using the provided PayPal QR. Submitting the checkout form records your order as in review; it does not mean payment has been verified or that the ad has been accepted.",
      "Our team manually verifies PayPal payment and reviews every creative and destination before making an ad live. All assets and URLs must comply with applicable law and our placement guidelines. We reserve the right to reject, pause, or remove any advertisement at our discretion.",
    ],
  },
  {
    number: "06",
    title: "DMCA, copyright complaints & content removal",
    paragraphs: [
      "Because erobabe does not own any uploaded videos, we respect the intellectual property and personal rights of all third-party copyright holders and individuals. If you believe any video on erobabe infringes your copyright or appears without authorization or consent, please submit a request via our Content Removal or DMCA Notice page.",
      "Upon receipt of a valid takedown or content-removal notice, we expeditiously disable access to and permanently remove the identified video from our catalog.",
    ],
  },
  {
    number: "07",
    title: "Disclaimers and limitation of liability",
    paragraphs: [
      "The service and all third-party video streams are provided on an \"as is\" and \"as available\" basis without warranties of any kind, whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, or non-infringement.",
      "To the fullest extent permitted by law, erobabe and its operators shall not be liable for any indirect, incidental, consequential, special, or exemplary damages arising out of or in connection with your use of the site or any third-party content hosted on the platform.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[960px] pb-12">
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Legal
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Terms of Service
          </h1>
          <span className="text-xs text-ink-3">Effective {EFFECTIVE_DATE}</span>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          The rules and conditions that govern browsing erobabe, third-party
          uploaded video disclaimers, and submitting an advertisement.
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
          Need to report a copyright issue or request removal of a video?
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dmca"
            className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-[12px] font-medium text-ink transition-colors hover:border-zinc-600"
          >
            DMCA Notice
          </Link>
          <Link
            href="/content-removal"
            className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-[12px] font-medium text-ink transition-colors hover:border-zinc-600"
          >
            Content Removal
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}

export const metadata: Metadata = publicPageMetadata({ title: "Terms of Service", description: "Read the terms governing use of Erobabe, including adult eligibility, permitted use, publisher obligations, and content removal policies.", alternates: { canonical: `${SITE_URL}/terms` } });
