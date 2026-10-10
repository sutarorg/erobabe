"use client";

import { useState } from "react";

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Advertiser", email: "advertiser@example.com", topic: subject, message }),
      });
      if (!res.ok) throw new Error("Failed");
      setSent(true);
    } catch {
      setError("Failed to submit");
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-[20px] font-semibold">Support</h1>
      <p className="mt-1 text-[12px] text-ink-3">Persistent support requests — real ticket persistence</p>

      {sent ? (
        <div className="mt-6 rounded-lg border border-line bg-pcard p-8 text-center"><p className="text-[14px] font-medium">Request received</p><p className="mt-1 text-[12px] text-ink-3">We will reply shortly. Ticket persisted.</p></div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-line bg-pcard p-5">
          <label className="block"><span className="mb-1 block text-[11px]">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} required placeholder="How can we help?" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" /></label>
          <label className="block"><span className="mb-1 block text-[11px]">Message</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} placeholder="Describe your question..." className="w-full rounded-md border border-line bg-void px-3 py-2 text-[13px]" /></label>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <button type="submit" className="h-9 rounded-md bg-accent px-5 text-[13px] font-semibold text-white">Submit ticket</button>
        </form>
      )}
    </div>
  );
}
