"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { company_name: company, contact_name: contact },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // The database auth trigger creates the advertiser profile from the
    // sign-up metadata. The browser never writes a role or account status.
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void px-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6 text-center">
          <h1 className="text-[18px] font-semibold">Check your email</h1>
          <p className="mt-2 text-[12px] text-ink-3">We sent a verification link to {email}. Please verify to continue.</p>
          <Link href="/auth/sign-in" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-void px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-pcard p-6">
        <h1 className="text-[18px] font-semibold">Create advertiser account</h1>
        <p className="mt-1 text-[12px] text-ink-3">Advertise on erobabe — $99 per slot per month</p>

        <form onSubmit={handleSignUp} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Company name</span>
            <input value={company} onChange={(event) => setCompany(event.target.value)} required autoComplete="organization" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="EroAds Media" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Contact name</span>
            <input value={contact} onChange={(event) => setContact(event.target.value)} required autoComplete="name" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="Alex Morgan" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" placeholder="ads@company.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium">Password</span>
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="h-9 w-full rounded-md border border-line bg-void px-3 pr-10 text-[13px]"
                placeholder="Min 8 characters"
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
          <button type="submit" disabled={loading} className="h-9 w-full rounded-md bg-accent text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
            {loading ? "Creating..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-3">
          Already have an account? <Link href="/auth/sign-in" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
