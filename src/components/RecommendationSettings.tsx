"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RecommendationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  useEffect(() => {
    let active = true;
    fetch("/api/recommendations/preferences", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (active) setEnabled(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function update(action: "enable" | "disable" | "reset") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/recommendations/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setEnabled(Boolean(result.enabled));
      router.refresh();
      setMessage(action === "reset" ? "Recommendation history reset." : action === "disable" ? "Personalization is off; profile data was deleted." : "Personalization is on. Your explicit choices now shape recommendations.");
    } catch {
      setMessage("Settings could not be saved. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Recommendation privacy controls" className="rounded-lg border border-line bg-card/70 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-[12px] font-semibold text-ink">Recommendation controls</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            {enabled ? "Personalization is on. Your first-party profile expires after 180 days; event details are kept for up to 30 days." : "Personalization is off. Browsing remains available, with fresh and broadly popular discoveries."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!enabled ? (
            <button type="button" disabled={busy} onClick={() => void update("enable")} className="rounded-md border border-accent/50 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">Turn on personalization</button>
          ) : <>
            <button type="button" disabled={busy} onClick={() => void update("reset")} className="rounded-md border border-line px-3 py-1.5 text-[11px] font-medium text-ink-2 hover:text-ink disabled:opacity-50">Reset recommendations</button>
            <button type="button" disabled={busy} onClick={() => void update("disable")} className="rounded-md border border-line px-3 py-1.5 text-[11px] font-medium text-ink-2 hover:text-ink disabled:opacity-50">Pause and delete profile</button>
          </>}
        </div>
      </div>
      {message && <p className="mt-2 text-[11px] text-ink-3" role="status">{message}</p>}
    </section>
  );
}
