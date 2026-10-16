"use client";
import { useEffect, useState, useRef } from "react";
import { LOGO_URL } from "../data/content";

type GateState = "open" | "passed";

/**
 * Ask for age confirmation on every fresh entry to the public site. The choice
 * only lasts for this mounted page session; it is not saved in browser storage.
 * This front-end confirmation does not verify a visitor's age remotely.
 */
export default function AgeGate() {
  // Starting open makes the age gate part of the server-rendered page as well
  // as the first client render, so visitors never see the site before the gate.
  const [state, setState] = useState<GateState>("open");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== "open") return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [state]);

  if (state !== "open") return null;

  const confirm = () => {
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
