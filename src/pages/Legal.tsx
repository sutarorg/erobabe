import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileWarning } from "lucide-react";
import { EmptyState } from "@/components/Sections";
import { useDocumentTitle } from "@/hooks/store";

interface Topic {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
}

const DEMO_NOTE =
  "EroBabe is a static front-end demonstration project. The text below is placeholder content provided only to show layout and structure — it does not constitute legal advice or a real agreement.";

const TOPICS: Record<string, Topic> = {
  about: {
    title: "About EroBabe",
    intro:
      "EroBabe is a premium, adult-oriented video discovery interface built as a static demo. " + DEMO_NOTE,
    sections: [
      { heading: "What this project is", body: "A production-quality front-end prototype: dark cinematic design, dense video grids, search, categories, trending charts and a custom video player — all powered by a fictional local dataset." },
      { heading: "What it is not", body: "There are no accounts, uploads, payments, tracking or servers. Nothing you do here leaves your browser." },
      { heading: "Content notice", body: "All titles, performers, thumbnails and statistics are fictional and used for interface demonstration only. Playback uses openly licensed placeholder video files." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "Your privacy matters. " + DEMO_NOTE,
    sections: [
      { heading: "Data collection", body: "This demo does not collect, transmit or sell personal information. There are no analytics, cookies or third-party trackers." },
      { heading: "Local storage", body: "Age confirmation, watch history, likes, saved videos and playback preferences are stored only in your browser's localStorage. Clear your browser data to remove them at any time." },
      { heading: "Children", body: "This site is intended for adults (18+) and is not directed at minors in any way." },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "By using this demo you acknowledge the following. " + DEMO_NOTE,
    sections: [
      { heading: "Eligibility", body: "You must be 18 years or older (or the age of majority in your jurisdiction) to access this website. The age gate exists purely as an interface demonstration." },
      { heading: "Acceptable use", body: "This prototype is provided 'as is' for evaluation of its design and codebase. Do not misrepresent it as a real commercial service." },
      { heading: "Intellectual property", body: "The EroBabe name and interface are demo branding. Placeholder media belongs to its respective stock licensors and is used within those licenses." },
    ],
  },
  dmca: {
    title: "DMCA & Content Policy",
    intro: "Placeholder policy text. " + DEMO_NOTE,
    sections: [
      { heading: "Content origin", body: "All media in this demo is fictional placeholder content: tasteful stock photography and openly licensed sample video files. No real performers are depicted." },
      { heading: "Takedown requests", body: "As a static demo without user uploads, there is no mechanism for third-party content. If this project were deployed as a real service, a designated DMCA agent process would be documented here." },
      { heading: "Consent standards", body: "Any real deployment of an adult platform must verify age and consent documentation for all depicted performers in compliance with applicable law." },
    ],
  },
  age: {
    title: "Age Policy",
    intro: "This is an adults-only website. " + DEMO_NOTE,
    sections: [
      { heading: "18+ requirement", body: "Access is restricted to users who confirm they are 18 or older. The confirmation is stored locally via localStorage and can be revoked by clearing browser data." },
      { heading: "Parental controls", body: "This site is labeled for adult content (RTA meta tag) so parental-control software can filter it." },
      { heading: "Regional law", body: "Access may be restricted where adult-oriented material is prohibited. Always follow the laws of your jurisdiction." },
    ],
  },
  contact: {
    title: "Contact",
    intro: "This is a demo — there is no real support inbox. " + DEMO_NOTE,
    sections: [
      { heading: "Project questions", body: "For questions about the codebase, structure or deployment, see the README included with the project." },
      { heading: "Media replacement", body: "Thumbnail and video placeholders live in the data layer (src/data/videos.ts) and /public/assets — swap them with your own licensed media without touching components." },
    ],
  },
};

export default function Legal() {
  const { topic } = useParams();
  const t = topic ? TOPICS[topic] : undefined;
  useDocumentTitle(t ? t.title : "Not found");

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
        Demo notice: all legal text on this page is placeholder copy for a static prototype, not an enforceable policy.
      </p>
    </div>
  );
}
