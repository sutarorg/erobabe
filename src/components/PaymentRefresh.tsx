"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function PaymentRefresh({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="mt-2 text-xs">
      <button
        disabled={busy}
        className="rounded border border-line px-2 py-2"
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(
              `/api/nowpayments/status?paymentId=${encodeURIComponent(id)}`,
              { cache: "no-store" },
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setMessage(
              `Recorded status: ${data.status}. Provider refresh is throttled; unresolved payments need support.`,
            );
            router.refresh();
          } catch {
            setMessage(
              "Unable to refresh. Please try again or contact support.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : "Refresh provider status"}
      </button>
      {message && (
        <p role="status" className="mt-1 max-w-xs text-ink-3">
          {message}
        </p>
      )}
    </div>
  );
}
