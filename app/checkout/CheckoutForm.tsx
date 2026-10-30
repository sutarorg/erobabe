"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import {
  CREATIVE_ACCEPT,
  CREATIVE_FORMAT_HINT,
  MAX_CREATIVE_BYTES,
} from "@/lib/ads/creative";
import { DEFAULT_CREATIVE_FOCUS, type CreativeFocus } from "@/lib/ads/focus";
import CreativeCropDialog, { CreativeThumb } from "./CreativeCrop";
import type { InventorySlot } from "@/lib/ads/inventory";
import {
  AD_REVIEW_FLAG_KEY,
  CHECKOUT_DURATION_MONTHS,
  PAYPAL_PAYMENT_URL,
} from "@/lib/ads/payment";
import { LOGO_URL } from "@/src/data/content";
import PaymentPanel from "./PaymentPanel";
import SlotPicker from "./SlotPicker";

/** One sellable placement as the wizard sees it. */
export type CheckoutSlot = InventorySlot;

type Step = 1 | 2 | 3;

const STEPS: Array<{ id: Step; title: string }> = [
  { id: 1, title: "Ads Details" },
  { id: 2, title: "Advertiser details" },
  { id: 3, title: "Payment" },
];

const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-line bg-void px-3.5 text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/70";
const labelClass = "block text-[12px] font-medium text-ink-2";
const textareaClass =
  "mt-2 w-full resize-none rounded-lg border border-line bg-void px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/70";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type AdvertiserFields = {
  destinationUrl: string;
  contactName: string;
  companyName: string;
  email: string;
  adName: string;
  aboutAdvertiser: string;
};

const EMPTY_FIELDS: AdvertiserFields = {
  destinationUrl: "",
  contactName: "",
  companyName: "",
  email: "",
  adName: "",
  aboutAdvertiser: "",
};

function StepIndicator({
  step,
  onGoTo,
}: {
  step: Step;
  onGoTo: (step: Step) => void;
}) {
  return (
    <ol
      aria-label="Checkout steps"
      className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] font-medium uppercase tracking-wider text-ink-3"
    >
      {STEPS.map((item, index) => {
        const done = step > item.id;
        const current = step === item.id;
        return (
          <li key={item.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (done ? onGoTo(item.id) : undefined)}
              disabled={!done}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-1.5 ${
                done ? "cursor-pointer hover:text-ink" : "cursor-default"
              } ${current ? "text-ink" : ""}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] ${
                  done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : current
                      ? "bg-accent text-white"
                      : "border border-line"
                }`}
              >
                {done ? <Check aria-hidden className="h-3 w-3" /> : item.id}
              </span>
              {item.title}
            </button>
            {index < STEPS.length - 1 && <span aria-hidden className="h-px w-5 bg-line sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Account-free advertising checkout.
 *
 * Three wizard steps in the left panel — Ads Details → Advertiser details →
 * Payment — while the right panel stays fixed on the payment artwork. The
 * order is written to `/api/ads/submit` and the visitor is handed to the hosted
 * payment page; it returns to the homepage, where a short confirmation card
 * (see `AdReviewNotice`) acknowledges the submission.
 */
export default function CheckoutForm({
  slots,
  initialSlot = 0,
  loadError = "",
}: {
  slots: CheckoutSlot[];
  initialSlot?: number;
  loadError?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const requestedSlot = slots.find((slot) => slot.id === initialSlot && slot.available);
  const [step, setStep] = useState<Step>(requestedSlot ? 2 : 1);
  const [slotId, setSlotId] = useState(requestedSlot?.id || 0);
  const [fields, setFields] = useState<AdvertiserFields>(EMPTY_FIELDS);
  const [creative, setCreative] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [dimensions, setDimensions] = useState("");
  // Which part of the picture fills the placement.
  const [focus, setFocus] = useState<CreativeFocus>(DEFAULT_CREATIVE_FOCUS);
  // The crop picker opens for every upload — even a 16:9 picture may have its
  // subject off to one side — and reopens when the thumbnail is tapped.
  const [cropOpen, setCropOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(
    initialSlot && !requestedSlot
      ? "That ad slot is no longer available. Choose another placement."
      : "",
  );

  // The wizard lives in its own scroll container, so a step change scrolls the
  // panel rather than the page (mobile still scrolls the document).
  const panelRef = useRef<HTMLElement>(null);

  const availableCount = useMemo(
    () => slots.filter((slot) => slot.available).length,
    [slots],
  );
  const selectedSlot = slots.find((slot) => slot.id === slotId);
  const totalCents = selectedSlot?.price_cents || 0;

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function scrollWizardToTop() {
    try {
      panelRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch {
      /* older browsers: the panel simply keeps its position */
    }
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        /* jsdom and locked-down browsers do not implement scrolling */
      }
    }
  }

  function goToStep(next: Step) {
    setError("");
    setStep(next);
    scrollWizardToTop();
  }

  function chooseSlot(slot: CheckoutSlot) {
    setSlotId(slot.id);
    setError("");
    setStep(2);
    scrollWizardToTop();
  }

  function setField<K extends keyof AdvertiserFields>(key: K, value: AdvertiserFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function chooseCreative(file: File | null) {
    setError("");
    setDimensions("");
    setFocus(DEFAULT_CREATIVE_FOCUS);
    if (!file) {
      setCreative(null);
      setPreview("");
      setCropOpen(false);
      return;
    }
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      setCreative(null);
      setPreview("");
      setError("Upload a JPG, PNG or GIF banner.");
      return;
    }
    if (file.size > MAX_CREATIVE_BYTES) {
      setCreative(null);
      setPreview("");
      setError("Ad banner must be 5 MB or smaller.");
      return;
    }

    setCreative(file);
    setCropOpen(true);
    if (typeof URL.createObjectURL !== "function") return;
    const nextPreview = URL.createObjectURL(file);
    setPreview(nextPreview);

    // Any shape is welcome: the 16:9 frame below crops it, and the advertiser
    // chooses which part stays. Only unreadable bytes are rejected.
    const image = new window.Image();
    image.onload = () => {
      setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
    };
    image.onerror = () => {
      setCreative(null);
      setPreview("");
      if (fileInput.current) fileInput.current.value = "";
      setError(`We could not read that image. Choose a ${CREATIVE_FORMAT_HINT} file.`);
    };
    image.src = nextPreview;
  }

  /** Step 2 → 3. The browser has already enforced the required text fields. */
  function continueToPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot?.available) {
      setError("Choose an available ad slot.");
      goToStep(1);
      return;
    }
    if (!creative) {
      setError("Upload your ad banner before continuing.");
      return;
    }
    goToStep(3);
  }

  /** Step 3: create the order, then hand over to the hosted payment page. */
  async function payNow() {
    setError("");
    if (!selectedSlot?.available) {
      setError("Choose an available ad slot.");
      goToStep(1);
      return;
    }
    if (!creative) {
      setError("Upload your ad banner before paying.");
      goToStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("slotId", String(slotId));
      body.set("durationMonths", String(CHECKOUT_DURATION_MONTHS));
      body.set("adName", fields.adName);
      body.set("contactName", fields.contactName);
      body.set("companyName", fields.companyName);
      body.set("email", fields.email);
      body.set("aboutAdvertiser", fields.aboutAdvertiser);
      body.set("destinationUrl", fields.destinationUrl);
      body.set("focusX", String(focus.x));
      body.set("focusY", String(focus.y));
      body.set("focusZoom", String(focus.zoom));
      body.set("creative", creative);

      const response = await fetch("/api/ads/submit", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Unable to submit your ad.");

      // The payment page returns to the homepage; this flag makes the short
      // confirmation card appear there exactly once, for ten seconds.
      try {
        window.localStorage.setItem(
          AD_REVIEW_FLAG_KEY,
          JSON.stringify({
            at: Date.now(),
            orderId: result?.orderId ?? null,
            adName: fields.adName,
          }),
        );
      } catch {
        /* storage disabled — the visitor still reaches the payment page */
      }
      window.location.assign(PAYPAL_PAYMENT_URL);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit your ad.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={continueToPayment}
      className="grid min-h-screen items-start bg-void lg:h-screen lg:overflow-hidden lg:grid-cols-2"
    >
      {/* Desktop: the wizard is its own scroll area, with a thin themed
          scrollbar on its right edge, while the payment panel stays fixed.
          Mobile: the document keeps scrolling as before. */}
      <section
        ref={panelRef}
        aria-label="Checkout steps"
        className="checkout-scroll px-5 pb-16 pt-6 sm:px-8 lg:h-screen lg:overflow-y-auto lg:overflow-x-hidden lg:px-10 xl:px-14"
      >
        <div className="mx-auto w-full max-w-[720px]">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2" aria-label="erobabe home">
              <img src={LOGO_URL} alt="" className="h-7 w-auto" />
              <span className="text-[15px] font-bold">
                erobabe<span className="text-accent">.</span>
              </span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 transition hover:text-ink"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> Back to website
            </Link>
          </div>

          <div className="mt-8 sm:mt-10">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
              <span className="h-px w-6 bg-accent" /> Advertiser checkout
            </p>
            <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[32px]">
              Your brand, in the spotlight.
            </h1>
            <p className="mt-2 max-w-[520px] text-[12.5px] leading-relaxed text-ink-3">
              Pick a 16:9 placement, tell us about your ad, and pay securely. No account needed.
            </p>
          </div>

          <StepIndicator
            step={step}
            onGoTo={(target) => {
              if (target === 1) {
                goToStep(1);
                return;
              }
              if (!slotId) {
                setError("Choose an available ad slot first.");
                goToStep(1);
                return;
              }
              goToStep(target);
            }}
          />

          {(loadError || error) && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-500/25 bg-red-500/10 p-3.5 text-[12px] leading-relaxed text-red-300"
            >
              {loadError || error}
            </p>
          )}

          {step === 1 && (
            <section aria-labelledby="ads-details-heading" className="mt-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="ads-details-heading" className="text-[15px] font-semibold">
                  1. Ads Details
                </h2>
                <span className="text-[11px] text-ink-3">
                  {availableCount} of {slots.length || 10} placements available
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                Ten fixed 16:9 placements, 1 month each. A sold placement shows its running ad and
                cannot be selected.
              </p>
              <SlotPicker slots={slots} onSelect={chooseSlot} />
              {selectedSlot?.available && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3">
                  <span className="text-[12px] text-ink-2">
                    Slot {selectedSlot.id} · {selectedSlot.name} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[12px] font-semibold text-white transition hover:bg-accent-soft"
                  >
                    Continue <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="advertiser-heading" className="mt-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="advertiser-heading" className="text-[15px] font-semibold">
                  2. Advertiser details
                </h2>
                <span className="text-[11px] text-ink-3">
                  {selectedSlot ? `Slot ${selectedSlot.id} · ${money(totalCents)}` : "No slot selected"}
                </span>
              </div>

              {/* 1 — Media upload (required) */}
              <div className="mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink-2">
                    Media upload <span className="text-accent">*</span>
                  </span>
                  <span className="text-[10.5px] text-ink-3">
                    {CREATIVE_FORMAT_HINT} · any shape · max 5 MB
                  </span>
                </div>
                {preview && creative ? (
                  <CreativeThumb
                    src={preview}
                    fileName={creative.name}
                    dimensions={dimensions}
                    focus={focus}
                    onAdjust={() => setCropOpen(true)}
                    onRemove={() => {
                      chooseCreative(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                  />
                ) : (
                  <label className="group relative mt-2 block cursor-pointer overflow-hidden rounded-xl border border-dashed border-line bg-card transition hover:border-accent/60">
                    <span className="flex aspect-video flex-col items-center justify-center px-5 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent transition group-hover:bg-accent/15">
                        <ImagePlus aria-hidden className="h-5 w-5" />
                      </span>
                      <span className="mt-3 text-[13px] font-medium">Drop in your creative</span>
                      <span className="mt-1 text-[11px] text-ink-3">
                        Any size or shape · we fit it to 16:9 · 1200 × 675 recommended
                      </span>
                    </span>
                    <input
                      ref={fileInput}
                      name="creative"
                      type="file"
                      accept={CREATIVE_ACCEPT}
                      onChange={(event) => chooseCreative(event.target.files?.[0] || null)}
                      className="sr-only"
                    />
                  </label>
                )}
                {preview && creative && (
                  <input
                    ref={fileInput}
                    name="creative"
                    type="file"
                    accept={CREATIVE_ACCEPT}
                    onChange={(event) => chooseCreative(event.target.files?.[0] || null)}
                    className="sr-only"
                  />
                )}
              </div>

              {/* 2 — Destination URL (required, highlighted) */}
              <label className="mt-5 block rounded-xl border border-accent/45 bg-accent/[0.06] p-3.5">
                <span className="flex items-center justify-between gap-2 text-[12px] font-medium text-ink-2">
                  <span>
                    Destination URL <span className="text-accent">*</span>
                  </span>
                </span>
                <input
                  name="destinationUrl"
                  type="url"
                  required
                  maxLength={2048}
                  value={fields.destinationUrl}
                  onChange={(event) => setField("destinationUrl", event.target.value)}
                  placeholder="https://your-website.com/landing-page"
                  className={`${inputClass} border-accent/35 bg-void`}
                />
                <span className="mt-1.5 block text-[10.5px] leading-relaxed text-ink-3">
                  Where every click on your banner goes. Use the full https:// address.
                </span>
              </label>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Your name <span className="text-accent">*</span>
                  <input
                    name="contactName"
                    required
                    maxLength={120}
                    autoComplete="name"
                    value={fields.contactName}
                    onChange={(event) => setField("contactName", event.target.value)}
                    placeholder="Alex Morgan"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Company / brand
                  <input
                    name="companyName"
                    maxLength={160}
                    autoComplete="organization"
                    value={fields.companyName}
                    onChange={(event) => setField("companyName", event.target.value)}
                    placeholder="Your brand (optional)"
                    className={inputClass}
                  />
                </label>
              </div>

              <label className={`${labelClass} mt-4`}>
                Email address <span className="text-accent">*</span>
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="email"
                  value={fields.email}
                  onChange={(event) => setField("email", event.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </label>

              <label className={`${labelClass} mt-4`}>
                Ad name <span className="text-accent">*</span>
                <input
                  name="adName"
                  required
                  maxLength={160}
                  value={fields.adName}
                  onChange={(event) => setField("adName", event.target.value)}
                  placeholder="e.g. Summer collection launch"
                  className={inputClass}
                />
              </label>

              <label className={`${labelClass} mt-4`}>
                About you
                <textarea
                  name="aboutAdvertiser"
                  maxLength={2000}
                  rows={3}
                  value={fields.aboutAdvertiser}
                  onChange={(event) => setField("aboutAdvertiser", event.target.value)}
                  placeholder="A sentence about your business (optional)"
                  className={textareaClass}
                />
              </label>

              <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
                We use your email only for this order and its live notification. Your creative and
                destination are reviewed before anything appears on erobabe.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-4 text-[12.5px] font-medium text-ink-2 transition hover:text-ink"
                >
                  <ChevronLeft aria-hidden className="h-3.5 w-3.5" /> Ads Details
                </button>
                <button
                  type="submit"
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-5 text-[13px] font-semibold text-white transition hover:bg-accent-soft"
                >
                  Continue to payment <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="payment-heading" className="mt-7">
              <h2 id="payment-heading" className="text-[15px] font-semibold">
                3. Payment
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                One payment of {money(totalCents)} covers your 16:9 placement for 1 month. Pay
                securely on the next screen — no account needed.
              </p>

              <div className="mt-4 rounded-xl border border-line bg-card p-4">
                <div className="flex justify-between gap-4 text-[12px]">
                  <span className="text-ink-3">Placement</span>
                  <span className="text-right font-medium">
                    {selectedSlot ? `Slot ${selectedSlot.id} · ${selectedSlot.name}` : "Not selected"}
                  </span>
                </div>
                <div className="mt-3 flex justify-between text-[12px]">
                  <span className="text-ink-3">Duration</span>
                  <span>
                    {CHECKOUT_DURATION_MONTHS} {CHECKOUT_DURATION_MONTHS === 1 ? "month" : "months"}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
                  <span className="text-[12px] text-ink-2">Total due</span>
                  <span className="text-[26px] font-semibold tracking-tight">
                    {money(totalCents)}{" "}
                    <small className="text-[11px] font-normal text-ink-3">USD</small>
                  </span>
                </div>
              </div>


              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => goToStep(2)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-4 text-[12.5px] font-medium text-ink-2 transition hover:text-ink disabled:opacity-50"
                >
                  <ChevronLeft aria-hidden className="h-3.5 w-3.5" /> Advertiser details
                </button>
                <button
                  type="button"
                  onClick={() => void payNow()}
                  disabled={submitting || !selectedSlot?.available}
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {submitting ? (
                    <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                  ) : (
                    <LockKeyhole aria-hidden className="h-4 w-4" />
                  )}
                  {submitting ? "Preparing your order…" : `Pay ${money(totalCents)} Now`}
                  {!submitting && <ArrowRight aria-hidden className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-4 flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-3">
                <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <p>
                  Your payment is taken on a secure page, and your banner goes to our team the
                  moment you finish — nothing appears on erobabe before it is approved.
                </p>
              </div>
            </section>
          )}
        </div>
      </section>

      <PaymentPanel />

      {/* The crop picker lives beside the wizard, not on a separate page, so a
          phone keeps its scroll position and the uploaded picture. */}
      {preview && creative && (
        <CreativeCropDialog
          open={cropOpen}
          src={preview}
          fileName={creative.name}
          focus={focus}
          onDone={(next) => {
            setFocus(next);
            setCropOpen(false);
          }}
          // Closing discards the upload: nothing is kept until Done is pressed.
          onClose={() => {
            chooseCreative(null);
            if (fileInput.current) fileInput.current.value = "";
          }}
        />
      )}
    </form>
  );
}
