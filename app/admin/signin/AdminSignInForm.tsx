"use client";

import { useEffect, useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import Link from "next/link";

/**
 * Administrator sign-in.
 *
 * Deliberately separate from `/auth/sign-in`: that page is the advertiser
 * portal's front door, offers account creation and password reset, and lands a
 * successful advertiser in `/advertiser`. This one is staff-only — it accepts
 * an account only after the server-side profile says `role = admin` and
 * `status = active`, and it offers no self-service links.
 */
function AdminSignInCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";

  /** Only ever accept an in-app admin destination — never an absolute URL. */
  const destination = next.startsWith("/admin") ? next : "/admin";

  // An admin who is already signed in has no reason to see this form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled || !data?.user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, status")
          .eq("id", data.user.id)
          .maybeSingle();
        if (cancelled) return;
        if ((profile as any)?.role === "admin" && (profile as any)?.status === "active") {
          router.replace(destination);
          return;
        }
      } catch {
        /* Not configured or unreachable — show the form. */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, destination]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
      if (!data?.user) {
        setError("Sign in failed. Check the email and password, then try again.");
        setLoading(false);
        return;
      }

      // The session alone is not enough: this page is only for admins, and the
      // role lives in the profile row, not in the JWT the browser holds.
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", data.user.id)
        .maybeSingle();

      const role = (profile as any)?.role;
      const status = (profile as any)?.status;

      if (role !== "admin") {
        await supabase.auth.signOut().catch(() => undefined);
        setError("This account is not an administrator account.");
        setLoading(false);
        return;
      }
      if (status !== "active") {
        await supabase.auth.signOut().catch(() => undefined);
        setError("This administrator account is not active.");
        setLoading(false);
        return;
      }

      router.replace(destination);
      router.refresh();
    } catch {
      setError("Could not reach the sign-in service. Try again.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-xl border border-white/10 bg-pcard/90 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <img
          src="https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png"
          alt="erobabe"
          className="h-8 w-auto"
        />
        <span className="rounded border border-accent/45 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          Admin
        </span>
      </div>
      <h1 className="mt-4 text-[18px] font-semibold">Admin sign in</h1>
      <p className="mt-1 text-[12px] text-ink-3">Staff access to the erobabe control panel.</p>

      <form onSubmit={handleSignIn} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="username"
            className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px] outline-none focus:border-accent/50"
            placeholder="admin@erobabe.com"
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
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-400">
            <ShieldAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <button
          type="submit"
          disabled={loading || checking}
          className="flex h-9 w-full items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in to admin"}
        </button>
      </form>

      <p className="mt-4 text-[11px] text-ink-3">
        Administrator accounts are issued by the site owner. Advertiser?{" "}
        <Link href="/auth/sign-in" className="text-accent hover:underline">
          Use the advertiser sign in
        </Link>
        .
      </p>
    </div>
  );
}

export default function AdminSignInForm() {
  return (
    <Suspense fallback={<div className="text-[12px] text-ink-3">Loading...</div>}>
      <AdminSignInCard />
    </Suspense>
  );
}
