"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function RecoverPayment({ id }: { id: string }) {
  const router = useRouter();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer">
        Recover missing provider reference
      </summary>
      <p className="my-2 max-w-xs text-ink-3">
        Find this exact invoice/order in your NOWPayments dashboard. This
        verifies provider evidence; it does not mark a payment paid manually.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const providerPaymentId = String(
            new FormData(e.currentTarget).get("provider"),
          );
          setBusy(true);
          try {
            const response = await fetch("/api/admin/payments/reconcile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentId: id, providerPaymentId }),
            });
            const data = await response.json();
            setMessage(
              response.ok
                ? `Reconciled: ${data.status}`
                : data.error || "Not verified",
            );
            router.refresh();
          } catch {
            setMessage("Reconciliation unavailable.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Provider payment ID
          <input
            name="provider"
            inputMode="numeric"
            pattern="[0-9]{1,40}"
            required
            className="my-2 block rounded border border-line bg-void p-2"
          />
        </label>
        <button disabled={busy} className="rounded border border-line p-2">
          {busy ? "Verifying…" : "Verify & reconcile"}
        </button>
      </form>
      {message && (
        <p role="status" className="mt-2 max-w-xs">
          {message}
        </p>
      )}
    </details>
  );
}
