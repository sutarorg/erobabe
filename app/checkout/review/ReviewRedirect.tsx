"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock3 } from "lucide-react";
import { LOGO_URL } from "@/src/data/content";

export default function ReviewRedirect() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(5);

  useEffect(() => {
    const countdown = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    const redirect = window.setTimeout(() => router.replace("/"), 5000);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(redirect);
    };
  }, [router]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-5 py-10 text-ink">
      <div aria-hidden className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.07] blur-[100px]" />
      <div aria-hidden className="review-orbit absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10" />
      <div aria-hidden className="review-orbit review-orbit-delay absolute left-1/2 top-1/2 h-[270px] w-[270px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10" />

      <section className="review-card relative z-10 w-full max-w-[500px] rounded-2xl border border-line bg-card/90 p-7 text-center shadow-[0_30px_100px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-10" aria-labelledby="review-title">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="erobabe home">
          <img src={LOGO_URL} alt="" className="h-7 w-auto" />
          <span className="text-[14px] font-bold">erobabe<span className="text-accent">.</span></span>
        </Link>

        <div className="relative mx-auto mt-8 flex h-20 w-20 items-center justify-center">
          <span aria-hidden className="review-pulse absolute inset-0 rounded-full bg-emerald-400/15" />
          <span className="review-check relative flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15 text-emerald-300">
            <Check aria-hidden className="h-8 w-8" strokeWidth={2.2} />
          </span>
        </div>

        <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Submission received</p>
        <h1 id="review-title" className="mt-2 text-[32px] font-semibold tracking-[-0.035em]">In review</h1>
        <p className="mx-auto mt-3 max-w-[370px] text-[13px] leading-relaxed text-ink-2">
          Thank you. Our team will manually verify your PayPal payment and review your 16:9 creative before it goes live.
        </p>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
          Once approved, we’ll email you: <strong className="text-ink-2">“Your ad is live! Erobabe”</strong>
        </p>

        <div className="mt-7 rounded-lg border border-line bg-void px-4 py-3 text-left">
          <p className="flex items-center gap-2 text-[11.5px] text-ink-2"><Clock3 aria-hidden className="h-3.5 w-3.5 text-accent" /> What happens next?</p>
          <ol className="mt-2 space-y-1 pl-5 text-[10.5px] leading-relaxed text-ink-3">
            <li>1. Payment and creative review</li>
            <li>2. Manual approval by our admin</li>
            <li>3. Live confirmation by email</li>
          </ol>
        </div>

        <div className="mt-7" aria-live="polite">
          <p className="text-[11px] text-ink-3">Returning to the public website in <strong className="tabular-nums text-ink">{seconds}</strong> seconds</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="review-progress h-full origin-left rounded-full bg-accent" />
          </div>
        </div>

        <Link href="/" className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2 transition hover:text-accent">
          Return now <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </section>
    </main>
  );
}
