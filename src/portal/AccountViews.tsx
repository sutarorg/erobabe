import { BadgeCheck, CircleCheck, ChevronDown, LifeBuoy, Send } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils/cn";
import { FAQS, type Profile } from "./data";
import { Btn, Card, Field, PageHeader, Select, TextArea } from "./ui";

/* ------------------------------ Profile ----------------------------- */

export function ProfileView({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () => {
    if (form.company.trim().length < 2) {
      setError("Company name is required.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    onSave(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  };

  return (
    <div>
      <PageHeader title="Profile" sub="Manage your advertiser account details." />

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
        <Card className="p-5 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[18px] font-bold text-accent">
            {form.company.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <h3 className="mt-3 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-ink">
            {form.company}
            <BadgeCheck className="h-4 w-4 text-accent" aria-hidden />
          </h3>
          <p className="mt-0.5 text-[11.5px] text-ink-3">{form.email}</p>
          <span className="mt-3 inline-flex items-center rounded-full border border-accent/45 bg-accent/8 px-2.5 py-1 text-[10px] font-semibold text-accent">
            Advertiser
          </span>
          <div className="mt-4 border-t border-line/60 pt-4 text-left">
            <div className="flex justify-between py-1.5 text-[11.5px]">
              <span className="text-ink-3">Member since</span>
              <span className="font-medium text-ink">November 2026</span>
            </div>
            <div className="flex justify-between py-1.5 text-[11.5px]">
              <span className="text-ink-3">Total spend</span>
              <span className="font-medium tabular-nums text-ink">$297.00</span>
            </div>
            <div className="flex justify-between py-1.5 text-[11.5px]">
              <span className="text-ink-3">Campaigns</span>
              <span className="font-medium tabular-nums text-ink">7</span>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-[13.5px] font-semibold text-ink">Account details</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Company name" value={form.company} onChange={set("company")} />
            <Field label="Contact person" value={form.contact} onChange={set("contact")} />
            <Field label="Email address" type="email" value={form.email} onChange={set("email")} />
            <Field label="Website" value={form.website} onChange={set("website")} />
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Country</span>
              <Select
                label="Country"
                className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]"
                value={form.country}
                onChange={set("country")}
              >
                {["United States", "United Kingdom", "Germany", "Netherlands", "Spain", "Canada", "Australia"].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  )
                )}
              </Select>
            </label>
          </div>
          {error && <p className="mt-3 text-[11.5px] text-red-400">{error}</p>}
          <div className="mt-5 flex items-center justify-end gap-2.5 border-t border-line/60 pt-4">
            {saved && (
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-400">
                <CircleCheck className="h-4 w-4" aria-hidden /> Saved locally (demo)
              </span>
            )}
            <Btn onClick={submit}>Save changes</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------ Support ----------------------------- */

export function SupportView({ onNotify }: { onNotify: (message: string) => void }) {
  const [open, setOpen] = useState<number | null>(0);
  const [subject, setSubject] = useState("Billing & wallet");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (message.trim().length < 10) return;
    setSent(true);
    onNotify("Support request received — we'll reply by email (demo).");
  };

  return (
    <div>
      <PageHeader title="Support" sub="Answers to common questions and 24/7 assistance." />

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <LifeBuoy className="h-4 w-4 text-accent" aria-hidden />
            Frequently asked questions
          </h3>
          <div className="mt-3 divide-y divide-line/60">
            {FAQS.map((faq, i) => {
              const isOpen = open === i;
              return (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className={cn("text-[12.5px] font-medium", isOpen ? "text-ink" : "text-ink-2")}>
                      {faq.q}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200",
                        isOpen && "rotate-180 text-accent"
                      )}
                      aria-hidden
                    />
                  </button>
                  {isOpen && (
                    <p className="pb-3.5 pr-8 text-[12px] leading-relaxed text-ink-3">{faq.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-[13.5px] font-semibold text-ink">Contact support</h3>
          {sent ? (
            <div className="mt-4 flex flex-col items-center py-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                <CircleCheck className="h-5 w-5 text-emerald-400" aria-hidden />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-ink">Request received</p>
              <p className="mt-1 max-w-[240px] text-[11.5px] leading-relaxed text-ink-3">
                Ticket #DEMO-1142 was created locally. This is a frontend demo — no message was sent.
              </p>
              <Btn variant="outline" size="sm" className="mt-4" onClick={() => { setSent(false); setMessage(""); }}>
                New request
              </Btn>
            </div>
          ) : (
            <div className="mt-4 space-y-3.5">
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Subject</span>
                <Select
                  label="Subject"
                  className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {["Billing & wallet", "Campaign review", "Slot availability", "Technical issue", "Other"].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    )
                  )}
                </Select>
              </label>
              <TextArea
                label={`Message — ${subject}`}
                placeholder="Describe your question in a few sentences…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Btn className="w-full" disabled={message.trim().length < 10} onClick={submit}>
                <Send className="h-3.5 w-3.5" aria-hidden />
                Send request
              </Btn>
              <p className="text-center text-[10.5px] text-ink-3">
                Demo form — nothing is transmitted.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
