import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/metadata/page";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";

const EFFECTIVE_DATE = "October 15, 2026";

const SECTIONS: { number: string; title: string; paragraphs: string[] }[] = [
  {
    number: "01",
    title: "Overview",
    paragraphs: [
      "erobabe is designed so adults can browse the public catalog without creating a viewer account. We collect only the minimum operational data required to deliver pages, count aggregate video views, and keep the service reliable.",
      "erobabe does not own, produce, or claim ownership over any of the videos uploaded to the platform. All uploaded videos remain the property of their respective third-party creators, studios, or rights holders. This Privacy Policy explains how visitor data, advertiser account data, and personal privacy or removal requests regarding third-party uploaded videos are handled.",
    ],
  },
  {
    number: "02",
    title: "Browsing the public catalog",
    paragraphs: [
      "When you load a page or play a video, our edge and streaming providers receive standard request metadata — such as IP address, user-agent string, referrer, and requested URL — in order to route traffic, prevent abuse, and serve media streams.",
      "We record aggregate view and engagement counters on videos. We do not build personal viewing profiles of anonymous visitors or sell browsing histories to third parties.",
    ],
  },
  {
    number: "03",
    title: "Third-party uploaded videos & personal privacy rights",
    paragraphs: [
      "Because erobabe does not own any uploaded videos and acts strictly as a hosting platform for third-party content, we provide a fast, confidential mechanism for any individual who appears in an uploaded video without authorization or consent — or whose personal privacy is affected — to request immediate permanent removal.",
      "When you submit a privacy, non-consensual content, or copyright removal request, the information you provide is used solely to locate the video, verify and process the takedown, and maintain a confidential compliance record.",
    ],
  },
  {
    number: "04",
    title: "Cookies and local storage",
    paragraphs: [
      "For ordinary visitors we use local browser storage only to remember that you have confirmed you are 18+ so the age-verification prompt is not shown on every page load.",
      "If you sign in as an advertiser, we set strictly necessary session cookies managed by our authentication provider to keep your portal session active and secure.",
    ],
  },
  {
    number: "05",
    title: "Advertiser accounts and billing records",
    paragraphs: [
      "When you register an advertiser account we store the email address, display name, and campaign assets you submit, along with invoice and payment status records returned by our cryptocurrency payment processor.",
      "We do not receive or custody your private wallet keys. Blockchain transaction identifiers and settlement statuses are retained for accounting, fraud prevention, and support.",
    ],
  },
  {
    number: "06",
    title: "Infrastructure and service providers",
    paragraphs: [
      "We rely on specialized infrastructure partners for database hosting, authentication, content delivery, video transcoding/streaming, and cryptocurrency payment processing. Each provider processes data only as needed to perform its service for erobabe.",
    ],
  },
  {
    number: "07",
    title: "Data retention, removal & contact",
    paragraphs: [
      "Age-gate confirmation is held only while the public site remains open and is not saved in browser storage; you will be asked again when you enter the site in a fresh page session. Advertisers may request updates or deletion of their account profile — subject to mandatory financial record-keeping — through the contact page.",
      "To request immediate removal of any uploaded video on privacy, consent, or copyright grounds, use our Content Removal or DMCA Notice page.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[960px] pb-12">
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Legal
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Privacy Policy
          </h1>
          <span className="text-xs text-ink-3">Updated {EFFECTIVE_DATE}</span>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          How erobabe handles browser data, third-party uploaded video privacy
          requests, cookies, and advertiser account information.
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
          Have a privacy question or need a video removed?
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
            Contact Us
          </Link>
        </div>
      </div>
    </div>
  );
}

export const metadata: Metadata = publicPageMetadata({ title: "Privacy Policy", description: "Learn how Erobabe handles browser storage, visitor data, account information, analytics, privacy requests, and content removal requests.", alternates: { canonical: `${SITE_URL}/privacy` } });
