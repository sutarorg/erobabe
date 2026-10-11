"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import BackToHome from "../BackToHome";

export default function ResetPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/sign-in`,
    });
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-void px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6">
        <h1 className="text-[18px] font-semibold">Reset password</h1>
        {sent ? (
          <p className="mt-2 text-[12px] text-ink-3">If an account exists for {email}, we sent a reset link.</p>
        ) : (
          <form onSubmit={handleReset} className="mt-6 space-y-4">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <button type="submit" className="h-9 w-full rounded-md bg-accent text-[13px] font-semibold text-white">Send reset link</button>
          </form>
        )}
        <Link href="/auth/sign-in" className="mt-4 block text-center text-[11px] text-accent hover:underline">Back to sign in</Link>
        <div className="mt-5 flex justify-center">
          <BackToHome />
        </div>
      </div>
    </div>
  );
}
