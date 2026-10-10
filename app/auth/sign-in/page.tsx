"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/advertiser";

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    if (profile?.role === "admin") {
      router.push(next.startsWith("/admin") ? next : "/admin");
    } else {
      router.push(next.startsWith("/advertiser") ? next : "/advertiser");
    }
  };

  return (
    <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6">
      <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" className="h-8 w-auto" />
      <h1 className="mt-4 text-[18px] font-semibold">Sign in</h1>
      <p className="mt-1 text-[12px] text-ink-3">Access advertiser or admin portal</p>

      <form onSubmit={handleSignIn} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50" placeholder="you@example.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50" placeholder="••••••••" />
        </label>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="flex h-9 w-full items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex justify-between text-[11px]">
        <Link href="/auth/sign-up" className="text-accent hover:underline">Create advertiser account</Link>
        <Link href="/auth/reset" className="text-ink-3 hover:text-ink">Forgot password?</Link>
      </div>

      <div className="mt-6 rounded-md bg-amber-500/10 p-3 text-[11px] text-amber-200">
        First admin: see DEPLOYMENT.md for secure bootstrap procedure. Never allow self-assigned admin role from browser.
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-void px-4">
      <Suspense fallback={<div className="text-[12px] text-ink-3">Loading...</div>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
