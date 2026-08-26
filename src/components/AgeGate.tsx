import { useEffect } from "react";
import { DoorOpen, LogOut, ShieldAlert } from "lucide-react";
import { Logo } from "./Brand";
import { HERO_IMAGE } from "@/data/videos";
import { publicSettings } from "@/data/dynamic";

export function AgeGate({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-ink-950 p-4">
      {/* Ambient backdrop */}
      <img
        src={HERO_IMAGE}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
      />
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_35%,rgba(244,63,127,0.16),transparent_70%)]" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/80" aria-hidden />

      <div className="relative w-full max-w-md animate-scale-in rounded-3xl border border-white/10 bg-ink-900/80 p-7 text-center shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-9">
        <div className="flex justify-center">
          <Logo />
        </div>

        <div className="mx-auto mt-7 flex size-14 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/10">
          <ShieldAlert className="size-7 text-brand-400" aria-hidden />
        </div>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">This is an adult website</h1>
        <p className="mt-3 text-sm leading-relaxed text-fog-400">
          {publicSettings.ageText ?? (
            <>
              EroBabe is intended for adults only. You must be{" "}
              <span className="font-semibold text-white">18 years or older</span> — or the age of majority in
              your jurisdiction — to enter. All content here is fictional demo material for interface
              demonstration.
            </>
          )}
        </p>

        <div className="mt-7 grid gap-3">
          <button
            type="button"
            autoFocus
            onClick={onEnter}
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-sm font-semibold text-white shadow-[0_10px_36px_-8px_rgba(244,63,127,0.55)] transition hover:brightness-110 active:scale-[0.98]"
          >
            <DoorOpen className="size-4.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            I am 18 or older — Enter
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "https://www.google.com";
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-fog-300 transition hover:bg-white/10 hover:text-white active:scale-[0.98]"
          >
            <LogOut className="size-4" aria-hidden />
            Leave
          </button>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-fog-600">
          By entering you agree to our Terms of Service and Privacy Policy. Your choice is stored locally in your
          browser only — no personal information is collected.
        </p>
      </div>
    </div>
  );
}
