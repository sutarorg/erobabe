"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { CREATIVE_ACCEPT, MAX_CREATIVE_BYTES } from "@/lib/ads/creative";
import { LOGO_URL } from "@/src/data/content";

export type CheckoutSlot = {
  id: number;
  name: string;
  side: "left" | "right";
  position: number;
  price_cents: number;
  status: string;
  description: string | null;
  available: boolean;
};

const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-line bg-void px-3.5 text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/70";
const labelClass = "block text-[12px] font-medium text-ink-2";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function CheckoutForm({
  slots,
  initialSlot = 0,
  loadError = "",
}: {
  slots: CheckoutSlot[];
  initialSlot?: number;
  loadError?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const requestedSlot = slots.find((slot) => slot.id === initialSlot && slot.available);
  const [slotId, setSlotId] = useState(requestedSlot?.id || 0);
  const [durationMonths, setDurationMonths] = useState(1);
  const [creative, setCreative] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(
    initialSlot && !requestedSlot ? "That ad slot is no longer available. Choose another placement." : "",
  );

  const availableSlots = useMemo(() => slots.filter((slot) => slot.available), [slots]);
  const selectedSlot = slots.find((slot) => slot.id === slotId);
  const totalCents = (selectedSlot?.price_cents || 0) * durationMonths;

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseCreative(file: File | null) {
    setError("");
    setDimensions("");
    if (!file) {
      setCreative(null);
      setPreview("");
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setCreative(null);
      setPreview("");
      setError("Upload a JPG or PNG banner.");
      return;
    }
    if (file.size > MAX_CREATIVE_BYTES) {
      setCreative(null);
      setPreview("");
      setError("Ad banner must be 5 MB or smaller.");
      return;
    }

    setCreative(file);
    if (typeof URL.createObjectURL !== "function") return;
    const nextPreview = URL.createObjectURL(file);
    setPreview(nextPreview);

    const image = new window.Image();
    image.onload = () => {
      if (Math.abs(image.naturalWidth / image.naturalHeight - 16 / 9) > 0.01) {
        setCreative(null);
        setPreview("");
        setDimensions("");
        if (fileInput.current) fileInput.current.value = "";
        setError("Your banner must be 16:9. Try 1200 × 675 or 1280 × 720.");
        return;
      }
      setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
    };
    image.onerror = () => {
      setCreative(null);
      setPreview("");
      if (fileInput.current) fileInput.current.value = "";
      setError("We could not read that image. Choose a valid JPG or PNG.");
    };
    image.src = nextPreview;
  }

  async function submitAd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selectedSlot?.available) {
      setError("Choose an available ad slot.");
      return;
    }
    if (!creative) {
      setError("Upload your 16:9 ad banner before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData(event.currentTarget);
      body.set("slotId", String(slotId));
      body.set("durationMonths", String(durationMonths));
      body.set("creative", creative);
      const response = await fetch("/api/ads/submit", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Unable to submit your ad.");
      router.push("/checkout/review");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit your ad.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitAd} className="grid min-h-screen bg-void lg:grid-cols-2">
      <section className="px-5 py-6 sm:px-8 lg:px-10 xl:px-16">
        <div className="mx-auto max-w-[620px]">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2" aria-label="erobabe home">
              <img src={LOGO_URL} alt="" className="h-7 w-auto" />
              <span className="text-[15px] font-bold">erobabe<span className="text-accent">.</span></span>
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition hover:text-ink">
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> Back to website
            </Link>
          </div>

          <div className="mt-10 sm:mt-14">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
              <span className="h-px w-6 bg-accent" /> Advertiser checkout
            </p>
            <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.035em] text-ink sm:text-[38px]">
              Your brand, in the spotlight.
            </h1>
            <p className="mt-3 max-w-[500px] text-[13px] leading-relaxed text-ink-3">
              Tell us about your ad and upload your creative. No account or advertiser dashboard needed.
            </p>
          </div>

          <div className="mt-8 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider text-ink-3">
            <span className="flex items-center gap-1.5 text-ink"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] text-white">1</span> Ad details</span>
            <span className="h-px flex-1 bg-line" />
            <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-line">2</span> PayPal</span>
            <span className="h-px flex-1 bg-line" />
            <span className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-line">3</span> Review</span>
          </div>

          {(loadError || error) && (
            <p role="alert" className="mt-7 rounded-lg border border-red-500/25 bg-red-500/10 p-3.5 text-[12px] leading-relaxed text-red-300">
              {loadError || error}
            </p>
          )}

          <div className="mt-8 space-y-6">
            <section aria-labelledby="placement-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="placement-heading" className="text-[14px] font-semibold">Choose your placement</h2>
                <span className="text-[11px] text-ink-3">16:9 sidebar banner</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                <label className={labelClass}>
                  <span className="sr-only">Ad slot</span>
                  <select
                    name="slotId"
                    value={slotId}
                    onChange={(event) => { setSlotId(Number(event.target.value)); setError(""); }}
                    required
                    className={`${inputClass} mt-0`}
                  >
                    <option value={0} disabled>Select an available ad slot</option>
                    {availableSlots.map((slot) => (
                      <option key={slot.id} value={slot.id}>Slot {slot.id} — {slot.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span className="sr-only">Campaign duration</span>
                  <select
                    name="durationMonths"
                    value={durationMonths}
                    onChange={(event) => setDurationMonths(Number(event.target.value))}
                    className={`${inputClass} mt-0`}
                  >
                    {[1, 2, 3, 6, 12].map((months) => (
                      <option key={months} value={months}>{months} {months === 1 ? "month" : "months"}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedSlot && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-accent/20 bg-accent/[0.06] px-3.5 py-3">
                  <div>
                    <p className="text-[12px] font-medium">Slot {selectedSlot.id} · {selectedSlot.side} rail, position {selectedSlot.position}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-3">{selectedSlot.description}</p>
                  </div>
                  <span className="ml-3 shrink-0 text-[12px] font-semibold text-accent">{money(selectedSlot.price_cents)}/mo</span>
                </div>
              )}
              {!availableSlots.length && !loadError && (
                <p className="mt-3 rounded-lg border border-dashed border-line p-4 text-[12px] text-ink-3">No ad slots are available right now. Please check back soon.</p>
              )}
            </section>

            <section aria-labelledby="advertiser-heading" className="border-t border-line pt-6">
              <h2 id="advertiser-heading" className="text-[14px] font-semibold">About you & your advertisement</h2>
              <p className="mt-1 text-[11px] text-ink-3">We’ll use your email only for this order and its live notification.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Contact name <span className="text-accent">*</span>
                  <input name="contactName" required maxLength={120} autoComplete="name" placeholder="Alex Morgan" className={inputClass} />
                </label>
                <label className={labelClass}>
                  Company / brand
                  <input name="companyName" maxLength={160} autoComplete="organization" placeholder="Your brand (optional)" className={inputClass} />
                </label>
              </div>
              <label className={`${labelClass} mt-4`}>
                Email address <span className="text-accent">*</span>
                <input name="email" type="email" required maxLength={320} autoComplete="email" placeholder="you@company.com" className={inputClass} />
              </label>
              <label className={`${labelClass} mt-4`}>
                Ad name <span className="text-accent">*</span>
                <input name="adName" required maxLength={160} placeholder="e.g. Summer collection launch" className={inputClass} />
              </label>
              <label className={`${labelClass} mt-4`}>
                Destination URL <span className="text-accent">*</span>
                <input name="destinationUrl" type="url" required maxLength={2048} placeholder="https://your-website.com/landing-page" className={inputClass} />
              </label>
              <label className={`${labelClass} mt-4`}>
                About the advertiser <span className="text-accent">*</span>
                <textarea
                  name="aboutAdvertiser"
                  required
                  maxLength={2000}
                  rows={4}
                  placeholder="Briefly describe your business and what you’re promoting…"
                  className="mt-2 w-full resize-none rounded-lg border border-line bg-void px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/70"
                />
              </label>
            </section>

            <section aria-labelledby="creative-heading" className="border-t border-line pt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="creative-heading" className="text-[14px] font-semibold">Upload your ad banner <span className="text-accent">*</span></h2>
                <span className="text-[10.5px] text-ink-3">JPG or PNG · max 5 MB</span>
              </div>
              <label className="group relative mt-3 block cursor-pointer overflow-hidden rounded-xl border border-dashed border-line bg-card transition hover:border-accent/60">
                {preview ? (
                  <span className="relative block aspect-video bg-black">
                    <img src={preview} alt="Ad banner preview" className="h-full w-full object-contain" />
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-8 text-[11px]">
                      <span className="max-w-[70%] truncate">{creative?.name}</span>
                      <span className="text-emerald-300">{dimensions || "16:9 banner"}</span>
                    </span>
                  </span>
                ) : (
                  <span className="flex aspect-video flex-col items-center justify-center px-5 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent transition group-hover:bg-accent/15">
                      <ImagePlus aria-hidden className="h-5 w-5" />
                    </span>
                    <span className="mt-3 text-[13px] font-medium">Drop in your 16:9 creative</span>
                    <span className="mt-1 text-[11px] text-ink-3">Click to browse · 1200 × 675 recommended</span>
                  </span>
                )}
                <input
                  ref={fileInput}
                  name="creative"
                  type="file"
                  accept={CREATIVE_ACCEPT}
                  required
                  onChange={(event) => chooseCreative(event.target.files?.[0] || null)}
                  className="sr-only"
                />
              </label>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">Your creative and destination are reviewed before anything appears on erobabe.</p>
            </section>
          </div>
        </div>
      </section>

      <aside className="border-t border-line bg-[#0e0f12] px-5 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-10 xl:px-14">
        <div className="mx-auto flex w-full max-w-[440px] flex-col lg:sticky lg:top-0 lg:min-h-screen lg:justify-center lg:py-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-3">Order summary</p>
              <h2 className="mt-1 text-[20px] font-semibold">Pay with PayPal</h2>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-accent"><QrCode aria-hidden className="h-5 w-5" /></span>
          </div>

          <div className="mt-6 rounded-xl border border-line bg-card p-4">
            <div className="flex justify-between gap-4 text-[12px]">
              <span className="text-ink-3">Placement</span>
              <span className="text-right font-medium">{selectedSlot ? `Slot ${selectedSlot.id} · ${selectedSlot.name}` : "Not selected"}</span>
            </div>
            <div className="mt-3 flex justify-between text-[12px]">
              <span className="text-ink-3">Duration</span>
              <span>{durationMonths} {durationMonths === 1 ? "month" : "months"}</span>
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
              <span className="text-[12px] text-ink-2">Total due</span>
              <span className="text-[28px] font-semibold tracking-tight">{money(totalCents)} <small className="text-[11px] font-normal text-ink-3">USD</small></span>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-line bg-card p-5 text-center">
            <p className="text-[12px] font-medium">Scan with your PayPal app</p>
            <p className="mt-1 text-[11px] text-ink-3">Send exactly {money(totalCents)} USD after scanning.</p>
            <a href="/paypal-qr.png" target="_blank" rel="noopener noreferrer" aria-label="Open PayPal QR code in a new tab" className="mx-auto mt-4 block w-fit rounded-xl bg-white p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition hover:scale-[1.01]">
              <img src="/paypal-qr.png" alt="Erobabe PayPal payment QR code" className="h-auto w-full max-w-[270px]" />
            </a>
            <p className="mt-3 text-[10px] text-ink-3">Tap the QR to open a larger image.</p>
          </div>

          <label className={`${labelClass} mt-5`}>
            PayPal transaction ID <span className="font-normal text-ink-3">(optional)</span>
            <input name="paypalTransactionId" maxLength={128} autoComplete="off" placeholder="Helps us find your payment" className={`${inputClass} bg-card`} />
          </label>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-card p-3.5 text-[11.5px] leading-relaxed text-ink-2">
            <input name="paymentConfirmed" type="checkbox" value="true" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#f51655]" />
            <span>I confirm that I have sent <strong className="text-ink">{money(totalCents)} USD</strong> using the PayPal QR above. <span className="text-accent">*</span></span>
          </label>

          {error && <p role="alert" className="mt-4 text-[11.5px] leading-relaxed text-red-300 lg:hidden">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !selectedSlot?.available || !availableSlots.length}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
            {submitting ? "Submitting for review…" : "Submit"}
            {!submitting && <ArrowRight aria-hidden className="h-4 w-4" />}
          </button>

          <div className="mt-4 flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-3">
            <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <p>Your ad will be <strong className="text-ink-2">In review</strong> while our team manually confirms your PayPal payment and approves the creative.</p>
          </div>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-ink-3"><LockKeyhole aria-hidden className="h-3 w-3" /> Secure submission · no account required</p>
        </div>
      </aside>
    </form>
  );
}
