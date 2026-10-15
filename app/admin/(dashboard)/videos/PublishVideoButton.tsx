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
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(form?: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const fields = form ? Object.fromEntries(new FormData(form)) : {};
      const response = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: status === "published" ? "unpublish" : "publish",
          ...fields,
          reviewed: !!fields.reviewed,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save review");
      onChange(data.video.status);
      setReview(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-xs">
      <button
        disabled={busy}
        onClick={() =>
          status === "published" ? void submit() : setReview(!review)
        }
        className="rounded border border-line px-2 py-2"
      >
        {status === "published" ? "Unpublish" : "Review & publish"}
      </button>
      {review && (
        <form
          className="mt-3 max-w-sm space-y-3 rounded border border-line bg-void p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(e.currentTarget);
          }}
        >
          <label className="block">
            Rights basis
            <select
              name="ownership"
              required
              className="mt-1 w-full bg-card p-2"
            >
              <option value="">Select basis</option>
              <option value="owned">Owned</option>
              <option value="licensed">Licensed</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="block">
            Evidence references (no sensitive identity documents)
            <textarea
              name="evidence"
              required
              minLength={20}
              maxLength={2000}
              className="mt-1 w-full bg-card p-2"
            />
          </label>
          <label className="flex gap-2">
            <input name="reviewed" type="checkbox" required />I reviewed
            content, lawful distribution rights, consent, and adult-performer
            records. This content is approved for publication.
          </label>
          <button disabled={busy} className="rounded bg-accent px-3 py-2">
            {busy ? "Verifying…" : "Approve & publish"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
