"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function AdminRecordActions({
  id,
  actions,
}: {
  id: string;
  actions: { action: string; label: string }[];
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  async function run(action: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.action}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(`${a.label}? Confirm you reviewed this record.`)
              )
                void run(a.action);
            }}
            className="rounded border border-line px-2 py-2 text-xs disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
