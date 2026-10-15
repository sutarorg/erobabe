"use client";
import { useState } from "react";
export default function PublishVideoButton({
  id,
  status,
  onChange,
}: {
  id: string;
  status: string;
  onChange: (status: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: status === "published" ? "unpublish" : "publish",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update status");
      onChange(data.video.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="inline-flex h-7 items-center rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:bg-white/5 hover:text-ink disabled:opacity-40"
      >
        {status === "published" ? "Unpublish" : "Publish"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
