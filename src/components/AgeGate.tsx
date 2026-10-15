"use client";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { LOGO_URL } from "../data/content";

/** Where the visitor's one-time confirmation is remembered in their browser. */
export const AGE_GATE_STORAGE_KEY = "erobabe-age-verified";

/**
 * `useLayoutEffect` runs before the browser paints, which is what keeps the
 * dialog from flashing for an already-verified visitor. It is swapped for
 * `useEffect` during the server render, where React would otherwise warn that
 * layout effects do nothing there.
 */
const useBeforeFirstPaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type GateState = "checking" | "open" | "passed";

/**
 * Age gate shown once, before the visitor can use the public website.
 * The confirmation is remembered in `localStorage`, so it is asked only on the
 * first visit and never again until the browser data is cleared.
 * This front-end confirmation does not verify a visitor's age remotely.
 */
export default function AgeGate() {
  // Nothing is rendered until the stored choice is known, which keeps the
  // server markup and the first client render identical (no hydration drift).
  const [state, setState] = useState<GateState>("checking");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== "open") return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [state]);

  useBeforeFirstPaint(() => {
    try {
      setState(
        window.localStorage.getItem(AGE_GATE_STORAGE_KEY) ? "passed" : "open",
      );
    } catch {
      // Storage blocked (private mode, disabled cookies): ask once per load.
      setState("open");
    }
  }, []);

  if (state !== "open") return null;

  const confirm = () => {
    try {
      window.localStorage.setItem(
        AGE_GATE_STORAGE_KEY,
        new Date().toISOString(),
      );
    } catch {
      // Confirmation simply will not persist — the dialog still closes.
    }
    setState("passed");
    requestAnimationFrame(() =>
      window.dispatchEvent(new Event("erobabe-age-declared")),
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="eb-backdrop absolute inset-0 bg-black/90 backdrop-blur-md"
        aria-hidden
      />
      <div
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls =
            dialog.current?.querySelectorAll<HTMLElement>("button, a[href]");
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
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
        <h2
          id="age-gate-title"
          className="mt-5 text-[19px] font-semibold tracking-tight text-ink"
        >
          Are you 18 or older?
        </h2>
        <p className="mt-2 text-[12.5px] text-ink-3">
          This site contains adult content.
        </p>

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
