import { useEffect, useState } from "react";
import { CheckCircle2, Info } from "lucide-react";

interface ToastItem {
  id: number;
  message: string;
  kind: "check" | "info";
}

let seq = 0;

/** Fire-and-forget toast: `toast("Link copied")` from anywhere. */
export function toast(message: string, kind: "check" | "info" = "check") {
  window.dispatchEvent(new CustomEvent<ToastItem>("eb:toast", { detail: { id: ++seq, message, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), 2400);
    };
    window.addEventListener("eb:toast", onToast);
    return () => window.removeEventListener("eb:toast", onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[95] flex flex-col items-center gap-2 px-4 md:bottom-8"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="glass pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/10 py-2.5 pl-3.5 pr-5 text-sm font-medium text-white shadow-2xl animate-fade-up"
        >
          {t.kind === "check" ? (
            <CheckCircle2 className="size-4.5 text-brand-400" aria-hidden />
          ) : (
            <Info className="size-4.5 text-violet-400" aria-hidden />
          )}
          {t.message}
        </div>
      ))}
    </div>
  );
}
