import {
  ArrowLeft, ChevronDown, CircleCheck, FileText, Globe, HeartPulse, Mail,
  Megaphone, ShieldCheck, Sparkles, Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { Btn, Card, Field, Select, TextArea } from "../portal/ui";
import { LOGO_URL } from "../data/content";

/* ------------------------------ shell ------------------------------ */

export function PageShell({
  eyebrow,
  title,
  sub,
  onBack,
  children,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 @sm:px-5 @2xl:px-7">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to home
      </button>
      <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">{eyebrow}</p>
      <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
      {sub && <p className="mt-1.5 max-w-[560px] text-[12.5px] leading-relaxed text-ink-3">{sub}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line/60 py-4 first:border-0 first:pt-0">
      <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
      <div className="mt-1.5 space-y-2 text-[12.5px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

const note = "This is a fictional demonstration page — no legal entity operates this demo.";

/* ------------------------------- About ------------------------------ */

export function AboutPage({ onBack, onAdvertise }: { onBack: () => void; onAdvertise?: () => void }) {
  const stats = [
    { value: "1,248", label: "Curated videos" },
    { value: "3.24M", label: "Monthly views" },
    { value: "32", label: "Active campaigns" },
    { value: "24/7", label: "Human moderation" },
  ];
  const values = [
    { icon: ShieldCheck, title: "18+ verified", text: "Every performer and every visitor is of legal age — enforced at the door." },
    { icon: Sparkles, title: "Editorial quality", text: "We publish fewer scenes, chosen better. No endless scroll of noise." },
    { icon: HeartPulse, title: "Privacy first", text: "Discreet billing, no ad trackers on the public rail, minimal data kept." },
  ];
  return (
    <PageShell eyebrow="About" title="A premium destination, run with care" onBack={onBack}
      sub="erobabe is a curated adult video discovery platform pairing an editorial library with honest, fixed-price advertising.">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <img src={LOGO_URL} alt="erobabe logo" className="h-12 w-auto object-contain" draggable={false} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink">erobabe — founded for adults who expect better.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            We built erobabe around a simple idea: an adult site can feel like a premium product.
            Clean design, verified studios, and one honest ad format — ten fixed 16:9 placements,
            never a maze of pop-unders.
          </p>
        </div>
        {onAdvertise && (
          <Btn size="sm" onClick={onAdvertise}>
            <Megaphone className="h-3.5 w-3.5" aria-hidden /> Advertise with us
          </Btn>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 @md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-[19px] font-semibold tabular-nums tracking-tight text-accent">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-3 @md:grid-cols-3">
        {values.map((v) => {
          const Icon = v.icon;
          return (
            <Card key={v.title} className="p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                <Icon className="h-4 w-4 text-accent" aria-hidden />
              </span>
              <p className="mt-2.5 text-[13px] font-semibold text-ink">{v.title}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{v.text}</p>
            </Card>
          );
        })}
      </div>
      <p className="mt-5 text-[10.5px] text-ink-3">{note}</p>
    </PageShell>
  );
}

/* ------------------------------- Terms ------------------------------ */

const TERMS: [string, string][] = [
  ["1. Eligibility", "erobabe is strictly for adults. You must be at least 18 years old (or the age of majority in your jurisdiction) to access any part of the service. By entering, you represent and warrant that you meet this requirement."],
  ["2. Accounts", "Account registration is optional for browsing and required for advertising. You are responsible for the confidentiality of your credentials and for all activity under your account."],
  ["3. Acceptable use", "You may not scrape, mirror, redistribute or resell content, attempt to bypass the age gate or geographic restrictions, upload unlawful material, or interfere with the platform's operation."],
  ["4. Content & licensing", "All videos are provided by verified partner studios who warrant that every depicted person is an adult who consented to distribution. Previews and thumbnails remain the property of their respective owners."],
  ["5. Advertising & payments", "Ad placements are sold at a flat $99 per 30 days per slot. Fees are charged from the advertiser wallet at reservation time. Reservations cancelled within 48 hours receive a prorated wallet refund. All creatives are reviewed before going live."],
  ["6. Moderation & removal", "We review every upload and creative. Reported content is assessed within 24–48 hours. Repeat policy violations may result in account suspension."],
  ["7. Limitation of liability", "The service is provided “as is”. To the maximum extent permitted by law, erobabe is not liable for indirect or consequential damages arising from use of the platform."],
  ["8. Changes & contact", "We may update these terms and will post the revised date below. Questions: legal@erobabe.example."],
];

export function TermsPage({ onBack }: { onBack: () => void }) {
  return (
    <PageShell eyebrow="Legal" title="Terms of Service" sub="Last updated: December 1, 2026 — plain-language summary for the demo." onBack={onBack}>
      <Card className="p-5">
        {TERMS.map(([t, b]) => (
          <LegalSection key={t} title={t}>
            <p>{b}</p>
          </LegalSection>
        ))}
      </Card>
      <p className="mt-4 text-[10.5px] text-ink-3">{note}</p>
    </PageShell>
  );
}

/* ------------------------------ Privacy ----------------------------- */

const PRIVACY: [string, string][] = [
  ["1. What we collect", "For visitors: local preferences (age-gate confirmation, likes, saved items) which live only in your browser. For advertisers: account details, billing contact and campaign metadata needed to run placements."],
  ["2. Cookies & storage", "We use a small set of functional cookies and browser storage. We do not run third-party advertising trackers on the public website."],
  ["3. How we use data", "To operate the library, deliver advertisements you booked, prevent abuse, and meet legal obligations such as age-verification record keeping."],
  ["4. Retention", "Advertiser invoices are retained for tax compliance. Browsing preferences can be cleared anytime by wiping your browser storage."],
  ["5. Your rights", "Depending on your jurisdiction you may request access, correction, export or deletion of your personal data by writing to privacy@erobabe.example."],
  ["6. Discretion", "Billing descriptors are neutral and never reference adult content. Support emails are answered discreetly."],
];

export function PrivacyPage({ onBack }: { onBack: () => void }) {
  return (
    <PageShell eyebrow="Legal" title="Privacy Policy" sub="Last updated: December 1, 2026 — what we keep, and what we never touch." onBack={onBack}>
      <Card className="p-5">
        {PRIVACY.map(([t, b]) => (
          <LegalSection key={t} title={t}>
            <p>{b}</p>
          </LegalSection>
        ))}
      </Card>
      <p className="mt-4 text-[10.5px] text-ink-3">{note}</p>
    </PageShell>
  );
}

/* ------------------------------ Contact ----------------------------- */

export function ContactPage({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("General support");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const channels = [
    { icon: Mail, title: "General support", email: "support@erobabe.example", text: "Questions about browsing, accounts or the library. Replies within 24 hours." },
    { icon: Megaphone, title: "Advertising", email: "ads@erobabe.example", text: "Slot reservations, rate cards and creative guidelines for advertisers." },
    { icon: Trash2, title: "Content removal", email: "removal@erobabe.example", text: "Takedown and privacy requests. Use the dedicated form for fastest handling." },
  ];

  const submit = () => {
    if (name.trim().length < 2) { setError("Please enter your name."); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid email address."); return; }
    if (message.trim().length < 10) { setError("Tell us a little more (at least 10 characters)."); return; }
    setError("");
    setSent(true);
  };

  return (
    <PageShell eyebrow="Support" title="Contact Us" sub="Demo contact page — the form stores nothing and sends nothing." onBack={onBack}>
      <div className="grid gap-3 @md:grid-cols-3">
        {channels.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.title} className="p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                <Icon className="h-4 w-4 text-accent" aria-hidden />
              </span>
              <p className="mt-2.5 text-[13px] font-semibold text-ink">{c.title}</p>
              <p className="mt-0.5 text-[11.5px] font-medium text-accent">{c.email}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{c.text}</p>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 p-5">
        {sent ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
              <CircleCheck className="h-5 w-5 text-emerald-400" aria-hidden />
            </span>
            <p className="mt-3 text-[14px] font-semibold text-ink">Message received</p>
            <p className="mt-1 max-w-[320px] text-[12px] leading-relaxed text-ink-3">
              Thanks, {name.split(" ")[0]}. This is a frontend demo — nothing was transmitted,
              but a real team would reply to {email} shortly.
            </p>
            <Btn variant="outline" size="sm" className="mt-4" onClick={() => { setSent(false); setMessage(""); }}>
              Send another
            </Btn>
          </div>
        ) : (
          <div className="grid gap-4 @md:grid-cols-2">
            <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <label className="block @md:col-span-2">
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Topic</span>
              <Select label="Topic" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={topic} onChange={(e) => setTopic(e.target.value)}>
                {["General support", "Advertising", "Billing", "Content removal", "Press"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </label>
            <TextArea label={`Message — ${topic}`} className="@md:col-span-2" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" />
            {error && <p className="text-[11.5px] text-red-400 @md:col-span-2">{error}</p>}
            <div className="@md:col-span-2">
              <Btn onClick={submit}>Send message</Btn>
            </div>
          </div>
        )}
      </Card>
    </PageShell>
  );
}

/* -------------------------------- FAQ ------------------------------- */

const FAQ_ITEMS = [
  { q: "What is erobabe?", a: "A curated adult video discovery platform with a premium, editorial library and a single honest ad format — ten fixed 16:9 placements around the content, sold directly." },
  { q: "Do I need an account to watch?", a: "No. The public library is free to browse after the 18+ age gate. Accounts are only required for advertisers managing campaigns." },
  { q: "How does advertising work?", a: "Pick any available slot, reserve it for a flat $99 per 30 days, and upload a 16:9 creative (1200×675 recommended). Creatives are reviewed within 24 hours before going live." },
  { q: "Is the content verified and legal?", a: "Yes. All scenes come from verified partner studios with documented age verification and distribution rights for every depicted adult." },
  { q: "How do I request a content removal?", a: "Use the Content Removal form with the video URL and reason. Valid requests are processed within 24–48 hours, and you receive a confirmation by email." },
  { q: "What payment methods do advertisers use?", a: "A prepaid wallet topped up by card. Reservations debit the wallet instantly — no subscriptions, no hidden fees, prorated refunds within 48 hours." },
];

export function FaqPage({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <PageShell eyebrow="Support" title="Frequently Asked Questions" sub="Quick answers about browsing, advertising and moderation." onBack={onBack}>
      <Card className="p-5">
        <div className="divide-y divide-line/60">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
                >
                  <span className={cn("text-[13px] font-medium", isOpen ? "text-ink" : "text-ink-2")}>{item.q}</span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200", isOpen && "rotate-180 text-accent")} aria-hidden />
                </button>
                {isOpen && <p className="pb-4 pr-8 text-[12px] leading-relaxed text-ink-3">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </Card>
      <p className="mt-4 text-[10.5px] text-ink-3">{note}</p>
    </PageShell>
  );
}

/* ------------------------------ Removal ----------------------------- */

const REMOVAL_STEPS = [
  { icon: FileText, title: "Submit the form", text: "Include the exact video URL and the reason — copyright, privacy or consent." },
  { icon: Globe, title: "We verify ownership", text: "Our moderation team confirms the claim within 24–48 hours." },
  { icon: Trash2, title: "Content is removed", text: "Confirmed items are unpublished immediately and purged within 7 days." },
];

export function RemovalPage({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("Copyright infringement");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (!/^https?:\/\/.+\..+/.test(url.trim())) { setError("Enter the full video URL, starting with https://"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid contact email."); return; }
    setError("");
    setSent(true);
  };

  return (
    <PageShell eyebrow="Trust & Safety" title="Content Removal" sub="Report content that should be taken down. Valid requests are handled within 24–48 hours." onBack={onBack}>
      <div className="grid items-start gap-4 @lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-3">
          {REMOVAL_STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={s.title} className="flex items-start gap-3.5 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-[11px] font-bold text-accent">
                  {i + 1}
                </span>
                <div>
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    {s.title}
                    <Icon className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{s.text}</p>
                </div>
              </Card>
            );
          })}
          <Card className="p-4">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              If you appear in a video and want it removed, mention it in the details — consent
              withdrawals are always honored without requiring documentation beyond identity
              confirmation. For urgent matters, write to{" "}
              <span className="text-accent">removal@erobabe.example</span>.
            </p>
          </Card>
        </div>

        <Card className="p-5">
          {sent ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                <CircleCheck className="h-5 w-5 text-emerald-400" aria-hidden />
              </span>
              <p className="mt-3 text-[14px] font-semibold text-ink">Request logged</p>
              <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-ink-3">
                Case #REM-{new Date().getFullYear()}-0042 was created locally. This is a demo —
                nothing was submitted anywhere.
              </p>
              <Btn variant="outline" size="sm" className="mt-4" onClick={() => { setSent(false); setUrl(""); }}>
                New request
              </Btn>
            </div>
          ) : (
            <div className="space-y-3.5">
              <Field label="Video URL" placeholder="https://erobabe.example/video/…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Field label="Your email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Reason</span>
                <Select label="Reason" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {["Copyright infringement", "I appear in this content", "Privacy concern", "Unlawful content", "Other"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </label>
              <TextArea label="Details (optional)" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Add anything that helps us verify the request…" />
              {error && <p className="text-[11.5px] text-red-400">{error}</p>}
              <Btn className="w-full" onClick={submit}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Submit removal request
              </Btn>
              <p className="text-center text-[10.5px] text-ink-3">Demo form — nothing is transmitted or stored.</p>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
