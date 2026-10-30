import { staticPageMetadata } from "@/lib/metadata/page";
import type { Metadata } from "next";
import ContactForm from "./ContactForm";

export const metadata: Metadata = staticPageMetadata("contact", "/contact");

export default function ContactPage() {
  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Support</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Contact Us</h1>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        We reply within 24 hours. All messages are stored securely.
      </p>

      <div className="mt-6">
        <ContactForm />
      </div>
    </div>
  );
}
