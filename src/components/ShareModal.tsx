import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, MessageCircle, Send, Share2, X } from "lucide-react";
import { toast } from "./Feedback";
import { cn } from "@/lib/format";

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Z" />
    </svg>
  );
}

export function ShareModal({ open, onClose, url, title }: { open: boolean; onClose: () => void; url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const canNative = typeof navigator !== "undefined" && "share" in navigator;

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      ta.remove();
    }
    setCopied(true);
    toast("Link copied to clipboard");
    window.setTimeout(() => setCopied(false), 1600);
  };

  const options = [
    {
      label: "X",
      icon: XLogo,
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    },
    {
      label: "WhatsApp",
      icon: MessageCircle,
      href: `https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}`,
    },
    {
      label: "Telegram",
      icon: Send,
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Share this video">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        className="glass relative w-full max-w-md rounded-3xl border border-white/10 bg-ink-900/95 p-5 shadow-2xl animate-scale-in sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-white">Share this video</h2>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full text-fog-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/8 bg-ink-800/80 p-2 pl-3.5">
          <Link2 className="size-4 shrink-0 text-fog-500" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-xs text-fog-400">{url}</p>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-white transition active:scale-95",
              copied ? "bg-emerald-600" : "bg-gradient-to-r from-brand-500 to-violet-600 hover:brightness-110"
            )}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {options.map(({ label, icon: Icon, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2.5 rounded-2xl border border-white/6 bg-ink-800/70 py-4 text-xs font-medium text-fog-300 transition hover:border-brand-500/30 hover:text-white active:scale-95"
            >
              <span className="grid size-10 place-items-center rounded-full bg-white/5">
                <Icon className="size-4.5" aria-hidden />
              </span>
              {label}
            </a>
          ))}
        </div>

        {canNative && (
          <button
            type="button"
            onClick={() => {
              navigator.share({ title, url }).catch(() => {});
              onClose();
            }}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-fog-200 transition hover:bg-white/10 active:scale-[0.98]"
          >
            <Share2 className="size-4" aria-hidden />
            More sharing options…
          </button>
        )}
      </div>
    </div>
  );
}
