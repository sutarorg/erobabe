"use client";

import { useState } from "react";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("General support");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) { setError("Please enter your name."); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid email."); return; }
    if (message.trim().length < 10) { setError("Message too short."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message }),
      });
      if (!res.ok) throw new Error("Failed");
      setSent(true);
    } catch {
      setError("Failed to send. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-card p-8 text-center">
        <p className="text-[14px] font-semibold">Message received</p>
        <p className="mt-1 text-[12px] text-ink-3">Thanks, {name.split(" ")[0]}. We will reply to {email} shortly.</p>
        <button onClick={() => { setSent(false); setMessage(""); }} className="mt-4 h-9 rounded-md border border-line bg-card px-4 text-[13px]">Send another</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Topic</span>
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
            <option>General support</option>
            <option>Advertising</option>
            <option>Billing</option>
            <option>Content removal</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" rows={4} className="w-full rounded-md border border-line bg-void px-3 py-2 text-[13px] outline-none focus:border-accent/50" />
        </label>
        {error && <p className="text-[11.5px] text-red-400 md:col-span-2">{error}</p>}
        <div className="md:col-span-2">
          <button onClick={submit} disabled={loading} className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
            {loading ? "Sending..." : "Send message"}
          </button>
        </div>
      </div>
    </div>
  );
}
