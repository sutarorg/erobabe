"use client";

import { useState } from "react";

export default function RemovalForm() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("Copyright infringement");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!/^https?:\/\/.+/.test(url.trim())) { setError("Enter full video URL starting with https://"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter valid email."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, email, reason, details, type: "video" }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError("Failed to submit. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-card p-8 text-center">
        <p className="text-[14px] font-semibold">Request logged</p>
        <p className="mt-1 text-[12px] text-ink-3">We received your request and will review within 24–48 hours. You will get a confirmation email.</p>
        <button onClick={() => { setSent(false); setUrl(""); }} className="mt-4 h-9 rounded-md border border-line bg-card px-4 text-[13px]">New request</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-card p-5 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Video URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erobabe.com/video/..." className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Your email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
          <option>Copyright infringement</option>
          <option>I appear in this content</option>
          <option>Privacy concern</option>
          <option>Unlawful content</option>
          <option>Other</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Details (optional)</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="Add anything that helps us verify..." className="w-full rounded-md border border-line bg-void px-3 py-2 text-[13px]" />
      </label>
      {error && <p className="text-[11.5px] text-red-400">{error}</p>}
      <button onClick={submit} disabled={loading} className="w-full h-9 rounded-md bg-accent text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
        {loading ? "Submitting..." : "Submit removal request"}
      </button>
    </div>
  );
}
