import { SITE_URL } from "@/lib/site";
import type { Metadata } from "next";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  alternates: { canonical: `${SITE_URL}/contact` },
};

export default function ContactPage() {
  return (
    <div className="pt-6 max-w-3xl">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Support</p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">Contact Us</h1>
      <p className="mt-2 text-[12.5px] text-ink-3">We reply within 24 hours. All messages are stored securely.</p>

      <div className="mt-6">
        <ContactForm />
      </div>
    </div>
  );
}
