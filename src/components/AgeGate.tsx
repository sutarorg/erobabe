import { useState } from "react";
import { LOGO_URL } from "../data/content";

const STORAGE_KEY = "erobabe-age-verified";

/**
 * Age verification gate shown before entering the public website.
 * Frontend-only: the confirmation is stored in localStorage so returning
 * visitors in the same browser skip the gate. Nothing is verified remotely.
 */
export default function AgeGate() {
  const [verified, setVerified] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (verified) return null;

  const confirm = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode — state-only fallback */
    }
    setVerified(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="eb-backdrop absolute inset-0 bg-black/90 backdrop-blur-md" aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="age-gate-title"
        className="eb-panel relative w-full max-w-[330px] rounded-2xl border border-line bg-panel p-8 text-center shadow-[0_32px_90px_rgba(0,0,0,0.7)]"
      >
        <img
          src={LOGO_URL}
          alt="erobabe logo"
          className="mx-auto h-11 w-auto object-contain"
          draggable={false}
        />
        <h2 id="age-gate-title" className="mt-5 text-[19px] font-semibold tracking-tight text-ink">
          Are you 18 or older?
        </h2>
        <p className="mt-2 text-[12.5px] text-ink-3">This site contains adult content.</p>

        <button
          type="button"
          onClick={confirm}
          className="mt-6 h-10 w-full rounded-md bg-accent text-[13.5px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          Yes, I am 18+
        </button>
        <a
          href="https://www.google.com"
          className="mt-2 flex h-10 w-full items-center justify-center rounded-md border border-line text-[13px] font-medium text-ink-2 transition-colors hover:border-zinc-500 hover:text-ink"
        >
          Exit
        </a>
      </div>
    </div>
  );
}
