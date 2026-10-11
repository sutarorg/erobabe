"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import BackToHome from "../BackToHome";

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/advertiser";

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
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
    <div className="w-full max-w-sm rounded-xl border border-white/10 bg-pcard/90 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <img src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png" alt="erobabe" className="h-8 w-auto" />
      <h1 className="mt-4 text-[18px] font-semibold">Sign in</h1>
      <p className="mt-1 text-[12px] text-ink-3">Access advertiser portal</p>

      <form onSubmit={handleSignIn} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50"
            placeholder="you@example.com"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Password</span>
          <span className="relative block">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className="h-9 w-full rounded-md border border-line bg-void px-3 pr-10 text-[13px] outline-none focus:border-accent/50"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-3 hover:text-ink"
            >
              {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
            </button>
          </span>
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
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-void px-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute -inset-16 opacity-95 blur-3xl"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 18% 24%, rgba(245,22,85,0.55) 0%, transparent 42%), radial-gradient(ellipse at 82% 32%, rgba(124,58,151,0.42) 0%, transparent 40%), radial-gradient(ellipse at 50% 88%, rgba(213,30,84,0.32) 0%, transparent 45%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/10 via-black/20 to-black/45" />
      </div>
      <div className="relative z-10 flex w-full flex-col items-center">
        <Suspense fallback={<div className="text-[12px] text-ink-3">Loading...</div>}>
          <SignInForm />
        </Suspense>
        <div className="mt-5">
          <BackToHome />
        </div>
      </div>
    </div>
  );
}
