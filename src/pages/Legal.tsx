import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileWarning } from "lucide-react";
import { EmptyState } from "@/components/Sections";
import { siteOrigin, useSEO } from "@/lib/seo";

interface Topic {
  title: string;
  seoDescription: string;
  intro: string;
  sections: { heading: string; body: string }[];
}

const TOPICS: Record<string, Topic> = {
  about: {
    title: "About EroBabe",
    seoDescription:
      "About EroBabe — an 18+ adult-content video website with categories, trending videos and a cinematic streaming experience. Adults only.",
    intro:
      "EroBabe is an 18+ adult-content website featuring videos and media intended exclusively for adults who are legally permitted to access such content in their jurisdiction.",
    sections: [
      {
        heading: "The experience",
        body: "EroBabe offers a premium video discovery and streaming experience — categories, trending charts, search, watch history and a modern cinematic player, designed to be fast and intuitive on any device.",
      },
      {
        heading: "Content",
        body: "Content available on EroBabe may be provided by EroBabe or authorized third-party sources. All adult content on the platform is intended for consenting adults and is expected to comply with our content standards.",
      },
      {
        heading: "Access",
        body: "Access is restricted to users who are 18 years of age or older, or the applicable legal age in their jurisdiction. Please use the website responsibly and in compliance with local law.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    seoDescription:
      "EroBabe Privacy Policy — how we handle data collection, browser localStorage and age requirements on this 18+ adult-content website.",
    intro:
      "Your privacy matters. EroBabe is an 18+ adult-content website. The information below explains how we may handle information when you visit and use the website.",
    sections: [
      {
        heading: "Data collection",
        body: "EroBabe may collect limited technical information such as your IP address, browser type, device information and pages visited. This information may be used to operate, secure and improve the website. We do not sell personal information.",
      },
      {
        heading: "Local storage",
        body: "Age confirmation, watch history, likes, saved videos and playback preferences may be stored in your browser's localStorage. Clear your browser data to remove locally stored information at any time.",
      },
      {
        heading: "Children",
        body: "This site is intended strictly for adults (18+) and is not directed at minors in any way. We do not knowingly collect personal information from anyone under 18.",
      },
      {
        heading: "Applicable law",
        body: "The use of EroBabe is subject to applicable laws and regulations in your jurisdiction. By accessing the website, you confirm that you meet the required legal age.",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    seoDescription:
      "EroBabe Terms of Service — eligibility (18+), acceptable use and intellectual-property terms for accessing this adult-content website.",
    intro:
      "By accessing or using EroBabe, you agree to comply with these Terms of Service. EroBabe is an 18+ adult-content website intended only for adults who are legally permitted to access such content in their jurisdiction.",
    sections: [
      {
        heading: "Eligibility",
        body: "You must be 18 years or older (or the applicable age of majority in your jurisdiction) to access or use this website. By using EroBabe, you confirm that you meet the applicable age requirement and that accessing adult content is legal where you are located.",
      },
      {
        heading: "Acceptable use",
        body: "You agree to use EroBabe only for lawful purposes. You must not use the website to distribute illegal content, violate the rights of others, attempt to gain unauthorized access, interfere with the website, or engage in any activity prohibited by applicable law.",
      },
      {
        heading: "Intellectual property",
        body: "The EroBabe name, website design, branding, text, graphics and other original materials are protected by applicable intellectual-property laws. Content displayed on the website may belong to EroBabe or third-party rights holders and may not be copied, reproduced, distributed or commercially exploited without appropriate authorization.",
      },
    ],
  },
  dmca: {
    title: "DMCA & Content Policy",
    seoDescription:
      "EroBabe DMCA & Content Policy — copyright takedown requests, consent standards and how to report illegal content on this 18+ website.",
    intro:
      "EroBabe respects the intellectual-property and personal rights of content creators, performers and copyright owners. We respond to valid copyright and content-related complaints in accordance with applicable law.",
    sections: [
      {
        heading: "Content origin",
        body: "Content available on EroBabe may be provided by EroBabe or authorized third-party sources. We expect all content publishers and rights holders to have the necessary permissions, licenses and consent required to publish and distribute the material.",
      },
      {
        heading: "Takedown requests",
        body: "If you believe that content available on EroBabe infringes your copyright or other legal rights, you may submit a takedown request containing sufficient information to identify the affected content and explain the basis of your claim. Valid requests will be reviewed and appropriate action may be taken.",
      },
      {
        heading: "Consent standards",
        body: "EroBabe requires adult content to involve consenting adults who meet the applicable legal age requirements. Content involving minors, non-consensual sexual activity, exploitation, trafficking or other illegal material is strictly prohibited and may be removed immediately upon discovery.",
      },
      {
        heading: "Report illegal content",
        body: "Anyone who believes that content on EroBabe is illegal or involves non-consensual material should report it through the website's designated contact method. Reports may be reviewed and referred to appropriate authorities where legally required.",
      },
      {
        heading: "Enforcement",
        body: "EroBabe reserves the right to remove content, restrict access or terminate accounts where content violates applicable law or our content standards.",
      },
    ],
  },
  age: {
    title: "Age Policy",
    seoDescription:
      "EroBabe Age Policy — adults-only (18+) access requirements, localStorage age confirmation, parental-control metadata and regional law.",
    intro:
      "This is an adults-only website. EroBabe is intended strictly for users who are 18 years of age or older, or the applicable legal age in their jurisdiction.",
    sections: [
      {
        heading: "18+ requirement",
        body: "Access is restricted to users who confirm they are 18 or older (or the applicable age of majority). Age confirmation may be stored locally in your browser through localStorage and can be removed by clearing your browser data.",
      },
      {
        heading: "Parental controls",
        body: "EroBabe is intended for adult audiences and may use appropriate adult-content classifications or metadata to help parental-control and filtering software identify and restrict access to the website.",
      },
      {
        heading: "Regional law",
        body: "Adult content may not be legal or permitted in every jurisdiction. You are responsible for ensuring that your access to and use of EroBabe complies with the laws and regulations applicable to you.",
      },
      {
        heading: "Confirmation",
        body: "By accessing EroBabe, you confirm that you meet the applicable minimum age requirement and are legally permitted to view adult-oriented content.",
      },
    ],
  },
  contact: {
    title: "Contact",
    seoDescription:
      "Contact EroBabe — general support, copyright & DMCA requests and illegal content reports. Email: hello@erobabe.com.",
    intro:
      "Have a question, concern, copyright issue, or content-related request? You can contact the EroBabe team using the information below.",
    sections: [
      {
        heading: "General questions",
        body: "For questions about EroBabe, website functionality, account-related matters, or general support, please contact our support team by email.",
      },
      {
        heading: "Copyright & DMCA",
        body: "For copyright infringement notices, takedown requests, or intellectual-property concerns, please include sufficient information to identify the affected content and explain your claim.",
      },
      {
        heading: "Content reports",
        body: "To report illegal, non-consensual, abusive, or otherwise prohibited content, please contact us with the relevant details and content URL so that the matter can be reviewed promptly.",
      },
      {
        heading: "Contact",
        body: "Email: hello@erobabe.com — We aim to review legitimate inquiries and reports as promptly as reasonably possible.",
      },
    ],
  },
};

export default function Legal() {
  const { topic } = useParams();
  const t = topic ? TOPICS[topic] : undefined;

  useSEO(
    t
      ? {
          title: `${t.title} — EroBabe 18+`,
          description: t.seoDescription,
          canonical: `${siteOrigin()}/legal/${topic}`,
        }
      : { title: "Not found — EroBabe", robots: "noindex" }
  );

  if (!t) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-16 md:px-8">
        <EmptyState
          icon={FileWarning}
          title="Page not found"
          body="That information page doesn't exist."
          action={
            <Link to="/" className="inline-flex h-11 items-center rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110">
              Back home
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 md:px-8 md:pt-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-fog-500 transition hover:text-white"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Home
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white md:text-3xl">{t.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-fog-400">{t.intro}</p>

      <div className="mt-8 space-y-6">
        {t.sections.map((s) => (
          <section key={s.heading} className="rounded-2xl border border-white/6 bg-ink-900/50 p-5">
            <h2 className="text-base font-semibold tracking-tight text-white">{s.heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fog-400">{s.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-2xl border border-brand-500/20 bg-brand-500/5 p-4 text-xs leading-relaxed text-fog-500">
        Legal notice: EroBabe policies may change as needed.
      </p>
    </div>
  );
}
