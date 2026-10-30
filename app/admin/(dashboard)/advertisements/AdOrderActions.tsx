"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Radio, Trash2, X } from "lucide-react";

type Action = "verify_payment" | "make_live" | "reject_ad" | "delete_ad";

export default function AdOrderActions({
  id,
  status,
  paymentStatus,
  amountCents = 0,
}: {
  id: string;
  status: string;
  paymentStatus: string;
  /** Used to warn how much verified revenue a deletion removes. */
  amountCents?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | "">("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "warning">("success");

  async function run(action: Action) {
    const confirmation = {
      verify_payment:
        "Confirm only after you have checked your PayPal account and verified that this payment arrived.",
      make_live:
        "Make this ad live now? The advertiser will automatically receive the ‘Your ad is live! Erobabe’ email.",
      reject_ad:
        "Reject this ad submission? It will never appear on the public website, and its banner is deleted from storage immediately.",
      delete_ad:
        status === "rejected"
          ? "Delete this rejected submission permanently? The banner file and the order record are removed and cannot be restored."
          : `Delete this advertisement permanently? The slot is freed immediately and ${
              paymentStatus === "verified" && amountCents > 0
                ? `$${(amountCents / 100).toFixed(2)} is removed from Verified Ad Revenue`
                : "any payment record for it is removed from Verified Ad Revenue"
            }. This cannot be undone.`,
    }[action];
    if (!window.confirm(confirmation)) return;

    setBusy(action);
    setMessage("");
    try {
      const response = await fetch("/api/admin/advertisements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Review action failed");

      if (result.warning) {
        setMessageTone("warning");
        setMessage(result.warning);
      } else {
        setMessageTone("success");
        setMessage(
          action === "verify_payment"
            ? "PayPal payment marked as verified. You can now make the ad live."
            : action === "make_live"
              ? "Ad is live and the confirmation email has been sent."
              : action === "reject_ad"
                ? result.creativeRemovalFailed
                  ? "Ad submission rejected. Its banner could not be deleted from storage — delete the ad permanently to retry."
                  : "Ad submission rejected and its banner deleted from storage. Delete the record permanently once you no longer need it."
                : "Advertisement deleted permanently. The slot is available again and its payment is no longer counted as verified revenue.",
        );
      }
      router.refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Review action failed");
    } finally {
      setBusy("");
    }
  }

  if (!["in_review", "live", "rejected", "paused"].includes(status)) return null;

  const button = (action: Action, label: string, icon: React.ReactNode, className: string) => (
    <button
      type="button"
      disabled={Boolean(busy)}
      onClick={() => void run(action)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {busy === action ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : icon}
      {busy === action ? "Working…" : label}
    </button>
  );

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {status === "in_review" && paymentStatus === "unverified" &&
          button("verify_payment", "Confirm PayPal payment", <Check aria-hidden className="h-3.5 w-3.5" />, "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15")}
        {status === "in_review" && paymentStatus === "verified" &&
          button("make_live", "Approve & make live", <Radio aria-hidden className="h-3.5 w-3.5" />, "bg-accent text-white hover:bg-accent-soft")}
        {status === "in_review" &&
          button("reject_ad", "Reject", <X aria-hidden className="h-3.5 w-3.5" />, "border border-line bg-void text-ink-3 hover:border-red-500/30 hover:text-red-300")}
        {button(
          "delete_ad",
          status === "rejected" ? "Delete permanently" : "Delete ad",
          <Trash2 aria-hidden className="h-3.5 w-3.5" />,
          "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15",
        )}
      </div>
      {message && (
        <p role="status" className={`mt-2 max-w-xl text-[11px] leading-relaxed ${messageTone === "error" ? "text-red-300" : messageTone === "warning" ? "text-amber-300" : "text-emerald-300"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
