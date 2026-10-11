import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About erobabe — premium adult entertainment platform",
  alternates: { canonical: `${SITE_URL}/about` },
};

export default async function AboutPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("site_settings").select("*").eq("id", 1).single();

  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">About</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">A premium destination, run with care</h1>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        {settings?.tagline || "Your destination for discovering premium adult entertainment. 18+ adults only."}
      </p>

      <div className="mt-6 rounded-lg border border-line bg-card p-6">
        <img src={settings?.brand_logo_url || "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png"} alt="erobabe" className="h-10 w-auto" />
        <p className="mt-4 text-[13.5px] font-semibold">erobabe — founded for adults who expect better.</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          We built erobabe around a simple idea: an adult site can feel like a premium product. Clean design,
          verified content owned or licensed by the platform, and one honest ad format — ten fixed 16:9 placements,
          never a maze of pop-unders.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-[13px] font-semibold">18+ verified</p>
          <p className="mt-1 text-[11.5px] text-ink-3">Every visitor is of legal age — enforced at the door.</p>
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-[13px] font-semibold">Editorial quality</p>
          <p className="mt-1 text-[11.5px] text-ink-3">We publish fewer scenes, chosen better. No endless noise.</p>
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-[13px] font-semibold">Privacy first</p>
          <p className="mt-1 text-[11.5px] text-ink-3">Discreet billing, minimal data kept, honest advertising.</p>
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-[11.5px] font-medium text-amber-200">Legal review required before launch</p>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
          The operator must provide verified business details: legal name, registration, business address, support contact,
          and age-verification procedures. Do not publish fictional company identity.
        </p>
      </div>

      <div className="mt-8 flex gap-3">
        <Link href="/contact" className="inline-flex h-9 items-center rounded-md border border-line bg-card px-4 text-[13px] font-medium hover:bg-card-hover">Contact us</Link>
        <Link href="/advertiser" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft">Advertise</Link>
      </div>
    </div>
  );
}
